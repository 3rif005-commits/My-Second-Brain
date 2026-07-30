package com.secondbrain.tablet.data

import android.content.Context
import com.secondbrain.tablet.data.local.NotesDatabase
import com.secondbrain.tablet.data.local.NotesLocalStore
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.postgrest.from
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Top-level so @Serializable works correctly in decodeList lambdas
@Serializable
private data class ChunkMatch(
    @SerialName("note_id") val noteId: String,
    val similarity: Float = 0f,
)

private val rpcJson = Json { ignoreUnknownKeys = true }
private val rpcClient = HttpClient(Android) {
    install(ContentNegotiation) { json(rpcJson) }
}

object NotesRepository {

    private lateinit var store: NotesLocalStore
    private var cachedUserId: String? = null

    fun init(context: Context) {
        if (::store.isInitialized) return
        store = NotesLocalStore(NotesDatabase(context.applicationContext))
    }

    fun clearUserCache() { cachedUserId = null }

    private fun userId(): String {
        val fresh = supabase.auth.currentUserOrNull()?.id
        if (fresh != null) cachedUserId = fresh
        return cachedUserId ?: error("Not authenticated")
    }

    // ── Read (local-first) ────────────────────────────────────────────────

    fun listNotes(): List<Note> = store.listNotes(userId())

    fun listCollections(): List<Collection> = store.listCollections(userId())

    fun listTrashed(): List<Note> = store.listTrashed(userId())

    suspend fun searchNotes(query: String): List<Note> {
        val local = store.searchNotes(userId(), query)
        return try {
            val remote = supabase.from("notes")
                .select {
                    filter {
                        eq("user_id", userId())
                        textSearch(
                            column = "fts",
                            query  = query,
                            textSearchType = io.github.jan.supabase.postgrest.query.filter.TextSearchType.PLAINTO,
                        )
                    }
                    limit(20)
                }
                .decodeList<Note>()
                .filter { it.deletedAt == null }
            (local + remote).distinctBy { it.id }
        } catch (_: Exception) {
            local
        }
    }

    fun listBacklinks(noteId: String): List<Note> = store.findBacklinks(userId(), noteId)

    fun getNote(id: String): Note = store.getNote(id) ?: error("Note not found: $id")

    // ── Write (local-first, then push async via SyncManager) ─────────────

    suspend fun createNote(
        title: String,
        contentText: String,
        sourceType: String = "manual",
        sourceFilename: String? = null,
    ): Note {
        val uid = userId()
        val content = textToBlocknoteJson(contentText)
        val now = java.time.Instant.now().toString()
        val id = java.util.UUID.randomUUID().toString()
        val note = Note(
            id = id, userId = uid, title = title, content = content,
            contentText = contentText, sourceType = sourceType,
            sourceFilename = sourceFilename, createdAt = now, updatedAt = now,
        )
        // Save locally first — works offline, navigates instantly
        store.upsertLocal(note)
        try {
            // Push to server; our UUID travels with the insert so IDs always match
            supabase.from("notes").insert(
                NoteInsert(
                    id = id, userId = uid, title = title, content = content,
                    contentText = contentText, sourceType = sourceType,
                    sourceFilename = sourceFilename,
                )
            )
            store.markClean(id)
        } catch (_: Exception) {
            // Offline — note saved locally with dirty flag, syncs when back online
        }
        // Index for semantic search (fire-and-forget, best-effort)
        withContext(Dispatchers.IO) { indexNote(id, "$title\n$contentText") }
        return note
    }

    suspend fun updateNote(id: String, title: String, contentText: String) {
        val content = textToBlocknoteJson(contentText)
        val now = java.time.Instant.now().toString()
        val existing = store.getNote(id) ?: return
        val updated = existing.copy(
            title = title,
            content = content,
            contentText = contentText,
            updatedAt = now,
        )
        store.upsertLocal(updated)
        try {
            supabase.from("notes").update({
                set("title", title)
                set("content", content)
                set("content_text", contentText)
                set("updated_at", now)
            }) { filter { eq("id", id) } }
            store.markClean(id)
        } catch (_: Exception) { /* dirty — will sync later */ }
    }

    suspend fun updateContent(id: String, title: String, content: JsonArray, contentText: String) {
        val now = java.time.Instant.now().toString()
        val existing = store.getNote(id) ?: return
        val updated = existing.copy(
            title = title,
            content = content,
            contentText = contentText,
            updatedAt = now,
        )
        store.upsertLocal(updated)
        try {
            supabase.from("notes").update({
                set("title", title)
                set("content", content)
                set("content_text", contentText)
                set("updated_at", now)
            }) { filter { eq("id", id) } }
            store.markClean(id)
        } catch (_: Exception) { }
    }

