package com.secondbrain.tablet.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
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
import androidx.compose.material3.MaterialTheme
import com.secondbrain.tablet.LlmService
import com.secondbrain.tablet.data.NotesRepository
import com.secondbrain.tablet.ui.theme.*
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

private val chatClient = HttpClient(Android) {
    install(ContentNegotiation) { json() }
    engine {
        connectTimeout = 10_000
        socketTimeout = 5 * 60_000
    }
}

private val suggestedPrompts = listOf(
    "Summarize my recent notes",
    "What are the key concepts I've studied?",
    "Quiz me on my notes",
)

data class Message(val role: String, val text: String)

@Composable
fun ChatPane(modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var messages by remember { mutableStateOf(listOf<Message>()) }
    var input by remember { mutableStateOf("") }
    var responding by remember { mutableStateOf(false) }
    val modelReady = LlmService.isRunning

    fun sendMessage(text: String) {
        if (text.isBlank() || responding || !modelReady) return
        val updated = messages + Message("user", text)
        messages = updated
        input = ""
        responding = true
        scope.launch {
            try {
                val noteContext = fetchNoteContext(text)
                val body = buildJsonObject {
                    put("model", "gemma")
                    put("stream", false)
                    put("messages", buildJsonArray {
                        // System message: always include a tutor persona, add notes if available
                        add(buildJsonObject {
                            put("role", "system")
                            put("content", buildString {
                                append("You are a study tutor for a personal knowledge base called Second Brain.")
                                if (noteContext.isNotEmpty()) {
                                    append(" Use the notes below to answer accurately.\n\n")
                                    append(noteContext)
                                } else {
                                    append(" Help the user understand and review their knowledge.")
                                }
                            })
                        })
                        // Conversation history (user + assistant turns only)
                        updated.forEach { m ->
                            add(buildJsonObject {
                                put("role", m.role)
                                put("content", m.text)
                            })
                        }
                    })
                }
                val resp = chatClient.post("http://localhost:8082/v1/chat/completions") {
                    contentType(ContentType.Application.Json)
                    setBody(body.toString())
                }
                val json = Json.parseToJsonElement(resp.bodyAsText()).jsonObject
                val content = json["choices"]?.jsonArray
                    ?.firstOrNull()?.jsonObject
                    ?.get("message")?.jsonObject
                    ?.get("content")?.jsonPrimitive?.content ?: "No response"
                messages = messages + Message("assistant", content)
            } catch (e: Exception) {
                messages = messages + Message("assistant", "Error: ${e.message?.take(80)}")
            } finally {
                responding = false
                if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
            }
        }
    }

    Column(modifier.background(MaterialTheme.colorScheme.background)) {
        // ── Message area ─────────────────────────────────────────────
        Box(Modifier.weight(1f)) {
            if (!modelReady) {
                // Model loading state
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        CircularProgressIndicator(color = Indigo500)
                        Text("Loading Gemma 4…", color = Slate400, fontSize = 14.sp)
                    }
                }
            } else if (messages.isEmpty()) {
                // Empty / welcome state — matches web exactly
                Column(
                    Modifier.fillMaxSize().padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Box(
                        Modifier
                            .size(64.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(
                                androidx.compose.ui.graphics.Brush.linearGradient(
                                    listOf(Indigo600, Indigo500)
                                )
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("🧠", fontSize = 30.sp)
                    }
                    Spacer(Modifier.height(20.dp))
                    Text(
                        "What do you want to know?",
                        color = Gray50,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Ask anything about your notes",
                        color = Slate400,
                        fontSize = 14.sp,
                    )
                    Spacer(Modifier.height(28.dp))
                    suggestedPrompts.forEach { prompt ->
                        OutlinedButton(
                            onClick = { sendMessage(prompt) },
                            modifier = Modifier.fillMaxWidth().widthIn(max = 480.dp).padding(vertical = 3.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Gray200),
                            border = androidx.compose.foundation.BorderStroke(1.dp, Gray700),
                        ) {
                            Text(prompt, modifier = Modifier.fillMaxWidth(), fontSize = 14.sp)
                        }
                    }
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(vertical = 16.dp),
                ) {
                    items(messages) { msg -> ChatBubble(msg) }
                    if (responding) {
                        item {
                            Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                                CircularProgressIndicator(Modifier.size(20.dp), color = Indigo500, strokeWidth = 2.dp)
                            }
                        }
                    }
                }
            }
        }

        // ── Input bar ────────────────────────────────────────────────
        HorizontalDivider(thickness = 0.5.dp, color = Gray700)
        Row(
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Box(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(16.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                BasicTextField(
                    value = input,
                    onValueChange = { input = it },
                    textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 14.sp, lineHeight = 20.sp),
                    cursorBrush = SolidColor(Indigo500),
                    decorationBox = { inner ->
                        if (input.isEmpty()) {
                            Text(
                                if (modelReady) "Ask anything…" else "Model loading…",
                                color = Slate400,
                                fontSize = 14.sp,
                            )
                        }
                        inner()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 5,
                    enabled = modelReady && !responding,
                )
            }
            Spacer(Modifier.width(8.dp))
            IconButton(
                onClick = { sendMessage(input.trim()) },
                enabled = modelReady && !responding && input.isNotBlank(),
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (modelReady && input.isNotBlank()) Indigo600 else MaterialTheme.colorScheme.surfaceVariant),
            ) {
                Icon(Icons.Default.Send, "Send", tint = if (modelReady && input.isNotBlank()) Color.White else Slate400, modifier = Modifier.size(18.dp))
            }
        }
        Text(
            "Enter to send · Shift+Enter for new line",
            color = Slate400,
            fontSize = 11.sp,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 6.dp),
        )
    }
}

private suspend fun fetchNoteContext(query: String): String {
    val lower = query.lowercase()
    val wantsRecent = lower.contains("recent") || lower.contains("summarize") ||
        lower.contains("all notes") || lower.contains("learned") || lower.contains("overview")

    val notes = runCatching {
        withContext(Dispatchers.IO) {
            if (wantsRecent) {
                NotesRepository.listNotes()
                    .sortedByDescending { it.updatedAt }
                    .take(5)
            } else {
                // Semantic search first (on-device 384-dim), fallback to FTS
                val semantic = NotesRepository.semanticSearch(query.take(80))
                semantic.take(3).ifEmpty {
                    val fts = NotesRepository.searchNotes(query.take(80))
                    fts.take(3).ifEmpty {
                        NotesRepository.listNotes().sortedByDescending { it.updatedAt }.take(3)
                    }
                }
            }
        }
    }.getOrDefault(emptyList())

    if (notes.isEmpty()) return ""
    return buildString {
        append("NOTES FROM THE USER'S SECOND BRAIN:\n\n")
        notes.forEach { note ->
            append("Title: ${note.title}\n")
            append((note.contentText ?: "").take(400).trimEnd())
            append("\n---\n")
        }
    }
}

@Composable
private fun ChatBubble(msg: Message) {
    val isUser = msg.role == "user"
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 3.dp),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            Modifier
                .widthIn(max = 560.dp)
                .clip(
                    RoundedCornerShape(
                        topStart = 16.dp, topEnd = 16.dp,
                        bottomStart = if (isUser) 16.dp else 4.dp,
                        bottomEnd = if (isUser) 4.dp else 16.dp,
                    )
                )
                .background(if (isUser) Indigo600 else MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Text(
                msg.text,
                color = if (isUser) Color.White else MaterialTheme.colorScheme.onSurface,
                fontSize = 14.sp,
                lineHeight = 22.sp,
            )
        }
    }
}
