package com.secondbrain.tablet.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.secondbrain.tablet.LlmService
import io.ktor.client.*
import io.ktor.client.engine.android.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

private val httpClient = HttpClient(Android) {
    install(ContentNegotiation) { json() }
}

data class ChatMessage(val role: String, val text: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var messages by remember { mutableStateOf(listOf<ChatMessage>()) }
    var input by remember { mutableStateOf("") }
    var responding by remember { mutableStateOf(false) }
    val modelReady = LlmService.isRunning

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("AI Tutor") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") } }
            )
        },
        bottomBar = {
            Surface(tonalElevation = 4.dp) {
                Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = input,
                        onValueChange = { input = it },
                        placeholder = { Text(if (modelReady) "Ask anything…" else "Model loading…") },
                        enabled = modelReady && !responding,
                        modifier = Modifier.weight(1f),
                        maxLines = 4,
                    )
                    Spacer(Modifier.width(8.dp))
                    IconButton(
                        onClick = {
                            val question = input.trim()
                            if (question.isBlank()) return@IconButton
                            input = ""
                            messages = messages + ChatMessage("user", question)
                            responding = true
                            scope.launch {
                                val answer = StringBuilder()
                                try {
                                    val body = buildJsonObject {
                                        put("model", "gemma")
                                        put("stream", false)
                                        put("messages", buildJsonArray {
                                            messages.forEach { m ->
                                                add(buildJsonObject {
                                                    put("role", m.role)
                                                    put("content", m.text)
                                                })
                                            }
                                        })
                                    }
                                    val resp = httpClient.post("http://localhost:8082/v1/chat/completions") {
                                        contentType(ContentType.Application.Json)
                                        setBody(body.toString())
                                    }
                                    val json = Json.parseToJsonElement(resp.bodyAsText()).jsonObject
                                    val content = json["choices"]?.jsonArray
                                        ?.firstOrNull()?.jsonObject
                                        ?.get("message")?.jsonObject
                                        ?.get("content")?.jsonPrimitive?.content ?: "No response"
                                    answer.append(content)
                                } catch (e: Exception) {
                                    answer.append("Error: ${e.message?.take(80)}")
                                } finally {
                                    messages = messages + ChatMessage("assistant", answer.toString())
                                    responding = false
                                    listState.animateScrollToItem(messages.size - 1)
                                }
                            }
                        },
                        enabled = modelReady && !responding && input.isNotBlank()
                    ) {
                        if (responding) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Default.Send, "Send")
                    }
                }
            }
        }
    ) { padding ->
        if (!modelReady) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(12.dp))
                    Text("Loading Gemma 4…", style = MaterialTheme.typography.bodyMedium)
                }
            }
        } else {
            LazyColumn(state = listState, contentPadding = padding, modifier = Modifier.fillMaxSize()) {
                if (messages.isEmpty()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), Alignment.Center) {
                            Text("Ask Gemma anything about your notes",
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                items(messages) { msg ->
                    ChatBubble(msg)
                }
            }
        }
    }
}

@Composable
private fun ChatBubble(msg: ChatMessage) {
    val isUser = msg.role == "user"
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Surface(
            shape = MaterialTheme.shapes.medium,
            color = if (isUser) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.widthIn(max = 320.dp)
        ) {
            Text(msg.text, Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
        }
    }
}
