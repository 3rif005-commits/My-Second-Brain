package com.secondbrain.tablet.editor.model

import kotlinx.serialization.json.JsonArray

data class BlockModel(
    val type: BlockType,
    val color: BlockColor = BlockColor.Default,
    val content: List<InlineSpan> = emptyList(),
    val children: List<BlockModel> = emptyList(),     // toggle body only
    val rawChildren: JsonArray = JsonArray(emptyList()), // non-toggle children, preserved verbatim
    val checked: Boolean = false,
    val isToggleable: Boolean = false,
    val isToggleOpen: Boolean = true,
    val calloutEmoji: String = "💡",
    val calloutColor: CalloutColor = CalloutColor.Blue,
    val indentLevel: Int = 0,
    val htmlContent: String = "",   // for Interactive blocks only
)
