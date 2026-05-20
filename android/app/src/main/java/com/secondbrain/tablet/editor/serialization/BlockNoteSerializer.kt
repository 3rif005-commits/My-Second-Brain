package com.secondbrain.tablet.editor.serialization

import com.secondbrain.tablet.editor.model.*
import kotlinx.serialization.json.*

object BlockNoteSerializer {

    fun deserialize(json: JsonArray): List<BlockModel> = buildList {
        for (elem in json) {
            if (elem !is JsonObject) continue
            val type = (elem["type"] as? JsonPrimitive)?.contentOrNull
            if (type == "columnList") {
                // Flatten multi-column into sequential blocks (#18)
                val columns = (elem["children"] as? JsonArray) ?: continue
                for (col in columns) {
                    if (col !is JsonObject) continue
                    val colBlocks = (col["children"] as? JsonArray) ?: continue
                    colBlocks.mapNotNullTo(this) { if (it is JsonObject) parseBlock(it, 0) else null }
                }
            } else {
                parseBlock(elem, 0)?.let { add(it) }
            }
        }
    }

    private fun parseBlock(obj: JsonObject, indentLevel: Int): BlockModel? {
        val type = (obj["type"] as? JsonPrimitive)?.contentOrNull ?: return null
        val props = obj["props"] as? JsonObject
        // Safe casts: some block types (e.g. table) have content as JsonObject, not JsonArray.
        // The `?.jsonArray` extension throws on wrong type; `as?` returns null instead.
        val contentArr = (obj["content"] as? JsonArray) ?: JsonArray(emptyList())
        val childrenArr = (obj["children"] as? JsonArray) ?: JsonArray(emptyList())
        val bgColor = BlockColor.from((props?.get("backgroundColor") as? JsonPrimitive)?.contentOrNull)
        val content = parseInlineContent(contentArr)

        return when (type) {
            "paragraph" -> BlockModel(
                type = BlockType.Paragraph, color = bgColor, content = content,
                rawChildren = childrenArr, indentLevel = indentLevel,
            )
            "heading" -> {
                val level = (props?.get("level") as? JsonPrimitive)?.intOrNull ?: 1
                val isToggleable = (props?.get("isToggleable") as? JsonPrimitive)?.booleanOrNull ?: false
                if (isToggleable) {
                    val blockType = when (level) { 1 -> BlockType.ToggleH1; 2 -> BlockType.ToggleH2; else -> BlockType.ToggleH3 }
                    val body = childrenArr.mapNotNull { if (it is JsonObject) parseBlock(it, 0) else null }
                    BlockModel(type = blockType, color = bgColor, content = content, children = body, isToggleable = true, indentLevel = indentLevel)
                } else {
                    val blockType = when (level) { 1 -> BlockType.H1; 2 -> BlockType.H2; else -> BlockType.H3 }
                    BlockModel(type = blockType, color = bgColor, content = content, rawChildren = childrenArr, indentLevel = indentLevel)
                }
            }
            "bulletListItem" -> BlockModel(
                type = BlockType.BulletListItem, color = bgColor, content = content,
                rawChildren = childrenArr, indentLevel = indentLevel,
            )
            "numberedListItem" -> BlockModel(
                type = BlockType.NumberedListItem, color = bgColor, content = content,
                rawChildren = childrenArr, indentLevel = indentLevel,
            )
            "checkListItem" -> {
                val checked = (props?.get("checked") as? JsonPrimitive)?.booleanOrNull ?: false
                BlockModel(
                    type = BlockType.CheckListItem, color = bgColor, content = content,
                    rawChildren = childrenArr, checked = checked, indentLevel = indentLevel,
                )
            }
            "toggleListItem", "toggle", "details" -> {
                val body = childrenArr.mapNotNull { if (it is JsonObject) parseBlock(it, 0) else null }
                BlockModel(type = BlockType.ToggleListItem, color = bgColor, content = content, children = body, indentLevel = indentLevel)
            }
            "quote" -> BlockModel(
                type = BlockType.Quote, color = bgColor, content = content,
                rawChildren = childrenArr, indentLevel = indentLevel,
            )
            "codeBlock" -> BlockModel(
                type = BlockType.CodeBlock, color = bgColor, content = content,
                rawChildren = childrenArr, indentLevel = indentLevel,
            )
            "divider", "separator", "horizontalRule" -> BlockModel(
                type = BlockType.Divider, indentLevel = indentLevel,
            )
            "callout" -> {
                val emoji = (props?.get("emoji") as? JsonPrimitive)?.contentOrNull ?: "💡"
                val calloutColor = CalloutColor.from(bgColor.key)
                BlockModel(
                    type = BlockType.Callout, color = bgColor, content = content,
                    rawChildren = childrenArr, calloutEmoji = emoji, calloutColor = calloutColor,
                    indentLevel = indentLevel,
                )
            }
            "interactive" -> {
                val html = (props?.get("html") as? JsonPrimitive)?.contentOrNull ?: ""
                BlockModel(
                    type = BlockType.Interactive, htmlContent = html,
                    rawChildren = childrenArr, indentLevel = indentLevel,
                )
            }
            else -> BlockModel(
                type = BlockType.Paragraph, color = bgColor, content = content,
                rawChildren = childrenArr, indentLevel = indentLevel,
            )
        }
    }

