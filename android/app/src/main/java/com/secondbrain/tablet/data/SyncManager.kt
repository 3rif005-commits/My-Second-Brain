package com.secondbrain.tablet.data

import com.secondbrain.tablet.data.local.NotesLocalStore
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray

/** Minimal payload for upserting a note back to Supabase. */
@Serializable
data class NoteUpsert(
    val id: String,
    @SerialName("user_id") val userId: String,
    val title: String,
    val icon: String,
    val content: JsonArray,
    @SerialName("content_text") val contentText: String?,
    @SerialName("source_type") val sourceType: String?,
    @SerialName("source_filename") val sourceFilename: String?,
    val topics: List<String>,
    @SerialName("mastery_status") val masteryStatus: String,
    @SerialName("is_favorited") val isFavorited: Boolean,
    @SerialName("is_public") val isPublic: Boolean,
    @SerialName("updated_at") val updatedAt: String,
    @SerialName("deleted_at") val deletedAt: String? = null,
)

object SyncManager {

    /**
     * Full bidirectional sync:
     * 1. Push locally-deleted notes to server
     * 2. Push dirty (locally-modified) notes to server
     * 3. Pull all server notes and merge (last-write-wins by updated_at)
     */
    suspend fun sync(store: NotesLocalStore) {
        val userId = supabase.auth.currentUserOrNull()?.id ?: return

        // 1. Push deletions
        val deletedIds = store.getDeletedLocally(userId)
        for (id in deletedIds) {
            try {
                supabase.from("notes").delete { filter { eq("id", id) } }
                store.hardDelete(id)
            } catch (_: Exception) { /* keep it locally deleted, retry next sync */ }
        }

        // 2. Push dirty notes
        val dirty = store.getDirtyNotes(userId)
        for (note in dirty) {
            try {
                val upsert = note.toUpsert()
                supabase.from("notes").upsert(upsert)
                store.markClean(note.id)
            } catch (_: Exception) { /* keep dirty, retry next sync */ }
        }

        // 3. Pull server notes → merge into local
        val serverNotes = supabase.from("notes").select {
            filter { eq("user_id", userId) }
            order("updated_at", Order.DESCENDING)
        }.decodeList<Note>()

        for (serverNote in serverNotes) {
            store.upsertFromServer(serverNote)
        }

        // 4. Pull collections → replace local cache
        try {
            val serverCollections = supabase.from("collections").select {
                filter { eq("user_id", userId) }
                order("position", Order.ASCENDING)
            }.decodeList<Collection>()

            for (c in serverCollections) {
                store.upsertCollection(c)
            }
            store.deleteCollectionsNotIn(userId, serverCollections.map { it.id }.toSet())
        } catch (_: Exception) { /* offline — use cached collections */ }
    }

    private fun Note.toUpsert() = NoteUpsert(
        id             = id,
        userId         = userId,
        title          = title,
        icon           = icon,
        content        = content,
        contentText    = contentText,
        sourceType     = sourceType,
        sourceFilename = sourceFilename,
        topics         = topics,
        masteryStatus  = masteryStatus,
        isFavorited    = isFavorited,
        isPublic       = isPublic,
        updatedAt      = updatedAt,
        deletedAt      = deletedAt,
    )
}
