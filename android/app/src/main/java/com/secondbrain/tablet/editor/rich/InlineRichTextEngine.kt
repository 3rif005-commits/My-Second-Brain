@file:OptIn(ExperimentalFoundationApi::class)

package com.secondbrain.tablet.editor.rich

import androidx.compose.foundation.ExperimentalFoundationApi
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.model.InlineStyles

object InlineRichTextEngine {

    fun currentMarks(block: BlockState): InlineStyles {
        val sel = block.textState.selection
        return if (sel.collapsed) {
            val pos = (sel.start - 1).coerceAtLeast(0)
            val runStyles = StyleOps.stylesAt(block.styles, pos)
            InlineStyles(
                bold      = block.pendingMarks.bold      || runStyles.bold,
                italic    = block.pendingMarks.italic    || runStyles.italic,
                underline = block.pendingMarks.underline || runStyles.underline,
                strike    = block.pendingMarks.strike    || runStyles.strike,
            )
        } else {
            val start = minOf(sel.start, sel.end)
            val end   = maxOf(sel.start, sel.end)
            val list  = block.styles.toList()
            InlineStyles(
                bold      = StyleOps.isAllActive(list, start, end) { bold },
                italic    = StyleOps.isAllActive(list, start, end) { italic },
                underline = StyleOps.isAllActive(list, start, end) { underline },
                strike    = StyleOps.isAllActive(list, start, end) { strike },
            )
        }
    }

    fun toggleBold(block: BlockState, markDirty: () -> Unit) =
        toggleFlag(block, markDirty, get = { bold }, set = { copy(bold = it) })

    fun toggleItalic(block: BlockState, markDirty: () -> Unit) =
        toggleFlag(block, markDirty, get = { italic }, set = { copy(italic = it) })

    fun toggleUnderline(block: BlockState, markDirty: () -> Unit) =
        toggleFlag(block, markDirty, get = { underline }, set = { copy(underline = it) })

    fun toggleStrike(block: BlockState, markDirty: () -> Unit) =
        toggleFlag(block, markDirty, get = { strike }, set = { copy(strike = it) })

    private fun toggleFlag(
        block: BlockState,
        markDirty: () -> Unit,
        get: InlineStyles.() -> Boolean,
        set: InlineStyles.(Boolean) -> InlineStyles,
    ) {
        val sel     = block.textState.selection
        val textLen = block.textState.text.length
        if (sel.collapsed) {
            block.pendingMarks = block.pendingMarks.set(!block.pendingMarks.get())
        } else {
            val start = minOf(sel.start, sel.end)
            val end   = maxOf(sel.start, sel.end)
            val allOn = StyleOps.isAllActive(block.styles.toList(), start, end, get)
            StyleOps.applyToRange(block.styles, textLen, start, end) { it.set(!allOn) }
        }
        markDirty()
    }
}
