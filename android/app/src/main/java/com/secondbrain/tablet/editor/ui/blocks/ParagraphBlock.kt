package com.secondbrain.tablet.editor.ui.blocks

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.ui.EditorTypography

@Composable
fun ParagraphBlock(
    block: BlockState,
    vm: DocumentViewModel,
    modifier: Modifier = Modifier,
) {
    BlockTextField(
        block = block,
        vm = vm,
        textStyle = EditorTypography.Body,
        placeholder = "Type something…",
        modifier = modifier,
    )
}
