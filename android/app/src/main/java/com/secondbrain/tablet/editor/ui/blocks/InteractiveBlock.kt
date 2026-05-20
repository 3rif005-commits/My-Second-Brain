package com.secondbrain.tablet.editor.ui.blocks

import android.webkit.WebView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.ui.theme.Indigo500
import com.secondbrain.tablet.ui.theme.Indigo600
import com.secondbrain.tablet.ui.theme.Slate400
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

private val interactiveClient by lazy {
    HttpClient(Android) {
        install(ContentNegotiation) { json() }
        engine { socketTimeout = 5 * 60_000 }
    }
}

private enum class InteractiveSetupMode { NONE, AI, PASTE }

@Composable
fun InteractiveBlock(
    block: BlockState,
    onSetHtml: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    var setupMode by remember { mutableStateOf(InteractiveSetupMode.NONE) }
    var aiPrompt by remember { mutableStateOf("") }
    var pasteCode by remember { mutableStateOf("") }
    var isGenerating by remember { mutableStateOf(false) }
    var genError by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        // Title bar
        Row(
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("📊", fontSize = 13.sp)
            Spacer(Modifier.width(6.dp))
            Text(
                "Canvas Block",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
                modifier = Modifier.weight(1f),
            )
            if (block.htmlContent.isNotBlank()) {
                Text(
                    "Tap to replace",
                    color = Indigo500.copy(alpha = 0.7f),
                    fontSize = 10.sp,
                    modifier = Modifier.clickable { setupMode = InteractiveSetupMode.AI },
                )
            }
        }

        if (block.htmlContent.isNotBlank()) {
            // Render existing HTML
            AndroidView(
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.loadWithOverviewMode = true
                        settings.useWideViewPort = true
                        isScrollContainer = false
                        loadDataWithBaseURL(null, block.htmlContent, "text/html", "UTF-8", null)
                    }
                },
                update = { webView ->
                    webView.loadDataWithBaseURL(null, block.htmlContent, "text/html", "UTF-8", null)
                },
                modifier = Modifier.fillMaxWidth().height(240.dp),
            )
        } else {
            // Empty state — two setup options
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    "How would you like to build this canvas?",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp,
                )
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    // Ask AI option
                    Column(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .border(1.dp, Indigo600.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                            .background(Indigo600.copy(alpha = 0.08f))
                            .clickable { setupMode = InteractiveSetupMode.AI }
                            .padding(14.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("🤖", fontSize = 22.sp)
                        Text(
                            "Ask AI",
                            color = MaterialTheme.colorScheme.onBackground,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            "Describe what you want and AI will generate it",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 11.sp,
                        )
                    }

                    // Paste HTML option
                    Column(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .clickable { setupMode = InteractiveSetupMode.PASTE }
                            .padding(14.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("📋", fontSize = 22.sp)
                        Text(
                            "Paste HTML",
                            color = MaterialTheme.colorScheme.onBackground,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            "Paste your own HTML or JavaScript code",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 11.sp,
                        )
                    }
                }
            }
        }
    }

    // ── Ask AI dialog ─────────────────────────────────────────────────────
    if (setupMode == InteractiveSetupMode.AI) {
        Dialog(onDismissRequest = { if (!isGenerating) setupMode = InteractiveSetupMode.NONE }) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    "🤖  Generate with AI",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "Describe the interactive widget you want (quiz, flashcards, diagram, etc.)",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp,
                )

                // Prompt input
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.background)
                        .padding(12.dp),
                ) {
                    if (aiPrompt.isEmpty()) {
                        Text(
                            "e.g. \"Quiz about the French Revolution with 5 questions\"",
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                            fontSize = 13.sp,
                        )
                    }
                    BasicTextField(
                        value = aiPrompt,
                        onValueChange = { aiPrompt = it },
                        textStyle = TextStyle(
                            color = MaterialTheme.colorScheme.onBackground,
                            fontSize = 13.sp,
                        ),
                        cursorBrush = SolidColor(Indigo500),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp),
                        minLines = 2,
                        enabled = !isGenerating,
                    )
                }

                genError?.let { err ->
                    Text(err, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                }

                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                ) {
                    TextButton(
                        onClick = { setupMode = InteractiveSetupMode.NONE; genError = null },
                        enabled = !isGenerating,
                    ) {
                        Text("Cancel", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Button(
                        onClick = {
                            if (aiPrompt.isBlank()) return@Button
                            genError = null
                            isGenerating = true
                            scope.launch {
                                try {
                                    val html = generateHtmlWithAi(aiPrompt.trim())
                                    onSetHtml(html)
                                    setupMode = InteractiveSetupMode.NONE
                                    aiPrompt = ""
                                } catch (e: Exception) {
                                    genError = "Generation failed: ${e.message?.take(80)}"
                                } finally {
                                    isGenerating = false
                                }
                            }
                        },
                        enabled = aiPrompt.isNotBlank() && !isGenerating,
                        colors = ButtonDefaults.buttonColors(containerColor = Indigo600),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        if (isGenerating) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(14.dp),
                                color = Color.White,
                                strokeWidth = 2.dp,
                            )
                            Spacer(Modifier.width(6.dp))
                            Text("Generating…")
                        } else {
                            Text("Generate")
                        }
                    }
                }
            }
        }
    }

    // ── Paste HTML dialog ─────────────────────────────────────────────────
    if (setupMode == InteractiveSetupMode.PASTE) {
        Dialog(onDismissRequest = { setupMode = InteractiveSetupMode.NONE }) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    "📋  Paste HTML Code",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "Paste your HTML, CSS, and JavaScript below. It will run in a sandboxed WebView.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp,
                )

                // Code input
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.background)
                        .padding(12.dp),
                ) {
                    if (pasteCode.isEmpty()) {
                        Text(
                            "<!DOCTYPE html>\n<html>…</html>",
                            color = Slate400.copy(alpha = 0.5f),
                            fontSize = 12.sp,
                        )
                    }
                    BasicTextField(
                        value = pasteCode,
                        onValueChange = { pasteCode = it },
                        textStyle = TextStyle(
                            color = MaterialTheme.colorScheme.onBackground,
                            fontSize = 12.sp,
                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                        ),
                        cursorBrush = SolidColor(Indigo500),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 300.dp),
                        minLines = 6,
                    )
                }

                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                ) {
                    TextButton(onClick = { setupMode = InteractiveSetupMode.NONE }) {
                        Text("Cancel", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Button(
                        onClick = {
                            if (pasteCode.isNotBlank()) {
                                onSetHtml(pasteCode.trim())
                                setupMode = InteractiveSetupMode.NONE
                                pasteCode = ""
                            }
                        },
                        enabled = pasteCode.isNotBlank(),
                        colors = ButtonDefaults.buttonColors(containerColor = Indigo600),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text("Apply")
                    }
                }
            }
        }
    }
}

