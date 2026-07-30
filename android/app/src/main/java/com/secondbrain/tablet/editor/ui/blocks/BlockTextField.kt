@file:OptIn(ExperimentalFoundationApi::class)

package com.secondbrain.tablet.editor.ui.blocks

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import com.secondbrain.tablet.editor.CursorTarget
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.rich.RichInputTransformation
import com.secondbrain.tablet.editor.rich.StyledTextOverlay
import androidx.compose.material3.MaterialTheme
import com.secondbrain.tablet.editor.ui.LocalOpenNote
import com.secondbrain.tablet.ui.theme.Indigo500
import kotlinx.coroutines.flow.filterNotNull

@Composable
fun BlockTextField(
    block: BlockState,
    vm: DocumentViewModel,
    textStyle: TextStyle,
    placeholder: String,
    onSplitOverride: ((atOffset: Int, rightText: String) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val focusRequester = remember { FocusRequester() }
    val onOpenNote     = LocalOpenNote.current

    LaunchedEffect(block.id) {
        snapshotFlow { vm.pendingFocus[block.id] }
            .filterNotNull()
            .collect {
                try { focusRequester.requestFocus() } catch (_: IllegalStateException) { }
                vm.pendingFocus.remove(block.id)
            }
    }

    val menuActive = remember { mutableStateOf(false) }
    SideEffect {
        menuActive.value = vm.slashMenu?.blockId == block.id || vm.mentionMenu?.blockId == block.id
    }

    val inputTransformation = remember(block.id) {
        RichInputTransformation(
            block        = block,
            onSplit      = onSplitOverride ?: { offset, right -> vm.splitBlock(block.id, offset, right) },
            onMergePrev  = { vm.mergeWithPrevious(block.id) },
            onSlashTyped = { offset -> vm.onSlashTyped(block.id, offset) },
            onAtTyped    = { offset -> vm.onAtTyped(block.id, offset) },
            isMenuActive = { menuActive.value },
            onMenuEnter  = { vm.signalMenuEnter() },
        )
    }

    var textLayoutResult: TextLayoutResult? by remember { mutableStateOf(null) }

    // Only activate the tap interceptor on blocks that actually have mentions.
    // Blocks without mentions return immediately — no coroutine overhead at all.
    val hasMentions = block.mentions.isNotEmpty()

    Box(
        modifier = modifier.pointerInput(hasMentions, block.id) {
            if (!hasMentions) return@pointerInput
            awaitPointerEventScope {
                while (true) {
                    val down = awaitPointerEvent(PointerEventPass.Initial)
                    if (down.type != PointerEventType.Press) continue
                    val change = down.changes.firstOrNull() ?: continue
                    val layout  = textLayoutResult ?: continue
                    val charOff = layout.getOffsetForPosition(change.position)
                    val mention = block.mentions.firstOrNull { charOff in it.start until it.end }
                    if (mention != null) {
                        change.consume()
                        while (true) {
                            val ev = awaitPointerEvent(PointerEventPass.Initial)
                            ev.changes.forEach { it.consume() }
                            if (ev.type == PointerEventType.Release ||
                                ev.type == PointerEventType.Unknown) break
                        }
                        onOpenNote(mention.noteId)
                    }
                }
            }
        },
    ) {
        // Placeholder — shown when the block is empty
        if (block.textState.text.isEmpty()) {
            Text(
                text     = placeholder,
                style    = textStyle.copy(color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)),
                modifier = Modifier.align(Alignment.CenterStart),
            )
        }

        // Styled overlay renders formatted text (bold, italic, underline, strike, mention links)
        StyledTextOverlay(
            block     = block,
            textStyle = textStyle,
            modifier  = Modifier.fillMaxWidth(),
        )

        // Transparent BasicTextField on top: captures typing, cursor, and selection
        BasicTextField(
            state               = block.textState,
            inputTransformation = inputTransformation,
            textStyle           = textStyle.copy(color = Color.Transparent),
            cursorBrush         = SolidColor(Indigo500),
            keyboardOptions     = KeyboardOptions(keyboardType = KeyboardType.Text),
            onTextLayout        = { getResult -> textLayoutResult = getResult() },
            modifier            = Modifier
                .fillMaxWidth()
                .focusRequester(focusRequester)
                .onFocusChanged { if (it.isFocused) vm.onBlockFocused(block.id) }
                .onPreviewKeyEvent { event ->
                    if (event.type == KeyEventType.KeyDown) {
                        val slashMenu   = vm.slashMenu
                        val mentionMenu = vm.mentionMenu
                        when {
                            slashMenu != null && slashMenu.blockId == block.id -> when (event.key) {
                                Key.DirectionUp   -> { vm.navigateSlashMenu(-1);  true }
                                Key.DirectionDown -> { vm.navigateSlashMenu(+1);  true }
                                Key.Enter         -> { vm.signalMenuEnter();       true }
                                Key.Escape        -> { vm.closeSlashMenu();        true }
                                else              -> false
                            }
                            mentionMenu != null && mentionMenu.blockId == block.id -> when (event.key) {
                                Key.DirectionUp   -> { vm.navigateMentionMenu(-1); true }
                                Key.DirectionDown -> { vm.navigateMentionMenu(+1); true }
                                Key.Enter         -> { vm.signalMenuEnter();        true }
                                Key.Escape        -> { vm.closeMentionMenu();       true }
                                else              -> false
                            }
                            event.key == Key.Backspace -> {
                                if (block.textState.text.isEmpty() ||
                                    inputTransformation.lastCursorStart == 0
                                ) {
                                    vm.mergeWithPrevious(block.id); true
                                } else false
                            }
                            else -> false
                        }
                    } else false
                },
        )
    }
}
