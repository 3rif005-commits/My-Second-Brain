@file:OptIn(ExperimentalFoundationApi::class)

package com.secondbrain.tablet.editor.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.union
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockType
import com.secondbrain.tablet.editor.ui.menus.FormatToolbar
import com.secondbrain.tablet.editor.ui.menus.MentionMenuPanel
import com.secondbrain.tablet.editor.ui.menus.SlashMenuPanel
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

@Composable
fun BlockEditor(
    vm: DocumentViewModel,
    modifier: Modifier = Modifier,
) {
    val numberedIndices by remember {
        derivedStateOf {
            val map = mutableMapOf<String, Int>()
            val counters = mutableMapOf<Int, Int>()
            for (block in vm.blocks) {
                if (block.type == BlockType.NumberedListItem) {
                    val n = (counters[block.indentLevel] ?: 0) + 1
                    counters[block.indentLevel] = n
                    map[block.id] = n
                    counters.keys.filter { it > block.indentLevel }.forEach { counters.remove(it) }
                } else {
                    counters.keys.filter { it >= block.indentLevel }.forEach { counters.remove(it) }
                }
            }
            map as Map<String, Int>
        }
    }

    val hasFocusedSelection by remember {
        derivedStateOf {
            val id = vm.focusedBlockId ?: return@derivedStateOf false
            val b  = vm.findBlock(id) ?: return@derivedStateOf false
            !b.textState.selection.collapsed
        }
    }

    val listState = rememberLazyListState()
    val reorderState = rememberReorderableLazyListState(listState) { from, to ->
        vm.moveBlock(from.index, to.index)
    }

    // Bottom inset for content padding: max(keyboard, nav bar).
    // When keyboard is open  → keyboard height (blocks scroll above it).
    // When keyboard is closed → nav bar height  (last block isn't hidden behind nav bar).
    val bottomInset = WindowInsets.ime
        .union(WindowInsets.navigationBars)
        .only(WindowInsetsSides.Bottom)

    Box(modifier = modifier.fillMaxSize()) {

        // LazyColumn: NEVER resizes during keyboard animation.
        // contentPadding shifts the scroll content up by the keyboard height so the focused
        // block scrolls into the visible area above the keyboard — without changing the
        // LazyColumn's own measured height at all.
        CompositionLocalProvider(LocalNumberedListIndex provides numberedIndices) {
            LazyColumn(
                state = listState,
                contentPadding = bottomInset.asPaddingValues(),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(vm.blocks, key = { it.id }) { block ->
                    ReorderableItem(reorderState, key = block.id) { isDragging ->
                        BlockRow(
                            block = block,
                            vm = vm,
                            isDragging = isDragging,
                            handleModifier = Modifier.draggableHandle(),
                        )
                    }
                }
            }
        }

        // Menu overlay: imePadding() here only affects where menus are anchored.
        // It does NOT touch the LazyColumn — no re-layout, no animation cost on the list.
        Box(modifier = Modifier.fillMaxSize().imePadding()) {
            if (vm.slashMenu != null) {
                Box(Modifier.fillMaxSize(), Alignment.BottomStart) {
                    SlashMenuPanel(vm = vm)
                }
            }
            if (vm.mentionMenu != null) {
                Box(Modifier.fillMaxSize(), Alignment.BottomStart) {
                    MentionMenuPanel(vm = vm)
                }
            }
            if (hasFocusedSelection) {
                Box(Modifier.fillMaxSize(), Alignment.BottomCenter) {
                    FormatToolbar(vm = vm, modifier = Modifier.padding(bottom = 8.dp))
                }
            }
        }
    }
}
