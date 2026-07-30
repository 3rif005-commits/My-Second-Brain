package com.secondbrain.tablet.editor.serialization

import com.secondbrain.tablet.editor.model.*
import java.util.UUID

object BlockStateBridge {

    fun fromModel(model: BlockModel): BlockState {
        val sb            = StringBuilder()
        val styleRuns     = mutableListOf<StyleRun>()
        val mentionAnchors = mutableListOf<MentionAnchor>()

        for (span in model.content) {
            when (span) {
                is InlineSpan.Text -> {
                    val start = sb.length
                    sb.append(span.text)
                    val end = sb.length
                    if (span.styles != InlineStyles.NONE) {
                        styleRuns.add(StyleRun(start, end, span.styles))
                    }
                }
                is InlineSpan.Mention -> {
                    val start = sb.length
                    sb.append("@${span.noteName}")
                    val end = sb.length
                    mentionAnchors.add(MentionAnchor(start, end, span.noteId, span.noteName))
                }
            }
        }

        val bodyBlock = if (model.type.isToggle && model.children.isNotEmpty()) {
            fromModel(model.children.first())
        } else null

        return BlockState(
            id               = UUID.randomUUID().toString(),
            type             = model.type,
            color            = model.color,
            checked          = model.checked,
            isToggleOpen     = model.isToggleOpen,
            calloutEmoji     = model.calloutEmoji,
            calloutColor     = model.calloutColor,
            indentLevel      = model.indentLevel,
            initialText      = sb.toString(),
            initialStyles    = styleRuns,
            initialMentions  = mentionAnchors,
            initialBody      = bodyBlock,
            rawChildren      = model.rawChildren,
            htmlContent      = model.htmlContent,
        )
    }

    fun toModel(state: BlockState): BlockModel {
        val text     = state.textState.text.toString()
        val content  = buildSpansFromState(text, state.styles.toList(), state.mentions.toList())
        val children = if (state.type.isToggle) {
            state.bodyBlock?.let { listOf(toModel(it)) } ?: emptyList()
        } else emptyList()

        return BlockModel(
            type         = state.type,
            color        = state.color,
            content      = content,
            children     = children,
            rawChildren  = if (state.type.isToggle) kotlinx.serialization.json.JsonArray(emptyList()) else state.rawChildren,
            checked      = state.checked,
            isToggleable = state.type.isToggle,
            isToggleOpen = state.isToggleOpen,
            calloutEmoji = state.calloutEmoji,
            calloutColor = state.calloutColor,
            indentLevel  = state.indentLevel,
            htmlContent  = state.htmlContent,
        )
    }

    fun plainText(blocks: List<BlockState>): String =
        blocks.joinToString("\n") { it.textState.text.toString() }

    private fun buildSpansFromState(
        text: String,
        styles: List<StyleRun>,
        mentions: List<MentionAnchor>,
    ): List<InlineSpan> {
        if (text.isEmpty()) return emptyList()

        // Dense per-character style array
        val dense = Array(text.length) { InlineStyles.NONE }
        for (run in styles) {
            val s = run.start.coerceIn(0, text.length)
            val e = run.end.coerceIn(0, text.length)
            for (i in s until e) {
                dense[i] = InlineStyles(
                    bold      = dense[i].bold      || run.styles.bold,
                    italic    = dense[i].italic    || run.styles.italic,
                    underline = dense[i].underline || run.styles.underline,
                    strike    = dense[i].strike    || run.styles.strike,
                )
            }
        }

        val sortedMentions = mentions.sortedBy { it.start }
        val result         = mutableListOf<InlineSpan>()
        var i              = 0
        var mIdx           = 0

        while (i < text.length) {
            val nextMention = sortedMentions.getOrNull(mIdx)

            // Emit a mention span when we hit its start position
            if (nextMention != null && i == nextMention.start.coerceIn(0, text.length)) {
                result.add(InlineSpan.Mention(nextMention.noteId, nextMention.noteName))
                i = nextMention.end.coerceIn(i + 1, text.length)
                mIdx++
                continue
            }

            // Determine the end of this plain-text run (up to the next mention or end of text)
            val runEnd = nextMention?.start?.coerceIn(i, text.length) ?: text.length

            // Collapse adjacent positions with the same style into one InlineSpan.Text
            var j = i
            while (j < runEnd) {
                val style = dense[j]
                var k = j + 1
                while (k < runEnd && dense[k] == style) k++
                result.add(InlineSpan.Text(text.substring(j, k), style))
                j = k
            }
            i = runEnd
        }
        return result
    }
}
