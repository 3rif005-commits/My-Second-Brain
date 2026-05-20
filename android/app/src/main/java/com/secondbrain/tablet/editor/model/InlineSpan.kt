package com.secondbrain.tablet.editor.model

sealed interface InlineSpan {
    data class Text(
        val text: String,
        val styles: InlineStyles = InlineStyles.NONE,
        val href: String? = null,
    ) : InlineSpan

    data class Mention(
        val noteId: String,
        val noteName: String,
    ) : InlineSpan
}

data class InlineStyles(
    val bold: Boolean = false,
    val italic: Boolean = false,
    val underline: Boolean = false,
    val strike: Boolean = false,
) {
    companion object {
        val NONE = InlineStyles()
    }
}
