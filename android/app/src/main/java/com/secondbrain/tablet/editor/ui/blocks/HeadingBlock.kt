package com.secondbrain.tablet.editor.ui.blocks

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.model.BlockType
import com.secondbrain.tablet.editor.ui.EditorTypography

@Composable
fun HeadingBlock(
    block: BlockState,
    vm: DocumentViewModel,
    modifier: Modifier = Modifier,
) {
    val style = when (block.type) {
        BlockType.H1, BlockType.ToggleH1 -> EditorTypography.H1
        BlockType.H2, BlockType.ToggleH2 -> EditorTypography.H2
        else -> EditorTypography.H3
    }
    val placeholder = when (block.type) {
        BlockType.H1, BlockType.ToggleH1 -> "Heading 1"
        BlockType.H2, BlockType.ToggleH2 -> "Heading 2"
        else -> "Heading 3"
    }
    BlockTextField(block = block, vm = vm, textStyle = style, placeholder = placeholder, modifier = modifier)
}
