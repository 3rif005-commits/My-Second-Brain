package com.secondbrain.tablet

import android.app.*
import android.content.Intent
import android.os.IBinder
import com.secondbrain.tablet.llama.LlamaJNI
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.cio.*
import io.ktor.server.engine.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import java.net.NetworkInterface

class LlmService : Service() {

    companion object {
        const val PORT = 8082
        const val CHANNEL_ID = "llm_server_channel"
        const val NOTIFICATION_ID = 1
        const val ACTION_STATUS = "com.secondbrain.tablet.STATUS"
        const val EXTRA_STATUS = "status"
        const val EXTRA_ADDRESS = "address"

        @Volatile var isRunning = false
        @Volatile var statusText = "Not started"
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val llmMutex = Mutex()
    private var server: ApplicationEngine? = null
    private var modelLoaded = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val modelPath = intent?.getStringExtra("model_path") ?: return START_NOT_STICKY
        startForeground(NOTIFICATION_ID, buildNotification(if (isRunning) statusText else "Starting…"))

        // Guard: onStart() fires every time the activity comes to foreground.
        if (server != null || modelLoaded) return START_STICKY

        serviceScope.launch {
            try {
                broadcast("Loading model…")
                android.util.Log.i("LlmService", "Loading GGUF model: $modelPath")

                val ok = LlamaJNI.llamaLoad(modelPath, 4096)
                if (!ok) throw IllegalStateException("llamaLoad returned false — check model path and format")
                modelLoaded = true

                val backend = LlamaJNI.llamaGetBackend()
                android.util.Log.i("LlmService", "Model loaded. Backend: $backend")

                broadcast("Starting HTTP server on :$PORT")
                server = embeddedServer(CIO, port = PORT, host = "0.0.0.0") {
                    install(ContentNegotiation) { json() }
                    routing {
                        get("/health") { call.respondText("ok") }
                        post("/v1/chat/completions") { handleCompletion(call) }
                    }
                }.start(wait = false)

                isRunning = true
                val addr = localIp()?.let { "http://$it:$PORT" } ?: "http://0.0.0.0:$PORT"
                broadcast("Ready [$backend] — :$PORT", addr)

            } catch (e: Throwable) {
                isRunning = false
                android.util.Log.e("LlmService", "Startup failed", e)
                broadcast("Error: ${e.message?.take(120)}")
            }
        }

        return START_STICKY
    }

    // ── Request handler ────────────────────────────────────────────────────

    private suspend fun handleCompletion(call: ApplicationCall) {
        val body = runCatching { call.receive<JsonObject>() }.getOrElse {
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to "invalid JSON"))
            return
        }
        val messages = body["messages"]?.jsonArray ?: run {
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to "messages required"))
            return
        }
        val prompt = buildGemmaPrompt(messages)

        llmMutex.withLock {
            if (!modelLoaded) {
                call.respond(HttpStatusCode.ServiceUnavailable, mapOf("error" to "model not loaded"))
                return
            }
            val id = "chatcmpl-${System.currentTimeMillis()}"
            val text = runCatching {
                withContext(Dispatchers.IO) {
                    LlamaJNI.llamaGenerate(prompt, 2048)
                        .removeSuffix("<end_of_turn>").trim()
                }
            }.getOrElse { e ->
                android.util.Log.e("LlmService", "Inference error", e)
                call.respond(HttpStatusCode.InternalServerError,
                    buildJsonObject { put("error", e.message ?: "inference failed") })
                return
            }
            call.respond(buildJsonObject {
                put("id", id)
                put("object", "chat.completion")
                put("choices", buildJsonArray {
                    add(buildJsonObject {
                        put("index", 0)
                        put("message", buildJsonObject {
                            put("role", "assistant")
                            put("content", text)
                        })
                        put("finish_reason", "stop")
                    })
                })
            })
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private fun buildGemmaPrompt(messages: JsonArray): String {
        val sb = StringBuilder()
        var pendingSystem = ""
        for (el in messages) {
            val obj = el.jsonObject
            val role    = obj["role"]?.jsonPrimitive?.content    ?: continue
            val content = obj["content"]?.jsonPrimitive?.content ?: continue
            when (role) {
                "system" -> pendingSystem = content
                "user" -> {
                    sb.append("<start_of_turn>user\n")
                    if (pendingSystem.isNotEmpty()) {
                        sb.append(pendingSystem).append("\n\n")
                        pendingSystem = ""
                    }
                    sb.append(content).append("<end_of_turn>\n")
                }
                "assistant" -> {
                    sb.append("<start_of_turn>model\n")
                    sb.append(content).append("<end_of_turn>\n")
                }
            }
        }
        sb.append("<start_of_turn>model\n")
        return sb.toString()
    }

    private fun localIp(): String? = runCatching {
        NetworkInterface.getNetworkInterfaces().asSequence()
            .flatMap { it.inetAddresses.asSequence() }
            .firstOrNull { !it.isLoopbackAddress && it.hostAddress?.contains(':') == false }
            ?.hostAddress
    }.getOrNull()

    private fun broadcast(status: String, address: String = "") {
        statusText = status
        updateNotification(status)
        sendBroadcast(Intent(ACTION_STATUS).apply {
            putExtra(EXTRA_STATUS, status)
            putExtra(EXTRA_ADDRESS, address)
        })
    }

    private fun createNotificationChannel() {
        val ch = NotificationChannel(CHANNEL_ID, "LLM Server", NotificationManager.IMPORTANCE_LOW)
        ch.description = "Second Brain tablet inference server"
        getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    private fun buildNotification(text: String): Notification =
        Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("⚡ Second Brain — LLM Server")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .build()

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        modelLoaded = false
        serviceScope.cancel()
        server?.stop(1000, 5000)
        LlamaJNI.llamaFree()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
