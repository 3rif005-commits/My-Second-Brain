@file:OptIn(ExperimentalFoundationApi::class)

package com.secondbrain.tablet.editor.rich

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldBuffer
import androidx.compose.ui.text.TextRange
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.model.InlineStyles

class RichInputTransformation(
    private val block: BlockState,
    private val onSplit: (atOffset: Int, rightText: String) -> Unit,
    private val onMergePrev: () -> Unit,
    private val onSlashTyped: (offset: Int) -> Unit = {},
    private val onAtTyped: (offset: Int) -> Unit = {},
    private val isMenuActive: () -> Boolean = { false },
    private val onMenuEnter: () -> Unit = {},
) : InputTransformation {

    // Last committed cursor position — read by BlockTextField.onPreviewKeyEvent
    // to detect backspace-at-0 without the experimental TextFieldCharSequence API.
    var lastCursorStart: Int = -1
        private set

    override fun TextFieldBuffer.transformInput() {
        lastCursorStart = if (selection.collapsed) selection.start else -1

        if (changes.changeCount == 0) return

        // Pass 1 — scan for newline (split/menu-enter). No style shifts happen on split
        // because the right half becomes a fresh BlockState.
        for (i in 0 until changes.changeCount) {
            val range = changes.getRange(i)
            for (charIdx in range.start until range.end) {
                if (charAt(charIdx) == '\n') {
                    if (isMenuActive()) {
                        replace(charIdx, charIdx + 1, "")
                        onMenuEnter()
                    } else {
                        val rightText = toString().substring(charIdx + 1)
                        replace(charIdx, length, "")
                        selection = TextRange(charIdx)
                        onSplit(charIdx, rightText)
                    }
                    return
                }
            }
        }

        // Pass 2 — style shifts + trigger detection.
        // changes.getOriginalRange(i) is the range deleted from the old text;
        // changes.getRange(i)         is the range inserted in the new text.
        val hasRichContent = block.styles.isNotEmpty() || block.mentions.isNotEmpty()
        for (i in 0 until changes.changeCount) {
            val origRange = changes.getOriginalRange(i)
            val newRange  = changes.getRange(i)
            val deleteLen = origRange.end - origRange.start
            val insertLen = newRange.end - newRange.start
            val at        = origRange.start

            if (deleteLen > 0 && hasRichContent) {
                StyleOps.shiftOnDelete(block.styles, block.mentions, at, at + deleteLen)
            }
            if (insertLen > 0) {
                val marks = if (deleteLen == 0) block.pendingMarks else InlineStyles.NONE
                if (hasRichContent || marks != InlineStyles.NONE) {
                    StyleOps.shiftOnInsert(block.styles, block.mentions, at, insertLen, marks)
                }
                if (deleteLen == 0 && marks != InlineStyles.NONE) {
                    block.pendingMarks = InlineStyles.NONE
                }

                // Slash / @ triggers (single-char insertions only)
                if (insertLen == 1) {
                    when (charAt(newRange.start)) {
                        '/' -> onSlashTyped(newRange.start)
                        '@' -> onAtTyped(newRange.start)
                    }
                }
            }
        }
    }
}
