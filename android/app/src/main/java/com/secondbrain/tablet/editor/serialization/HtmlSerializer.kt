package com.secondbrain.tablet.editor.serialization

import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.model.BlockType
import com.secondbrain.tablet.editor.model.MentionAnchor
import com.secondbrain.tablet.editor.model.StyleRun

object HtmlSerializer {

    fun serialize(title: String, blocks: List<BlockState>): String {
        val body = buildBody(title, blocks)
        return """<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, sans-serif; font-size: 15px; line-height: 1.6;
         color: #111; max-width: 800px; margin: 40px auto; padding: 0 24px; }
  h1 { font-size: 2em; margin-bottom: 0.25em; }
  h2 { font-size: 1.5em; }
  h3 { font-size: 1.2em; }
  blockquote { border-left: 3px solid #aaa; margin: 0; padding-left: 1em; color: #555; }
  pre { background: #f4f4f4; padding: 12px; border-radius: 6px; overflow-x: auto; }
  code { font-family: monospace; }
  hr  { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
  .callout { border-left: 4px solid #6366f1; background: #eef2ff;
             padding: 10px 14px; border-radius: 6px; margin: 0.75em 0; }
  details summary { cursor: pointer; font-weight: 600; }
  .mention { background: #eef2ff; color: #6366f1; padding: 1px 4px;
             border-radius: 4px; }
  input[type=checkbox] { margin-right: 6px; }
</style>
</head><body>
$body
</body></html>"""
    }

    private fun buildBody(title: String, blocks: List<BlockState>): String {
        val sb = StringBuilder()
        sb.append("<h1>").append(esc(title)).append("</h1>\n")

        var i = 0
        while (i < blocks.size) {
            val block = blocks[i]
            when (block.type) {
                BlockType.BulletListItem, BlockType.CheckListItem -> {
                    sb.append("<ul>\n")
                    while (i < blocks.size && (blocks[i].type == BlockType.BulletListItem || blocks[i].type == BlockType.CheckListItem)) {
                        val b = blocks[i]
                        val text = inlineHtml(b.textState.text.toString(), b.styles.toList(), b.mentions.toList())
                        if (b.type == BlockType.CheckListItem) {
                            val checked = if (b.checked) " checked" else ""
                            sb.append("  <li><input type=\"checkbox\"$checked disabled>").append(text).append("</li>\n")
                        } else {
                            sb.append("  <li>").append(text).append("</li>\n")
                        }
                        i++
                    }
                    sb.append("</ul>\n")
                }
                BlockType.NumberedListItem -> {
                    sb.append("<ol>\n")
                    while (i < blocks.size && blocks[i].type == BlockType.NumberedListItem) {
                        val b = blocks[i]
                        val text = inlineHtml(b.textState.text.toString(), b.styles.toList(), b.mentions.toList())
                        sb.append("  <li>").append(text).append("</li>\n")
                        i++
                    }
                    sb.append("</ol>\n")
                }
                else -> {
                    appendBlock(sb, block)
                    i++
                }
            }
        }
        return sb.toString()
    }

    private fun appendBlock(sb: StringBuilder, block: BlockState) {
        val text = inlineHtml(
            block.textState.text.toString(),
            block.styles.toList(),
            block.mentions.toList(),
        )
        when (block.type) {
            BlockType.Paragraph -> sb.append("<p>").append(text).append("</p>\n")
            BlockType.H1, BlockType.ToggleH1 -> {
                sb.append("<h1>").append(text).append("</h1>\n")
                appendBodyHtml(sb, block)
            }
            BlockType.H2, BlockType.ToggleH2 -> {
                sb.append("<h2>").append(text).append("</h2>\n")
                appendBodyHtml(sb, block)
            }
            BlockType.H3, BlockType.ToggleH3 -> {
                sb.append("<h3>").append(text).append("</h3>\n")
                appendBodyHtml(sb, block)
            }
            BlockType.ToggleListItem -> {
                val bodyHtml = bodyHtml(block) ?: ""
                sb.append("<details open><summary>").append(text).append("</summary>")
                if (bodyHtml.isNotBlank()) sb.append("<p>").append(bodyHtml).append("</p>")
                sb.append("</details>\n")
            }
            BlockType.Quote -> sb.append("<blockquote><p>").append(text).append("</p></blockquote>\n")
            BlockType.CodeBlock -> sb.append("<pre><code>").append(esc(block.textState.text.toString())).append("</code></pre>\n")
            BlockType.Divider -> sb.append("<hr>\n")
            BlockType.Callout -> sb.append("<div class=\"callout\">").append(esc(block.calloutEmoji)).append(" ").append(text).append("</div>\n")
            BlockType.Interactive -> {
                if (block.htmlContent.isNotBlank()) {
                    sb.append("<iframe srcdoc=\"").append(esc(block.htmlContent)).append("\" style=\"width:100%;height:220px;border:none;\"></iframe>\n")
                } else {
                    sb.append("<p><em>[Canvas Block]</em></p>\n")
                }
            }
            // List types handled by caller grouping logic
            else -> sb.append("<p>").append(text).append("</p>\n")
        }
    }

    private fun appendBodyHtml(sb: StringBuilder, block: BlockState) {
        val h = bodyHtml(block) ?: return
        if (h.isNotBlank()) sb.append("<p style=\"margin-left:1.5em\">").append(h).append("</p>\n")
    }

    private fun bodyHtml(block: BlockState): String? {
        val body = block.bodyBlock ?: return null
        return inlineHtml(body.textState.text.toString(), body.styles.toList(), body.mentions.toList())
    }

    private fun inlineHtml(text: String, styles: List<StyleRun>, mentions: List<MentionAnchor>): String {
        if (text.isEmpty()) return ""
        val len = text.length

        val bold      = BooleanArray(len)
        val italic    = BooleanArray(len)
        val underline = BooleanArray(len)
        val strike    = BooleanArray(len)

        for (run in styles) {
            val s = run.start.coerceIn(0, len)
            val e = run.end.coerceIn(0, len)
            for (i in s until e) {
                if (run.styles.bold)      bold[i]      = true
                if (run.styles.italic)    italic[i]    = true
                if (run.styles.underline) underline[i] = true
                if (run.styles.strike)    strike[i]    = true
            }
        }
        val mentionRanges = mentions.mapNotNull { m ->
            val s = m.start.coerceIn(0, len); val e = m.end.coerceIn(0, len)
            if (s < e) Triple(s, e, m.noteName) else null
        }

        val boundaries = sortedSetOf(0, len)
        for (run in styles) { boundaries += run.start.coerceIn(0, len); boundaries += run.end.coerceIn(0, len) }
        for ((s, e, _) in mentionRanges) { boundaries += s; boundaries += e }

        val pts = boundaries.toList()
        val sb = StringBuilder()
        for (i in 0 until pts.size - 1) {
            val start = pts[i]; val end = pts[i + 1]
            if (start >= end) continue

            val mention = mentionRanges.firstOrNull { (s, e, _) -> s <= start && end <= e }
            if (mention != null) {
                sb.append("<span class=\"mention\">").append(esc(mention.third)).append("</span>")
                continue
            }

            var seg = esc(text.substring(start, end))
            if (strike[start])    seg = "<del>$seg</del>"
            if (underline[start]) seg = "<u>$seg</u>"
            if (italic[start])    seg = "<em>$seg</em>"
            if (bold[start])      seg = "<strong>$seg</strong>"
            sb.append(seg)
        }
        return sb.toString()
    }

    private fun esc(s: String) = s
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
}