    suspend fun updateTitle(id: String, title: String) {
        val now = java.time.Instant.now().toString()
        store.updateField(id, COL_TITLE to title, COL_UPDATED_AT to now)
        try {
            supabase.from("notes").update({
                set("title", title)
                set("updated_at", now)
            }) { filter { eq("id", id) } }
            store.markClean(id)
        } catch (_: Exception) { }
    }

    suspend fun updateFavorite(id: String, favorited: Boolean) {
        val now = java.time.Instant.now().toString()
        store.updateField(id, COL_FAVORITED to favorited, COL_UPDATED_AT to now)
        try {
            supabase.from("notes").update({
                set("is_favorited", favorited)
                set("updated_at", now)
            }) { filter { eq("id", id) } }
            store.markClean(id)
        } catch (_: Exception) { }
    }

    suspend fun updateLastViewed(id: String) {
        val now = java.time.Instant.now().toString()
        store.updateField(id, COL_LAST_VIEWED to now)
        try {
            supabase.from("notes").update({
                set("last_viewed_at", now)
            }) { filter { eq("id", id) } }
            store.markClean(id)
        } catch (_: Exception) { }
    }

    suspend fun updateIcon(id: String, icon: String) {
        val now = java.time.Instant.now().toString()
        store.updateField(id, COL_ICON to icon, COL_UPDATED_AT to now)
        try {
            supabase.from("notes").update({
                set("icon", icon)
                set("updated_at", now)
            }) { filter { eq("id", id) } }
            store.markClean(id)
        } catch (_: Exception) { }
    }

    suspend fun updateMastery(id: String, status: String) {
        val now = java.time.Instant.now().toString()
        store.updateField(id, COL_MASTERY to status, COL_UPDATED_AT to now)
        try {
            supabase.from("notes").update({
                set("mastery_status", status)
                set("updated_at", now)
            }) { filter { eq("id", id) } }
            store.markClean(id)
        } catch (_: Exception) { }
    }

    suspend fun updateTopics(id: String, topics: List<String>) {
        val now = java.time.Instant.now().toString()
        store.updateField(id, COL_TOPICS to Json.encodeToString(topics), COL_UPDATED_AT to now)
        try {
            supabase.from("notes").update({
                set("topics", topics)
                set("updated_at", now)
            }) { filter { eq("id", id) } }
            store.markClean(id)
        } catch (_: Exception) { }
    }

    suspend fun deleteNote(id: String) {
        val now = java.time.Instant.now().toString()
        store.softDelete(id, now)
        try {
            supabase.from("notes").update({
                set("deleted_at", now)
            }) { filter { eq("id", id) } }
            store.markClean(id)
        } catch (_: Exception) { /* dirty — will sync later */ }
    }

    suspend fun restoreNote(id: String) {
        store.restoreLocally(id)
        try {
            supabase.from("notes").update({
                set("deleted_at", null as String?)
            }) { filter { eq("id", id) } }
            store.markClean(id)
        } catch (_: Exception) { /* dirty — will sync later */ }
    }

    suspend fun updatePublic(id: String, isPublic: Boolean) {
        val now = java.time.Instant.now().toString()
        store.updateField(id, COL_IS_PUBLIC to isPublic, COL_UPDATED_AT to now)
        try {
            supabase.from("notes").update({
                set("is_public", isPublic)
                set("updated_at", now)
            }) { filter { eq("id", id) } }
            store.markClean(id)
        } catch (_: Exception) { }
    }

    suspend fun updatePositions(orderedIds: List<String>) {
        orderedIds.forEachIndexed { index, id ->
            try {
                supabase.from("notes").update({
                    set("position", index)
                }) { filter { eq("id", id) } }
            } catch (_: Exception) { }
        }
    }

    suspend fun permanentDelete(id: String) {
        store.markDeletedLocally(id)
        try {
            supabase.from("notes").delete { filter { eq("id", id) } }
            store.hardDelete(id)
        } catch (_: Exception) { /* will hard-delete on next sync */ }
    }

    // ── Semantic indexing (on-device 384-dim embeddings) ─────────────────

    suspend fun indexNote(noteId: String, text: String) {
        val vec = EmbeddingEngine.embed(text.take(512)) ?: return
        try {
            // upsert relies on the UNIQUE (note_id, chunk_index) DB constraint
            supabase.from("note_chunks").upsert(
                buildJsonObject {
                    put("note_id", noteId)
                    put("user_id", userId())
                    put("chunk_index", 0)
                    put("chunk_text", text.take(2000))
                    put("embedding_384", buildJsonArray { vec.forEach { add(it) } })
                }
            )
        } catch (_: Exception) { }
    }

