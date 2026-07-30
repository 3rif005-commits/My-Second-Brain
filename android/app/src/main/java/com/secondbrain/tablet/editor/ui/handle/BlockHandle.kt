package com.secondbrain.tablet.editor.ui.handle

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DragIndicator
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockState
import androidx.compose.material3.MaterialTheme
import com.secondbrain.tablet.editor.ui.menus.BlockActionsMenu
import com.secondbrain.tablet.ui.theme.Indigo500

@Composable
fun BlockHandle(
    block: BlockState,
    vm: DocumentViewModel,
    handleModifier: Modifier = Modifier,
    modifier: Modifier = Modifier,
) {
    var showMenu by remember { mutableStateOf(false) }

    // derivedStateOf: only THIS handle recomposes when focusedBlockId changes,
    // not every handle in the list.
    val isFocused  by remember(block.id) { derivedStateOf { vm.focusedBlockId  == block.id } }
    val isSelected by remember(block.id) { derivedStateOf { vm.selectedBlockId == block.id } }
    val isVisible = isFocused || isSelected

    // Fixed-width column — no fillMaxHeight(). The Row in BlockRow wraps its content height
    // naturally without needing IntrinsicSize.Min.
    Box(
        modifier = modifier
            .width(36.dp)
            .clickable { showMenu = true },
        contentAlignment = Alignment.TopCenter,
    ) {
        Icon(
            imageVector = Icons.Default.DragIndicator,
            contentDescription = "Block handle",
            tint = when {
                isSelected -> Indigo500
                isVisible  -> MaterialTheme.colorScheme.onSurfaceVariant
                else       -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0f)
            },
            modifier = Modifier
                .padding(top = 3.dp)
                .size(18.dp)
                .then(handleModifier),
        )

        if (showMenu) {
            BlockActionsMenu(
                onDismiss = { showMenu = false },
                block = block,
                vm = vm,
            )
        }
    }
}
