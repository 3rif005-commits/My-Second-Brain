package com.secondbrain.tablet.editor

sealed class CursorTarget {
    data object Start : CursorTarget()
    data object End : CursorTarget()
    data class At(val offset: Int) : CursorTarget()
}

data class SlashMenuState(
    val blockId: String,
    val query: String,
    val anchorX: Float = 0f,
    val anchorY: Float = 0f,
    val highlightIndex: Int = 0,
)

data class MentionMenuState(
    val blockId: String,
    val query: String,
    val anchorX: Float = 0f,
    val anchorY: Float = 0f,
    val highlightIndex: Int = 0,
)
