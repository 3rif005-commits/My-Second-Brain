package com.secondbrain.tablet.editor.model

import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import kotlinx.serialization.json.JsonArray

class BlockState(
    val id: String,
    type: BlockType,
    color: BlockColor = BlockColor.Default,
    checked: Boolean = false,
    isToggleOpen: Boolean = true,
    calloutEmoji: String = "💡",
    calloutColor: CalloutColor = CalloutColor.Blue,
    indentLevel: Int = 0,
    initialText: String = "",
    initialStyles: List<StyleRun> = emptyList(),
    initialMentions: List<MentionAnchor> = emptyList(),
    initialBody: BlockState? = null,
    val rawChildren: JsonArray = JsonArray(emptyList()),
    htmlContent: String = "",       // for Interactive blocks only
) {
    var type by mutableStateOf(type)
    var htmlContent by mutableStateOf(htmlContent)
    var color by mutableStateOf(color)
    var checked by mutableStateOf(checked)
    var isToggleOpen by mutableStateOf(isToggleOpen)
    var calloutEmoji by mutableStateOf(calloutEmoji)
    var calloutColor by mutableStateOf(calloutColor)
    var indentLevel by mutableStateOf(indentLevel)
    var bodyBlock: BlockState? by mutableStateOf(initialBody)

    val textState: TextFieldState = TextFieldState(initialText)
    val styles: SnapshotStateList<StyleRun> = mutableStateListOf<StyleRun>().also {
        if (initialStyles.isNotEmpty()) it.addAll(initialStyles)
    }
    val mentions: SnapshotStateList<MentionAnchor> = mutableStateListOf<MentionAnchor>().also {
        if (initialMentions.isNotEmpty()) it.addAll(initialMentions)
    }
    var pendingMarks by mutableStateOf(InlineStyles.NONE)
}
