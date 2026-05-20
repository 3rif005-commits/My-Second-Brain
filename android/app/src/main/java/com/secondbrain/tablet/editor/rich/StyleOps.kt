package com.secondbrain.tablet.editor.rich

import androidx.compose.runtime.snapshots.SnapshotStateList
import com.secondbrain.tablet.editor.model.InlineStyles
import com.secondbrain.tablet.editor.model.MentionAnchor
import com.secondbrain.tablet.editor.model.StyleRun

object StyleOps {

    fun shiftOnInsert(
        styles: SnapshotStateList<StyleRun>,
        mentions: SnapshotStateList<MentionAnchor>,
        at: Int,
        len: Int,
        pendingMarks: InlineStyles,
    ) {
        if (len <= 0) return
        if (styles.isEmpty() && mentions.isEmpty() && pendingMarks == InlineStyles.NONE) return
        val shifted = styles.map { run ->
            when {
                run.end <= at   -> run
                run.start >= at -> StyleRun(run.start + len, run.end + len, run.styles)
                else            -> StyleRun(run.start, run.end + len, run.styles)
            }
        }.toMutableList()
        if (pendingMarks != InlineStyles.NONE) {
            shifted.add(StyleRun(at, at + len, pendingMarks))
        }
        styles.clear()
        styles.addAll(canonicalize(shifted))

        val shiftedMentions = mentions.map { m ->
            when {
                m.end <= at   -> m
                m.start >= at -> MentionAnchor(m.start + len, m.end + len, m.noteId, m.noteName)
                else          -> MentionAnchor(m.start, m.end + len, m.noteId, m.noteName)
            }
        }
        mentions.clear()
        mentions.addAll(shiftedMentions)
    }

    fun shiftOnDelete(
        styles: SnapshotStateList<StyleRun>,
        mentions: SnapshotStateList<MentionAnchor>,
        deleteStart: Int,
        deleteEnd: Int,
    ) {
        if (deleteStart >= deleteEnd) return
        if (styles.isEmpty() && mentions.isEmpty()) return
        val len = deleteEnd - deleteStart
        val result = mutableListOf<StyleRun>()
        for (run in styles) {
            when {
                run.end <= deleteStart                            -> result.add(run)
                run.start >= deleteEnd                           -> result.add(StyleRun(run.start - len, run.end - len, run.styles))
                run.start >= deleteStart && run.end <= deleteEnd -> Unit  // dropped entirely
                run.start < deleteStart && run.end > deleteEnd  -> result.add(StyleRun(run.start, run.end - len, run.styles))
                run.start < deleteStart                         -> result.add(StyleRun(run.start, deleteStart, run.styles))
                else                                            -> result.add(StyleRun(deleteStart, run.end - len, run.styles))
            }
        }
        styles.clear()
        styles.addAll(canonicalize(result))

        val resultMentions = mutableListOf<MentionAnchor>()
        for (m in mentions) {
            when {
                m.end <= deleteStart -> resultMentions.add(m)
                m.start >= deleteEnd -> resultMentions.add(MentionAnchor(m.start - len, m.end - len, m.noteId, m.noteName))
                else                 -> Unit  // mention overlaps deletion — dropped
            }
        }
        mentions.clear()
        mentions.addAll(resultMentions)
    }

    fun isAllActive(
        styles: List<StyleRun>,
        start: Int,
        end: Int,
        flag: InlineStyles.() -> Boolean,
    ): Boolean {
        if (start >= end) return false
        val count = end - start
        val covered = BooleanArray(count)
        for (run in styles) {
            if (!run.styles.flag()) continue
            val s = (maxOf(run.start, start) - start).coerceAtLeast(0)
            val e = (minOf(run.end, end) - start).coerceAtMost(count)
            for (i in s until e) covered[i] = true
        }
        return covered.all { it }
    }

    fun stylesAt(styles: List<StyleRun>, pos: Int): InlineStyles {
        var result = InlineStyles.NONE
        for (run in styles) {
            if (pos >= run.start && pos < run.end) result = result merge run.styles
        }
        return result
    }

    fun applyToRange(
        styles: SnapshotStateList<StyleRun>,
        textLength: Int,
        start: Int,
        end: Int,
        transform: (InlineStyles) -> InlineStyles,
    ) {
        if (textLength == 0) return
        val s = start.coerceIn(0, textLength)
        val e = end.coerceIn(0, textLength)
        if (s >= e) return

        val dense = Array(textLength) { InlineStyles.NONE }
        for (run in styles) {
            val rs = run.start.coerceIn(0, textLength)
            val re = run.end.coerceIn(0, textLength)
            for (i in rs until re) dense[i] = dense[i] merge run.styles
        }
        for (i in s until e) dense[i] = transform(dense[i])
        styles.clear()
        styles.addAll(canonicalize(denseToRuns(dense)))
    }

    fun canonicalize(runs: List<StyleRun>): List<StyleRun> {
        val sorted = runs.filter { it.start < it.end }.sortedBy { it.start }
        val result = mutableListOf<StyleRun>()
        for (run in sorted) {
            val last = result.lastOrNull()
            if (last != null && last.end >= run.start && last.styles == run.styles) {
                result[result.size - 1] = last.copy(end = maxOf(last.end, run.end))
            } else {
                result.add(run)
            }
        }
        return result
    }

    private fun denseToRuns(dense: Array<InlineStyles>): List<StyleRun> {
        val runs = mutableListOf<StyleRun>()
        var i = 0
        while (i < dense.size) {
            val style = dense[i]
            if (style == InlineStyles.NONE) { i++; continue }
            var j = i + 1
            while (j < dense.size && dense[j] == style) j++
            runs.add(StyleRun(i, j, style))
            i = j
        }
        return runs
    }

    private infix fun InlineStyles.merge(other: InlineStyles) = InlineStyles(
        bold      = bold      || other.bold,
        italic    = italic    || other.italic,
        underline = underline || other.underline,
        strike    = strike    || other.strike,
    )
}
