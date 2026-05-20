package com.secondbrain.tablet.editor.ui.blocks

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.unit.dp
import com.secondbrain.tablet.editor.CursorTarget
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.model.BlockType
import com.secondbrain.tablet.editor.ui.EditorTypography
import com.secondbrain.tablet.ui.theme.Slate400
import kotlinx.coroutines.flow.drop
import java.util.UUID

@Composable
fun ToggleBlock(
    block: BlockState,
    vm: DocumentViewModel,
    modifier: Modifier = Modifier,
) {
    val isOpen by remember(block.id) { derivedStateOf { block.isToggleOpen } }
    val rotation by animateFloatAsState(
        targetValue    = if (isOpen) 90f else 0f,
        animationSpec  = tween(durationMillis = 150),
        label          = "toggle_chevron",
    )

    // Lazily create body block if the toggle was just created (e.g. via slash menu).
    // Don't mutate block.bodyBlock inside remember {} (state write during composition);
    // do it in SideEffect instead, which runs after composition completes.
    val body: BlockState = remember(block.id) {
        block.bodyBlock ?: BlockState(id = UUID.randomUUID().toString(), type = BlockType.Paragraph)
    }
    SideEffect {
        if (block.bodyBlock == null) block.bodyBlock = body
    }

    // Body block is not in vm.blocks, so observe its text here to trigger auto-save
    LaunchedEffect(body.id) {
        snapshotFlow { body.textState.text.toString() }.drop(1).collect { vm.markDirty() }
    }

    val summaryStyle = when (block.type) {
        BlockType.ToggleH1 -> EditorTypography.H1
        BlockType.ToggleH2 -> EditorTypography.H2
        BlockType.ToggleH3 -> EditorTypography.H3
        else               -> EditorTypography.Body
    }
    val summaryPlaceholder = when (block.type) {
        BlockType.ToggleH1 -> "Toggle Heading 1"
        BlockType.ToggleH2 -> "Toggle Heading 2"
        BlockType.ToggleH3 -> "Toggle Heading 3"
        else               -> "Toggle"
    }

    Column(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(28.dp)
                    .clickable { vm.setToggleOpen(block.id, !isOpen) },
            ) {
                Icon(
                    imageVector        = Icons.Default.ChevronRight,
                    contentDescription = if (isOpen) "Collapse" else "Expand",
                    tint               = Slate400,
                    modifier           = Modifier
                        .size(18.dp)
                        .rotate(rotation),
                )
            }

            BlockTextField(
                block           = block,
                vm              = vm,
                textStyle       = summaryStyle,
                placeholder     = summaryPlaceholder,
                onSplitOverride = { _, _ ->
                    // Enter on summary → open toggle and focus body
                    if (!block.isToggleOpen) vm.setToggleOpen(block.id, true)
                    vm.pendingFocus[body.id] = CursorTarget.Start
                },
                modifier = Modifier.weight(1f),
            )
        }

        AnimatedVisibility(visible = isOpen) {
            Box(modifier = Modifier.padding(start = 28.dp, top = 2.dp, bottom = 2.dp)) {
                BlockTextField(
                    block           = body,
                    vm              = vm,
                    textStyle       = EditorTypography.Body,
                    placeholder     = "Empty toggle. Click to add content.",
                    onSplitOverride = { _, rightText ->
                        // Enter in body → insert paragraph after the toggle wrapper in the main list
                        val newId = vm.insertNewBlock(afterId = block.id, initialText = rightText)
                        vm.pendingFocus[newId] = CursorTarget.Start
                    },
                )
            }
        }
    }
}
