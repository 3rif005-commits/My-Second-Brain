package com.secondbrain.tablet.editor.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.unit.dp
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.model.BlockType
import com.secondbrain.tablet.editor.ui.blocks.BulletListBlock
import com.secondbrain.tablet.editor.ui.blocks.CalloutBlock
import com.secondbrain.tablet.editor.ui.blocks.CheckListBlock
import com.secondbrain.tablet.editor.ui.blocks.CodeBlock
import com.secondbrain.tablet.editor.ui.blocks.DividerBlock
import com.secondbrain.tablet.editor.ui.blocks.HeadingBlock
import com.secondbrain.tablet.editor.ui.blocks.InteractiveBlock
import com.secondbrain.tablet.editor.ui.blocks.NumberedListBlock
import com.secondbrain.tablet.editor.ui.blocks.ParagraphBlock
import com.secondbrain.tablet.editor.ui.blocks.QuoteBlock
import com.secondbrain.tablet.editor.ui.blocks.ToggleBlock
import com.secondbrain.tablet.editor.ui.handle.BlockHandle
import androidx.compose.material3.MaterialTheme
import com.secondbrain.tablet.ui.theme.Indigo500

@Composable
fun BlockRow(
    block: BlockState,
    vm: DocumentViewModel,
    isDragging: Boolean = false,
    handleModifier: Modifier = Modifier,
    modifier: Modifier = Modifier,
) {
    // derivedStateOf: only recomposes when THIS block's selection changes,
    // not when any other block is selected/deselected.
    val isSelected by remember(block.id) { derivedStateOf { vm.selectedBlockId == block.id } }
    val bgColor = EditorColors.blockBackground(block.color)

    val rowBg = when {
        isDragging -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.96f)
        isSelected -> Indigo500.copy(alpha = 0.07f)
        else       -> bgColor
    }

    // Plain Row — no height(IntrinsicSize.Min).
    // IntrinsicSize.Min forced 2 layout passes per item which was very expensive in a long list.
    // The handle no longer uses fillMaxHeight(), so no intrinsic measurement is needed.
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(rowBg)
            .then(if (isDragging) Modifier.shadow(4.dp) else Modifier)
            .padding(vertical = 1.dp),
    ) {
        BlockHandle(
            block = block,
            vm = vm,
            handleModifier = handleModifier,
        )

        Box(
            modifier = Modifier
                .weight(1f)
                .padding(
                    start = (block.indentLevel * 24).dp,
                    end = 16.dp,
                    top = 2.dp,
                    bottom = 2.dp,
                ),
        ) {
            when (block.type) {
                BlockType.Paragraph        -> ParagraphBlock(block = block, vm = vm)
                BlockType.H1,
                BlockType.H2,
                BlockType.H3              -> HeadingBlock(block = block, vm = vm)
                BlockType.ToggleH1,
                BlockType.ToggleH2,
                BlockType.ToggleH3,
                BlockType.ToggleListItem  -> ToggleBlock(block = block, vm = vm)
                BlockType.BulletListItem   -> BulletListBlock(block = block, vm = vm)
                BlockType.NumberedListItem -> NumberedListBlock(block = block, vm = vm)
                BlockType.CheckListItem    -> CheckListBlock(block = block, vm = vm)
                BlockType.Quote            -> QuoteBlock(block = block, vm = vm)
                BlockType.CodeBlock        -> CodeBlock(block = block, vm = vm)
                BlockType.Divider          -> DividerBlock(modifier = Modifier.fillMaxWidth())
                BlockType.Callout          -> CalloutBlock(block = block, vm = vm)
                BlockType.Interactive      -> InteractiveBlock(block = block, onSetHtml = { html -> vm.setBlockHtml(block.id, html) })
            }
        }
    }
}
