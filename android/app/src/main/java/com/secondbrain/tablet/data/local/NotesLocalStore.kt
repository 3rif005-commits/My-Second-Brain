package com.secondbrain.tablet.data.local

import android.content.ContentValues
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import com.secondbrain.tablet.data.Collection
import com.secondbrain.tablet.data.Note
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COLL_COLOR
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COLL_CREATED_AT
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COLL_ICON
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COLL_ID
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COLL_NAME
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COLL_PARENT_ID
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COLL_POSITION
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COLL_TABLE
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COLL_UPDATED_AT
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COLL_USER_ID
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_COLLECTION_ID
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_CONTENT_JSON
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_CONTENT_TEXT
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_CREATED_AT
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_DELETED_AT
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_DELETED_LOCALLY
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_DIRTY
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_ICON
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_ID
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_IS_FAVORITED
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_IS_PUBLIC
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_LAST_VIEWED_AT
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_MASTERY_STATUS
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_SOURCE_FILENAME
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_SOURCE_TYPE
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_TITLE
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_TOPICS_JSON
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_UPDATED_AT
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.COL_USER_ID
import com.secondbrain.tablet.data.local.NotesDatabase.Companion.TABLE
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray

class NotesLocalStore(private val db: NotesDatabase) {

    private val json = Json { ignoreUnknownKeys = true }

    // ── Queries ───────────────────────────────────────────────────────────

    fun listNotes(userId: String): List<Note> {
        val cursor = db.readableDatabase.query(
            TABLE, null,
            "$COL_USER_ID = ? AND $COL_DELETED_LOCALLY = 0 AND $COL_DELETED_AT IS NULL",
            arrayOf(userId), null, null,
            "$COL_UPDATED_AT DESC",
        )
        return cursor.use { it.toNoteList() }
    }

    fun listTrashed(userId: String): List<Note> {
        val cursor = db.readableDatabase.query(
            TABLE, null,
            "$COL_USER_ID = ? AND $COL_DELETED_AT IS NOT NULL AND $COL_DELETED_LOCALLY = 0",
            arrayOf(userId), null, null,
            "$COL_DELETED_AT DESC",
        )
        return cursor.use { it.toNoteList() }
    }

    fun searchNotes(userId: String, query: String): List<Note> {
        val like = "%${query.lowercase()}%"
        val cursor = db.readableDatabase.query(
            TABLE, null,
            "$COL_USER_ID = ? AND $COL_DELETED_LOCALLY = 0 AND $COL_DELETED_AT IS NULL " +
            "AND (LOWER($COL_TITLE) LIKE ? OR LOWER($COL_CONTENT_TEXT) LIKE ?)",
            arrayOf(userId, like, like), null, null,
            "$COL_UPDATED_AT DESC", "20",
        )
        return cursor.use { it.toNoteList() }
    }

    fun findBacklinks(userId: String, noteId: String): List<Note> {
        val cursor = db.readableDatabase.query(
            TABLE, null,
            "$COL_USER_ID = ? AND $COL_DELETED_LOCALLY = 0 AND $COL_DELETED_AT IS NULL AND $COL_CONTENT_JSON LIKE ?",
            arrayOf(userId, "%$noteId%"), null, null,
            "$COL_UPDATED_AT DESC",
        )
        return cursor.use { it.toNoteList() }
    }

    fun getNote(id: String): Note? {
        val cursor = db.readableDatabase.query(
            TABLE, null,
            "$COL_ID = ? AND $COL_DELETED_LOCALLY = 0",
            arrayOf(id), null, null, null, "1",
        )
        return cursor.use { if (it.moveToFirst()) it.toNote() else null }
    }

    fun getDirtyNotes(userId: String): List<Note> {
        val cursor = db.readableDatabase.query(
            TABLE, null,
            "$COL_USER_ID = ? AND $COL_DIRTY = 1 AND $COL_DELETED_LOCALLY = 0",
            arrayOf(userId), null, null, null,
        )
        return cursor.use { it.toNoteList() }
    }

