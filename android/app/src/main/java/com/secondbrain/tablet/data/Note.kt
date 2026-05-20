package com.secondbrain.tablet.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray

@Serializable
data class Note(
    val id: String = "",
    @SerialName("user_id") val userId: String = "",
    val title: String = "Untitled",
    val icon: String = "📄",
    val content: JsonArray = JsonArray(emptyList()),
    @SerialName("content_text") val contentText: String? = null,
    @SerialName("source_type") val sourceType: String? = null,
    @SerialName("source_filename") val sourceFilename: String? = null,
    val topics: List<String> = emptyList(),
    @SerialName("mastery_status") val masteryStatus: String = "not_started",
    @SerialName("is_favorited") val isFavorited: Boolean = false,
    @SerialName("last_viewed_at") val lastViewedAt: String? = null,
    @SerialName("is_public") val isPublic: Boolean = false,
    @SerialName("deleted_at") val deletedAt: String? = null,
    // Extra DB columns — not used in UI but must be present to avoid unknown-key errors
    @SerialName("collection_id") val collectionId: String? = null,
    @SerialName("source_url") val sourceUrl: String? = null,
    val position: Int? = null,
    @SerialName("cover_image_url") val coverImageUrl: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    // Generated tsvector column from migration 006 — PostgREST includes it in SELECT *
    val fts: String? = null,
)

@Serializable
data class NoteInsert(
    val id: String,             // Client-generated UUID so local and server IDs always match
    @SerialName("user_id") val userId: String,
    val title: String,
    val content: JsonArray,
    @SerialName("content_text") val contentText: String,
    @SerialName("source_type") val sourceType: String = "manual",
    @SerialName("source_filename") val sourceFilename: String? = null,
    val topics: List<String> = emptyList(),
)
