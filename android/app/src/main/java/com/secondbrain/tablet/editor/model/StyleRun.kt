package com.secondbrain.tablet.editor.model

data class StyleRun(
    val start: Int,
    val end: Int,
    val styles: InlineStyles,
)

data class MentionAnchor(
    val start: Int,
    val end: Int,
    val noteId: String,
    val noteName: String,
)
