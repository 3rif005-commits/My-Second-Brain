package com.secondbrain.tablet.editor.serialization

import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.model.BlockType
import com.secondbrain.tablet.editor.model.MentionAnchor
import com.secondbrain.tablet.editor.model.StyleRun

object MarkdownSerializer {

    fun serialize(title: String, blocks: List<BlockState>): String {
        val sb = StringBuilder()
        sb.append("# ").append(title).append("\n\n")
        var numberedCounter = 0
        var prevType: BlockType? = null
        for (block in blocks) {
            if (block.type != BlockType.NumberedListItem) numberedCounter = 0
            if (block.type == BlockType.NumberedListItem) numberedCounter++
            // Extra blank line between list items and non-list content
            if (prevType?.isList == true && !block.type.isList) sb.append("\n")
            appendBlock(sb, block, numberedCounter)
            prevType = block.type
        }
        return sb.toString().trimEnd()
    }

    private fun appendBlock(sb: StringBuilder, block: BlockState, numberedIndex: Int) {
        val indent = "  ".repeat(block.indentLevel)
        val text = inlineMd(
            block.textState.text.toString(),
            block.styles.toList(),
            block.mentions.toList(),
        )
        when (block.type) {
            BlockType.Paragraph       -> sb.append(indent).append(text).append("\n\n")
            BlockType.H1, BlockType.ToggleH1 -> {
                sb.append("# ").append(text).append("\n\n")
                appendBody(sb, block)
            }
            BlockType.H2, BlockType.ToggleH2 -> {
                sb.append("## ").append(text).append("\n\n")
                appendBody(sb, block)
            }
            BlockType.H3, BlockType.ToggleH3 -> {
                sb.append("### ").append(text).append("\n\n")
                appendBody(sb, block)
            }
            BlockType.BulletListItem  -> sb.append(indent).append("- ").append(text).append("\n")
            BlockType.NumberedListItem -> sb.append(indent).append("$numberedIndex. ").append(text).append("\n")
            BlockType.CheckListItem   -> {
                val box = if (block.checked) "[x]" else "[ ]"
                sb.append(indent).append("- $box ").append(text).append("\n")
            }
            BlockType.ToggleListItem  -> {
                sb.append(indent).append("- ").append(text).append("\n")
                appendBody(sb, block, extraIndent = indent + "  ")
            }
            BlockType.Quote           -> sb.append("> ").append(text).append("\n\n")
            BlockType.CodeBlock       -> sb.append("```\n").append(block.textState.text.toString()).append("\n```\n\n")
            BlockType.Divider         -> sb.append("---\n\n")
            BlockType.Callout         -> sb.append("> ").append(block.calloutEmoji).append(" ").append(text).append("\n\n")
            BlockType.Interactive     -> sb.append("*[Canvas Block]*\n\n")
        }
    }

    private fun appendBody(sb: StringBuilder, block: BlockState, extraIndent: String = "") {
        val body = block.bodyBlock ?: return
        val bodyText = inlineMd(
            body.textState.text.toString(),
            body.styles.toList(),
            body.mentions.toList(),
        )
        if (bodyText.isNotBlank()) sb.append(extraIndent).append(bodyText).append("\n\n")
    }

    // Converts a text + style/mention metadata to inline Markdown.
    fun inlineMd(text: String, styles: List<StyleRun>, mentions: List<MentionAnchor>): String {
        if (text.isEmpty()) return ""
        val len = text.length

        val bold      = BooleanArray(len)
        val italic    = BooleanArray(len)
        val strike    = BooleanArray(len)
        val mentionId = arrayOfNulls<String>(len)  // non-null at first char of a mention span

        for (run in styles) {
            val s = run.start.coerceIn(0, len)
            val e = run.end.coerceIn(0, len)
            for (i in s until e) {
                if (run.styles.bold)   bold[i]   = true
                if (run.styles.italic) italic[i] = true
                if (run.styles.strike) strike[i] = true
            }
        }
        val mentionRanges = mutableListOf<Triple<Int, Int, String>>()
        for (mention in mentions) {
            val s = mention.start.coerceIn(0, len)
            val e = mention.end.coerceIn(0, len)
            if (s < e) mentionRanges += Triple(s, e, mention.noteName)
        }

        // Collect all boundary points
        val boundaries = sortedSetOf(0, len)
        for (run in styles) {
            boundaries += run.start.coerceIn(0, len)
            boundaries += run.end.coerceIn(0, len)
        }
        for ((s, e, _) in mentionRanges) { boundaries += s; boundaries += e }

        val pts = boundaries.toList()
        val sb = StringBuilder()
        for (i in 0 until pts.size - 1) {
            val start = pts[i]
            val end   = pts[i + 1]
            if (start >= end) continue

            val mention = mentionRanges.firstOrNull { (s, e, _) -> s <= start && end <= e }
            if (mention != null) {
                sb.append("[[").append(mention.third).append("]]")
                continue
            }

            var seg = text.substring(start, end)
            val b = bold[start]; val it = italic[start]; val s = strike[start]
            if (b && it) seg = "***$seg***" else if (b) seg = "**$seg**" else if (it) seg = "*$seg*"
            if (s) seg = "~~$seg~~"
            sb.append(seg)
        }
        return sb.toString()
    }
}