    fun getDeletedLocally(userId: String): List<String> {
        val cursor = db.readableDatabase.query(
            TABLE, arrayOf(COL_ID),
            "$COL_USER_ID = ? AND $COL_DELETED_LOCALLY = 1",
            arrayOf(userId), null, null, null,
        )
        return cursor.use {
            buildList {
                while (it.moveToNext()) add(it.getString(0))
            }
        }
    }

    // ── Writes ────────────────────────────────────────────────────────────

    /** Insert or replace a note coming from Supabase (not dirty). */
    fun upsertFromServer(note: Note) {
        val existing = getNote(note.id)
        // If we have a dirty local version that's newer, don't overwrite content
        if (existing != null && existing.dirty && existing.updatedAt > note.updatedAt) return
        db.writableDatabase.insertWithOnConflict(
            TABLE, null, note.toContentValues(dirty = 0, deletedLocally = 0),
            android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    /** Insert or update a note that was modified locally (marks dirty). */
    fun upsertLocal(note: Note) {
        db.writableDatabase.insertWithOnConflict(
            TABLE, null, note.toContentValues(dirty = 1, deletedLocally = 0),
            android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    fun markClean(id: String) {
        val cv = ContentValues().apply { put(COL_DIRTY, 0) }
        db.writableDatabase.update(TABLE, cv, "$COL_ID = ?", arrayOf(id))
    }

    fun softDelete(id: String, deletedAt: String) {
        val cv = ContentValues().apply {
            put(COL_DELETED_AT, deletedAt)
            put(COL_DIRTY, 1)
        }
        db.writableDatabase.update(TABLE, cv, "$COL_ID = ?", arrayOf(id))
    }

    fun restoreLocally(id: String) {
        val cv = ContentValues().apply {
            putNull(COL_DELETED_AT)
            put(COL_DIRTY, 1)
        }
        db.writableDatabase.update(TABLE, cv, "$COL_ID = ?", arrayOf(id))
    }

    fun markDeletedLocally(id: String) {
        val cv = ContentValues().apply { put(COL_DELETED_LOCALLY, 1) }
        db.writableDatabase.update(TABLE, cv, "$COL_ID = ?", arrayOf(id))
    }

    fun hardDelete(id: String) {
        db.writableDatabase.delete(TABLE, "$COL_ID = ?", arrayOf(id))
    }

    fun updateField(id: String, vararg pairs: Pair<String, Any?>) {
        val cv = ContentValues()
        for ((col, value) in pairs) {
            when (value) {
                is String  -> cv.put(col, value)
                is Boolean -> cv.put(col, if (value) 1 else 0)
                is Int     -> cv.put(col, value)
                null       -> cv.putNull(col)
            }
        }
        cv.put(COL_DIRTY, 1)
        db.writableDatabase.update(TABLE, cv, "$COL_ID = ?", arrayOf(id))
    }

    // ── Cursor helpers ────────────────────────────────────────────────────

    private fun Cursor.toNoteList(): List<Note> = buildList {
        while (moveToNext()) add(toNote())
    }

    private fun Cursor.toNote(): Note {
        fun str(col: String) = getString(getColumnIndexOrThrow(col))
        fun strOrNull(col: String): String? = getString(getColumnIndexOrThrow(col))
        fun int(col: String) = getInt(getColumnIndexOrThrow(col))
        val contentRaw = str(COL_CONTENT_JSON)
        val contentJson = try {
            json.decodeFromString<JsonArray>(contentRaw)
        } catch (_: Exception) { JsonArray(emptyList()) }
        val topicsRaw = str(COL_TOPICS_JSON)
        val topics = try {
            json.decodeFromString<List<String>>(topicsRaw)
        } catch (_: Exception) { emptyList() }
        return Note(
            id             = str(COL_ID),
            userId         = str(COL_USER_ID),
            title          = str(COL_TITLE),
            icon           = str(COL_ICON),
            content        = contentJson,
            contentText    = strOrNull(COL_CONTENT_TEXT),
            sourceType     = strOrNull(COL_SOURCE_TYPE),
            sourceFilename = strOrNull(COL_SOURCE_FILENAME),
            topics         = topics,
            masteryStatus  = str(COL_MASTERY_STATUS),
            isFavorited    = int(COL_IS_FAVORITED) != 0,
            lastViewedAt   = strOrNull(COL_LAST_VIEWED_AT),
            isPublic       = int(COL_IS_PUBLIC) != 0,
            deletedAt      = strOrNull(COL_DELETED_AT),
            createdAt      = str(COL_CREATED_AT),
            updatedAt      = str(COL_UPDATED_AT),
            collectionId   = strOrNull(COL_COLLECTION_ID),
        )
    }

    private fun Note.toContentValues(dirty: Int, deletedLocally: Int) = ContentValues().apply {
        put(COL_ID,              id)
        put(COL_USER_ID,         userId)
        put(COL_TITLE,           title)
        put(COL_ICON,            icon)
        put(COL_CONTENT_JSON,    json.encodeToString(content))
        put(COL_CONTENT_TEXT,    contentText)
        put(COL_SOURCE_TYPE,     sourceType)
        put(COL_SOURCE_FILENAME, sourceFilename)
        put(COL_TOPICS_JSON,     json.encodeToString(topics))
        put(COL_MASTERY_STATUS,  masteryStatus)
        put(COL_IS_FAVORITED,    if (isFavorited) 1 else 0)
        put(COL_LAST_VIEWED_AT,  lastViewedAt)
        put(COL_IS_PUBLIC,       if (isPublic) 1 else 0)
        put(COL_DELETED_AT,      deletedAt)
        put(COL_CREATED_AT,      createdAt)
        put(COL_UPDATED_AT,      updatedAt)
        put(COL_DIRTY,           dirty)
        put(COL_DELETED_LOCALLY, deletedLocally)
        put(COL_COLLECTION_ID,   collectionId)
    }

    // ── Collections ───────────────────────────────────────────────────────

    fun listCollections(userId: String): List<Collection> {
        val cursor = db.readableDatabase.query(
            COLL_TABLE, null,
            "$COLL_USER_ID = ?",
            arrayOf(userId), null, null,
            "$COLL_POSITION ASC",
        )
        return cursor.use {
            buildList {
                while (it.moveToNext()) {
                    fun str(col: String) = it.getString(it.getColumnIndexOrThrow(col))
                    fun strOrNull(col: String): String? = it.getString(it.getColumnIndexOrThrow(col))
                    add(Collection(
                        id        = str(COLL_ID),
                        userId    = str(COLL_USER_ID),
                        parentId  = strOrNull(COLL_PARENT_ID),
                        name      = str(COLL_NAME),
                        icon      = str(COLL_ICON),
                        color     = str(COLL_COLOR),
                        position  = it.getInt(it.getColumnIndexOrThrow(COLL_POSITION)),
                        createdAt = str(COLL_CREATED_AT),
                        updatedAt = str(COLL_UPDATED_AT),
                    ))
                }
            }
        }
    }

    fun upsertCollection(c: Collection) {
        val cv = ContentValues().apply {
            put(COLL_ID,         c.id)
            put(COLL_USER_ID,    c.userId)
            put(COLL_PARENT_ID,  c.parentId)
            put(COLL_NAME,       c.name)
            put(COLL_ICON,       c.icon)
            put(COLL_COLOR,      c.color)
            put(COLL_POSITION,   c.position)
            put(COLL_CREATED_AT, c.createdAt)
            put(COLL_UPDATED_AT, c.updatedAt)
        }
        db.writableDatabase.insertWithOnConflict(
            COLL_TABLE, null, cv,
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    fun deleteCollectionsNotIn(userId: String, keepIds: Set<String>) {
        if (keepIds.isEmpty()) {
            db.writableDatabase.delete(COLL_TABLE, "$COLL_USER_ID = ?", arrayOf(userId))
            return
        }
        val placeholders = keepIds.joinToString(",") { "?" }
        db.writableDatabase.delete(
            COLL_TABLE,
            "$COLL_USER_ID = ? AND $COLL_ID NOT IN ($placeholders)",
            arrayOf(userId, *keepIds.toTypedArray()),
        )
    }

    // Expose dirty flag for internal checks
    private val Note.dirty: Boolean get() {
        val cursor = db.readableDatabase.query(
            TABLE, arrayOf(COL_DIRTY),
            "$COL_ID = ?", arrayOf(id), null, null, null, "1",
        )
        return cursor.use { it.moveToFirst() && it.getInt(0) != 0 }
    }
}
