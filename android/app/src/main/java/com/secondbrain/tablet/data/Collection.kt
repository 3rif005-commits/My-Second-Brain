package com.secondbrain.tablet.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Collection(
    val id: String = "",
    @SerialName("user_id") val userId: String = "",
    @SerialName("parent_id") val parentId: String? = null,
    val name: String = "Untitled",
    val icon: String = "📁",
    val color: String = "#6366f1",
    val position: Int = 0,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)
