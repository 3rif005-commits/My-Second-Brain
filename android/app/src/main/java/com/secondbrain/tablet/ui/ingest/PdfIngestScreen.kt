package com.secondbrain.tablet.ui.ingest

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.secondbrain.tablet.LlmService
import com.secondbrain.tablet.data.NotesRepository
import io.ktor.client.*
import io.ktor.client.engine.android.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import java.io.InputStream

private val httpClient = HttpClient(Android) {
    install(ContentNegotiation) { json() }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PdfIngestScreen(onBack: () -> Unit, onNoteCreated: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val pdfPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            loading = true
            error = null
            try {
                val filename = uri.lastPathSegment ?: "document.pdf"

                status = "Extracting text from PDF…"
                val text = withContext(Dispatchers.IO) {
                    PDFBoxResourceLoader.init(context)
                    context.contentResolver.openInputStream(uri)?.use { stream ->
                        extractPdfText(stream)
                    } ?: ""
                }
                if (text.isBlank()) error("PDF appears to be empty or image-only")

                status = "Generating note with Gemma 4…"
                val noteContent = withContext(Dispatchers.IO) {
                    generateNoteContent(filename, text.take(6000))
                }

                status = "Saving to Second Brain…"
                val title = filename.removeSuffix(".pdf").take(80)
                val note = NotesRepository.createNote(
                    title = title,
                    contentText = noteContent,
                    sourceType = "pdf",
                    sourceFilename = filename,
                )

                status = "Done!"
                onNoteCreated(note.id)
            } catch (e: Exception) {
                error = e.message?.take(120)
            } finally {
                loading = false
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Import PDF") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") } }
            )
        }
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(Icons.Default.PictureAsPdf, null, Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(24.dp))
            Text("Import a PDF", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            Text("Gemma 4 will read it and generate a structured study note.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(32.dp))

            if (loading) {
                CircularProgressIndicator()
                Spacer(Modifier.height(12.dp))
                Text(status, style = MaterialTheme.typography.bodyMedium)
            } else {
                Button(
                    onClick = { pdfPicker.launch("application/pdf") },
                    enabled = LlmService.isRunning,
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    Text(if (LlmService.isRunning) "Choose PDF" else "Waiting for model…")
                }
                error?.let {
                    Spacer(Modifier.height(12.dp))
                    Text("Error: $it", color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

private fun extractPdfText(stream: InputStream): String {
    PDDocument.load(stream).use { doc ->
        return PDFTextStripper().getText(doc)
    }
}

private suspend fun generateNoteContent(filename: String, text: String): String {
    val prompt = """You are a study assistant. Given the following text extracted from "$filename",
create a concise structured study note with: a brief overview, key concepts, and important takeaways.
Format it as plain text with clear sections.

TEXT:
$text

STUDY NOTE:"""

    val body = buildJsonObject {
        put("model", "gemma")
        put("stream", false)
        put("messages", buildJsonArray {
            add(buildJsonObject { put("role", "user"); put("content", prompt) })
        })
    }

    val resp = httpClient.post("http://localhost:8082/v1/chat/completions") {
        contentType(ContentType.Application.Json)
        setBody(body.toString())
    }
    val json = Json.parseToJsonElement(resp.bodyAsText()).jsonObject
    return json["choices"]?.jsonArray
        ?.firstOrNull()?.jsonObject
        ?.get("message")?.jsonObject
        ?.get("content")?.jsonPrimitive?.content
        ?: "Could not generate note content"
}