private suspend fun generateHtmlWithAi(prompt: String): String = withContext(Dispatchers.IO) {
    val systemPrompt = """You are an expert HTML/JS developer. Generate a single self-contained interactive HTML page.
Requirements:
- Inline all CSS and JS (no external dependencies)
- Use a clean, modern design with good contrast
- Keep it concise and functional
- Output ONLY raw HTML starting with <!DOCTYPE html>, nothing else"""

    val userPrompt = "Create an interactive widget: $prompt"

    val body = buildJsonObject {
        put("model", "gemma")
        put("stream", false)
        put("messages", buildJsonArray {
            add(buildJsonObject { put("role", "system"); put("content", systemPrompt) })
            add(buildJsonObject { put("role", "user"); put("content", userPrompt) })
        })
    }

    val resp = interactiveClient.post("http://localhost:8082/v1/chat/completions") {
        contentType(ContentType.Application.Json)
        setBody(body.toString())
    }

    val raw = resp.bodyAsText()
    if (raw.isBlank()) error("AI returned empty response — model may not be running")

    val content = Json.parseToJsonElement(raw).jsonObject["choices"]
        ?.jsonArray?.firstOrNull()?.jsonObject
        ?.get("message")?.jsonObject
        ?.get("content")?.jsonPrimitive?.content
        ?: error("Could not parse AI response")

    // Extract HTML block if wrapped in markdown code fences
    val html = content.lines().let { lines ->
        val start = lines.indexOfFirst { it.trimStart().startsWith("<!DOCTYPE") || it.trim() == "```html" }
        val end = lines.indexOfLast { it.trim() == "```" }
        when {
            start >= 0 && end > start && lines[start].trim() == "```html" ->
                lines.subList(start + 1, end).joinToString("\n")
            start >= 0 && lines[start].trimStart().startsWith("<!DOCTYPE") ->
                lines.drop(start).takeWhile { it.trim() != "```" }.joinToString("\n")
            else -> content
        }
    }

    html.trim()
}
