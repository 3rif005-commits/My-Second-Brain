package com.secondbrain.tablet.data.local

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class NotesDatabase(context: Context) :
    SQLiteOpenHelper(context, "second_brain.db", null, DB_VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(CREATE_NOTES_TABLE)
        db.execSQL(CREATE_COLLECTIONS_TABLE)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE $TABLE ADD COLUMN $COL_COLLECTION_ID TEXT")
            db.execSQL(CREATE_COLLECTIONS_TABLE)
        }
    }

    companion object {
        const val DB_VERSION = 2

        // ── Notes table ───────────────────────────────────────────────────
        const val TABLE               = "notes"
        const val COL_ID              = "id"
        const val COL_USER_ID         = "user_id"
        const val COL_TITLE           = "title"
        const val COL_ICON            = "icon"
        const val COL_CONTENT_JSON    = "content_json"
        const val COL_CONTENT_TEXT    = "content_text"
        const val COL_SOURCE_TYPE     = "source_type"
        const val COL_SOURCE_FILENAME = "source_filename"
        const val COL_TOPICS_JSON     = "topics_json"
        const val COL_MASTERY_STATUS  = "mastery_status"
        const val COL_IS_FAVORITED    = "is_favorited"
        const val COL_LAST_VIEWED_AT  = "last_viewed_at"
        const val COL_IS_PUBLIC       = "is_public"
        const val COL_DELETED_AT      = "deleted_at"
        const val COL_CREATED_AT      = "created_at"
        const val COL_UPDATED_AT      = "updated_at"
        const val COL_DIRTY           = "dirty"
        const val COL_DELETED_LOCALLY = "deleted_locally"
        const val COL_COLLECTION_ID   = "collection_id"

        private val CREATE_NOTES_TABLE = """
            CREATE TABLE IF NOT EXISTS $TABLE (
                $COL_ID              TEXT PRIMARY KEY,
                $COL_USER_ID         TEXT NOT NULL,
                $COL_TITLE           TEXT NOT NULL DEFAULT 'Untitled',
                $COL_ICON            TEXT NOT NULL DEFAULT '📄',
                $COL_CONTENT_JSON    TEXT NOT NULL DEFAULT '[]',
                $COL_CONTENT_TEXT    TEXT,
                $COL_SOURCE_TYPE     TEXT,
                $COL_SOURCE_FILENAME TEXT,
                $COL_TOPICS_JSON     TEXT NOT NULL DEFAULT '[]',
                $COL_MASTERY_STATUS  TEXT NOT NULL DEFAULT 'not_started',
                $COL_IS_FAVORITED    INTEGER NOT NULL DEFAULT 0,
                $COL_LAST_VIEWED_AT  TEXT,
                $COL_IS_PUBLIC       INTEGER NOT NULL DEFAULT 0,
                $COL_DELETED_AT      TEXT,
                $COL_CREATED_AT      TEXT NOT NULL DEFAULT '',
                $COL_UPDATED_AT      TEXT NOT NULL DEFAULT '',
                $COL_DIRTY           INTEGER NOT NULL DEFAULT 0,
                $COL_DELETED_LOCALLY INTEGER NOT NULL DEFAULT 0,
                $COL_COLLECTION_ID   TEXT
            )
        """.trimIndent()

        // ── Collections table ─────────────────────────────────────────────
        const val COLL_TABLE      = "collections"
        const val COLL_ID         = "id"
        const val COLL_USER_ID    = "user_id"
        const val COLL_PARENT_ID  = "parent_id"
        const val COLL_NAME       = "name"
        const val COLL_ICON       = "icon"
        const val COLL_COLOR      = "color"
        const val COLL_POSITION   = "position"
        const val COLL_CREATED_AT = "created_at"
        const val COLL_UPDATED_AT = "updated_at"

        val CREATE_COLLECTIONS_TABLE = """
            CREATE TABLE IF NOT EXISTS $COLL_TABLE (
                $COLL_ID         TEXT PRIMARY KEY,
                $COLL_USER_ID    TEXT NOT NULL,
                $COLL_PARENT_ID  TEXT,
                $COLL_NAME       TEXT NOT NULL DEFAULT 'Untitled',
                $COLL_ICON       TEXT NOT NULL DEFAULT '📁',
                $COLL_COLOR      TEXT NOT NULL DEFAULT '#6366f1',
                $COLL_POSITION   INTEGER NOT NULL DEFAULT 0,
                $COLL_CREATED_AT TEXT NOT NULL DEFAULT '',
                $COLL_UPDATED_AT TEXT NOT NULL DEFAULT ''
            )
        """.trimIndent()
    }
}