    suspend fun semanticSearch(query: String, k: Int = 5): List<Note> {
        val vec = EmbeddingEngine.embed(query.take(512)) ?: return emptyList()
        return try {
            val uid = userId()
            val session = supabase.auth.currentSessionOrNull() ?: return emptyList()
            val body = buildJsonObject {
                put("query_embedding", buildJsonArray { vec.forEach { add(it) } })
                put("match_user_id", uid)
                put("match_count", k)
            }
            val resp = rpcClient.post("$SUPABASE_URL/rest/v1/rpc/match_chunks_384") {
                header("apikey", SUPABASE_ANON_KEY)
                header("Authorization", "Bearer ${session.accessToken}")
                contentType(ContentType.Application.Json)
                setBody(body.toString())
            }
            if (!resp.status.isSuccess()) return emptyList()
            val matches = rpcJson.decodeFromString<List<ChunkMatch>>(resp.bodyAsText())
            matches.mapNotNull { m -> runCatching { store.getNote(m.noteId) }.getOrNull() }
                .filter { it.deletedAt == null }
        } catch (_: Exception) {
            emptyList()
        }
    }

    // ── Sync ──────────────────────────────────────────────────────────────

    suspend fun sync() = SyncManager.sync(store)

    // ── Helpers ───────────────────────────────────────────────────────────

    fun textToBlocknoteJson(text: String): JsonArray = buildJsonArray {
        text.lines().filter { it.isNotBlank() }.forEach { line ->
            add(buildJsonObject {
                put("type", "paragraph")
                put("content", buildJsonArray {
                    add(buildJsonObject {
                        put("type", "text")
                        put("text", line)
                        put("styles", buildJsonObject {})
                    })
                })
                put("children", buildJsonArray {})
            })
        }
    }

    fun blocknoteToHtml(blocks: JsonArray): String {
        val sb = StringBuilder()
        for (block in blocks) {
            val obj = block as? kotlinx.serialization.json.JsonObject ?: continue
            val type = obj["type"]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } ?: continue
            val props = obj["props"] as? kotlinx.serialization.json.JsonObject
            val content = obj["content"] as? JsonArray
            val children = obj["children"] as? JsonArray
            val innerHtml = content?.joinToString("") { inline ->
                val inlineObj = inline as? kotlinx.serialization.json.JsonObject ?: return@joinToString ""
                val text = (inlineObj["text"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                val styles = inlineObj["styles"] as? kotlinx.serialization.json.JsonObject
                var html = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                val boldEl = styles?.get("bold")
                if (boldEl is kotlinx.serialization.json.JsonPrimitive && boldEl.content == "true") html = "<strong>$html</strong>"
                val italicEl = styles?.get("italic")
                if (italicEl is kotlinx.serialization.json.JsonPrimitive && italicEl.content == "true") html = "<em>$html</em>"
                val underlineEl = styles?.get("underline")
                if (underlineEl is kotlinx.serialization.json.JsonPrimitive && underlineEl.content == "true") html = "<u>$html</u>"
                html
            } ?: ""
            when (type) {
                "heading" -> {
                    val levelEl = props?.get("level")
                    val level = if (levelEl is kotlinx.serialization.json.JsonPrimitive) levelEl.content.toIntOrNull() ?: 1 else 1
                    sb.append("<h$level>$innerHtml</h$level>\n")
                }
                "bulletListItem" -> sb.append("<li>$innerHtml</li>\n")
                "numberedListItem" -> sb.append("<li>$innerHtml</li>\n")
                else -> sb.append("<p>$innerHtml</p>\n")
            }
            if (children != null && children.isNotEmpty()) {
                sb.append("<div style='margin-left:20px'>")
                sb.append(blocknoteToHtml(children))
                sb.append("</div>")
            }
        }
        return sb.toString()
    }

    // Column name constants used in updateField
    private const val COL_TITLE       = "title"
    private const val COL_ICON        = "icon"
    private const val COL_UPDATED_AT  = "updated_at"
    private const val COL_LAST_VIEWED = "last_viewed_at"
    private const val COL_FAVORITED   = "is_favorited"
    private const val COL_MASTERY     = "mastery_status"
    private const val COL_TOPICS      = "topics_json"
    private const val COL_IS_PUBLIC   = "is_public"
}