    private fun parseInlineContent(arr: JsonArray): List<InlineSpan> =
        arr.mapNotNull { elem ->
            if (elem !is JsonObject) return@mapNotNull null
            when ((elem["type"] as? JsonPrimitive)?.contentOrNull) {
                "text" -> {
                    val text = (elem["text"] as? JsonPrimitive)?.contentOrNull ?: ""
                    val s = elem["styles"] as? JsonObject
                    val bold = (s?.get("bold") as? JsonPrimitive)?.booleanOrNull ?: false
                    val italic = (s?.get("italic") as? JsonPrimitive)?.booleanOrNull ?: false
                    val underline = (s?.get("underline") as? JsonPrimitive)?.booleanOrNull ?: false
                    val strike = ((s?.get("strike") ?: s?.get("strikethrough")) as? JsonPrimitive)?.booleanOrNull ?: false
                    val href = (elem["href"] as? JsonPrimitive)?.contentOrNull
                    InlineSpan.Text(text, InlineStyles(bold, italic, underline, strike), href)
                }
                "mention" -> {
                    val p = elem["props"] as? JsonObject
                    InlineSpan.Mention(
                        noteId = (p?.get("noteId") as? JsonPrimitive)?.contentOrNull ?: "",
                        noteName = (p?.get("noteName") as? JsonPrimitive)?.contentOrNull ?: "",
                    )
                }
                else -> null
            }
        }

    fun serialize(blocks: List<BlockModel>): JsonArray =
        JsonArray(blocks.map { serializeBlock(it) })

    private fun serializeBlock(block: BlockModel): JsonElement = buildJsonObject {
        when (block.type) {
            BlockType.Paragraph -> {
                put("type", "paragraph")
                put("props", buildProps(block.color))
            }
            BlockType.H1 -> { put("type", "heading"); put("props", buildHeadingProps(block.color, 1, false)) }
            BlockType.H2 -> { put("type", "heading"); put("props", buildHeadingProps(block.color, 2, false)) }
            BlockType.H3 -> { put("type", "heading"); put("props", buildHeadingProps(block.color, 3, false)) }
            BlockType.ToggleH1 -> { put("type", "heading"); put("props", buildHeadingProps(block.color, 1, true)) }
            BlockType.ToggleH2 -> { put("type", "heading"); put("props", buildHeadingProps(block.color, 2, true)) }
            BlockType.ToggleH3 -> { put("type", "heading"); put("props", buildHeadingProps(block.color, 3, true)) }
            BlockType.BulletListItem -> { put("type", "bulletListItem"); put("props", buildProps(block.color)) }
            BlockType.NumberedListItem -> { put("type", "numberedListItem"); put("props", buildProps(block.color)) }
            BlockType.CheckListItem -> {
                put("type", "checkListItem")
                put("props", buildJsonObject {
                    put("textColor", "default"); put("backgroundColor", block.color.key)
                    put("checked", block.checked)
                })
            }
            BlockType.ToggleListItem -> { put("type", "toggleListItem"); put("props", buildProps(block.color)) }
            BlockType.Quote -> { put("type", "quote"); put("props", buildProps(block.color)) }
            BlockType.CodeBlock -> { put("type", "codeBlock"); put("props", buildProps(block.color)) }
            BlockType.Divider -> { put("type", "divider"); put("props", buildJsonObject {}) }
            BlockType.Callout -> {
                put("type", "callout")
                put("props", buildJsonObject {
                    put("textColor", "default")
                    put("backgroundColor", block.calloutColor.key)
                    put("emoji", block.calloutEmoji)
                })
            }
            BlockType.Interactive -> {
                put("type", "interactive")
                put("props", buildJsonObject { put("html", block.htmlContent) })
            }
        }
        put("content", JsonArray(block.content.map { serializeSpan(it) }))
        if (block.type.isToggle) {
            put("children", JsonArray(block.children.map { serializeBlock(it) }))
        } else {
            put("children", block.rawChildren)
        }
    }

    private fun buildProps(color: BlockColor) = buildJsonObject {
        put("textColor", "default"); put("backgroundColor", color.key)
    }

    private fun buildHeadingProps(color: BlockColor, level: Int, isToggleable: Boolean) = buildJsonObject {
        put("textColor", "default"); put("backgroundColor", color.key)
        put("level", level); put("isToggleable", isToggleable)
    }

    private fun serializeSpan(span: InlineSpan): JsonElement = when (span) {
        is InlineSpan.Text -> buildJsonObject {
            put("type", "text"); put("text", span.text)
            put("styles", buildJsonObject {
                if (span.styles.bold) put("bold", true)
                if (span.styles.italic) put("italic", true)
                if (span.styles.underline) put("underline", true)
                if (span.styles.strike) put("strike", true)
            })
            span.href?.let { put("href", it) }
        }
        is InlineSpan.Mention -> buildJsonObject {
            put("type", "mention")
            put("props", buildJsonObject { put("noteId", span.noteId); put("noteName", span.noteName) })
        }
    }
}
