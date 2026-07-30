package com.secondbrain.tablet.ui.ingest

import android.net.Uri
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.secondbrain.tablet.LlmService
import com.secondbrain.tablet.data.NotesRepository
import com.secondbrain.tablet.ui.theme.*
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import io.ktor.client.*
import io.ktor.client.engine.android.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

private val ingestClient = HttpClient(Android) {
    install(ContentNegotiation) { json() }
    engine {
        connectTimeout = 10_000       // 10 s to establish connection
        socketTimeout = 5 * 60_000   // 5 min for LLM inference response
    }
}

private enum class IngestMode { FILE, URL }

/**
 * pendingFileUri: set by MainScreen when a file is picked (launcher lives there to survive
 *   Activity recreation caused by MIUI config changes when the file picker opens).
 * onFilePicked: called when the user taps "Choose File" — parent launches the picker.
 * onFileUriConsumed: called once we start processing the URI so parent can clear it.
 */
@Composable
fun IngestDialog(
    onDismiss: () -> Unit,
    onNoteCreated: (String) -> Unit,
    pendingFileUri: Uri? = null,
    onFilePicked: () -> Unit = {},
    onFileUriConsumed: () -> Unit = {},
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf(IngestMode.FILE) }
    var status by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var urlInput by remember { mutableStateOf("") }

    suspend fun callLlm(title: String, rawText: String): String = withContext(Dispatchers.IO) {
        val prompt = "You are a study assistant. Write a SHORT study note (max 200 words) for: \"$title\".\n" +
            "Sections: Overview (2 sentences), Key Concepts (3-5 bullets), Takeaways (2-3 bullets).\n\n" +
            "SOURCE:\n${rawText.take(2500)}\n\nSTUDY NOTE (keep it brief):"
        val body = buildJsonObject {
            put("model", "gemma")
            put("stream", false)
            put("messages", buildJsonArray {
                add(buildJsonObject { put("role", "user"); put("content", prompt) })
            })
        }
        val resp = ingestClient.post("http://localhost:8082/v1/chat/completions") {
            contentType(ContentType.Application.Json)
            setBody(body.toString())
        }
        val respBody = resp.bodyAsText()
        if (respBody.isBlank()) error("LLM returned empty response — model may be overloaded")
        Json.parseToJsonElement(respBody).jsonObject["choices"]
            ?.jsonArray?.firstOrNull()?.jsonObject
            ?.get("message")?.jsonObject
            ?.get("content")?.jsonPrimitive?.content
            ?: "Could not generate note content"
    }

    suspend fun processFile(uri: Uri) {
        val appCtx = context.applicationContext
        val filename = appCtx.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val col = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (cursor.moveToFirst() && col >= 0) cursor.getString(col) else null
        } ?: uri.lastPathSegment?.substringAfterLast('/') ?: "document"

        val mimeType = appCtx.contentResolver.getType(uri) ?: ""
        val isPdf = mimeType == "application/pdf" || filename.endsWith(".pdf", ignoreCase = true)
        android.util.Log.d("Ingest", "processFile: file=$filename mime=$mimeType isPdf=$isPdf")

        status = "Reading file…"
        val rawText = withContext(Dispatchers.IO) {
            if (isPdf) {
                PDFBoxResourceLoader.init(appCtx)
                appCtx.contentResolver.openInputStream(uri)?.use { stream ->
                    android.util.Log.d("Ingest", "PDF stream opened, loading doc")
                    PDDocument.load(stream).use { doc ->
                        android.util.Log.d("Ingest", "PDF pages=${doc.numberOfPages}")
                        PDFTextStripper().getText(doc)
                    }
                } ?: ""
            } else {
                appCtx.contentResolver.openInputStream(uri)
                    ?.use { it.bufferedReader().readText() } ?: ""
            }
        }
        android.util.Log.d("Ingest", "Extracted ${rawText.length} chars")

        if (rawText.isBlank()) {
            error("PDF has no selectable text — it may be a scanned image. Try a text-based PDF, .md, or .txt file.")
        }

        val ext = filename.substringAfterLast('.', "").lowercase()
        val sourceType = when {
            isPdf -> "pdf"
            ext == "md" || ext == "markdown" -> "markdown"
            else -> "text"
        }
        val title = filename.substringBeforeLast('.')
        status = "Generating note with Gemma 4…"
        val noteContent = callLlm(title, rawText)
        status = "Saving to Second Brain…"
        val note = NotesRepository.createNote(
            title = title.take(80),
            contentText = noteContent,
            sourceType = sourceType,
            sourceFilename = filename,
        )
        status = "Done!"
        onNoteCreated(note.id)
    }

    // When parent delivers a file URI (file picker result), start processing automatically.
    // NOTE: onFileUriConsumed() is called in finally (not at start) — calling it early would
    // change pendingFileUri to null, changing the LaunchedEffect key and cancelling this coroutine.
    LaunchedEffect(pendingFileUri) {
        val uri = pendingFileUri ?: return@LaunchedEffect
        loading = true
        error = null
        try {
            processFile(uri)
        } catch (e: CancellationException) {
            throw e  // never swallow coroutine cancellations
        } catch (e: Throwable) {
            android.util.Log.e("Ingest", "File import failed: ${e.javaClass.name}: ${e.message}", e)
            val msg = "${e.javaClass.simpleName}: ${e.message ?: "unknown"}".take(120)
            error = msg
            Toast.makeText(context, "Import failed: $msg", Toast.LENGTH_LONG).show()
        } finally {
            loading = false
            onFileUriConsumed()  // clear URI after processing — key changes here, restarting the effect is fine now
        }
    }

    fun importUrl() {
        val raw = urlInput.trim()
        if (raw.isBlank()) return
        val url = if (raw.startsWith("http://") || raw.startsWith("https://")) raw else "https://$raw"
        loading = true
        error = null
        scope.launch {
            try {
                status = "Fetching page…"
                val html = withContext(Dispatchers.IO) {
                    ingestClient.get(url) {
                        header("User-Agent", "Mozilla/5.0 (Android) SecondBrain/2.0")
                        header("Accept", "text/html,*/*")
                    }.bodyAsText()
                }
                val text = html
                    .replace(Regex("<script[^>]*>[\\s\\S]*?</script>", RegexOption.IGNORE_CASE), "")
                    .replace(Regex("<style[^>]*>[\\s\\S]*?</style>", RegexOption.IGNORE_CASE), "")
                    .replace(Regex("<[^>]+>"), " ")
                    .replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")
                    .replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'")
                    .replace(Regex("\\s{3,}"), "\n").trim()
                if (text.isBlank()) error("Could not extract text from that URL")
                val titleMatch = Regex("<title[^>]*>([^<]+)</title>", RegexOption.IGNORE_CASE).find(html)
                val title = titleMatch?.groupValues?.getOrNull(1)?.trim()?.ifBlank { null }
                    ?: url.substringAfterLast('/').take(60).ifBlank { "Web page" }
                status = "Generating note with Gemma 4…"
                val noteContent = callLlm(title, text)
                status = "Saving to Second Brain…"
                val note = NotesRepository.createNote(
                    title = title.take(80),
                    contentText = noteContent,
                    sourceType = "url",
                    sourceFilename = url,
                )
                status = "Done!"
                onNoteCreated(note.id)
            } catch (e: Throwable) {
                val msg = "${e.javaClass.simpleName}: ${e.message ?: "unknown"}".take(120)
                error = msg
                Toast.makeText(context, "Import failed: $msg", Toast.LENGTH_LONG).show()
            } finally {
                loading = false
            }
        }
    }

    Dialog(onDismissRequest = { if (!loading) onDismiss() }) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = Gray800,
            modifier = Modifier.widthIn(max = 480.dp),
        ) {
            Column(Modifier.padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Import Knowledge", color = Gray50, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text("Turn any source into a study note", color = Slate400, fontSize = 13.sp)
                Spacer(Modifier.height(20.dp))

                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                        .background(Gray900).padding(4.dp),
                ) {
                    ModeTab("File", Icons.Default.UploadFile, mode == IngestMode.FILE, Modifier.weight(1f)) {
                        if (!loading) { mode = IngestMode.FILE; error = null }
                    }
                    ModeTab("URL", Icons.Default.Language, mode == IngestMode.URL, Modifier.weight(1f)) {
                        if (!loading) { mode = IngestMode.URL; error = null }
                    }
                }

                Spacer(Modifier.height(20.dp))

                if (loading) {
                    CircularProgressIndicator(color = Indigo500)
                    Spacer(Modifier.height(12.dp))
                    Text(status, color = Slate400, fontSize = 13.sp)
                } else {
                    when (mode) {
                        IngestMode.FILE -> {
                            Text("PDF, Markdown (.md), or plain text (.txt)", color = Slate400, fontSize = 13.sp)
                            Spacer(Modifier.height(16.dp))
                            Button(
                                onClick = { onFilePicked() },
                                enabled = LlmService.isRunning,
                                modifier = Modifier.fillMaxWidth().height(44.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Indigo600),
                                shape = RoundedCornerShape(10.dp),
                            ) {
                                Icon(Icons.Default.UploadFile, null, Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text(if (LlmService.isRunning) "Choose File" else "Waiting for model…")
                            }
                        }
                        IngestMode.URL -> {
                            OutlinedTextField(
                                value = urlInput,
                                onValueChange = { urlInput = it },
                                placeholder = { Text("https://example.com/article", color = Slate400) },
                                label = { Text("Web URL", color = Slate400) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(
                                    keyboardType = KeyboardType.Uri,
                                    imeAction = ImeAction.Go,
                                ),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedTextColor = Gray200, unfocusedTextColor = Gray200,
                                    focusedBorderColor = Indigo500, unfocusedBorderColor = Gray700,
                                    focusedLabelColor = Slate400, unfocusedLabelColor = Slate400,
                                ),
                            )
                            Spacer(Modifier.height(12.dp))
                            Button(
                                onClick = { importUrl() },
                                enabled = LlmService.isRunning && urlInput.isNotBlank(),
                                modifier = Modifier.fillMaxWidth().height(44.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Indigo600),
                                shape = RoundedCornerShape(10.dp),
                            ) {
                                Icon(Icons.Default.Language, null, Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text(if (LlmService.isRunning) "Import URL" else "Waiting for model…")
                            }
                        }
                    }

                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                        Text("Cancel", color = Slate400, fontSize = 13.sp)
                    }
                    error?.let {
                        Spacer(Modifier.height(8.dp))
                        Text("Error: $it", color = Red500, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
    }
}

@Composable
private fun ModeTab(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Row(
        modifier.clip(RoundedCornerShape(8.dp))
            .background(if (selected) Gray700 else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, Modifier.size(16.dp), tint = if (selected) Gray50 else Slate400)
        Spacer(Modifier.width(6.dp))
        Text(
            label,
            color = if (selected) Gray50 else Slate400,
            fontSize = 13.sp,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
        )
    }
}
