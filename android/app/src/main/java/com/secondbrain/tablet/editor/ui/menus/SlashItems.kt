package com.secondbrain.tablet.editor.ui.menus

import com.secondbrain.tablet.editor.model.BlockType

data class SlashItem(
    val type: BlockType,
    val label: String,
    val description: String,
    val symbol: String,
    val keywords: List<String> = emptyList(),
)

val AllSlashItems: List<SlashItem> = listOf(
    SlashItem(BlockType.H1,             "Heading 1",     "Large section heading",      "H1",  listOf("h1", "heading")),
    SlashItem(BlockType.H2,             "Heading 2",     "Medium section heading",     "H2",  listOf("h2", "heading")),
    SlashItem(BlockType.H3,             "Heading 3",     "Small section heading",      "H3",  listOf("h3", "heading")),
    SlashItem(BlockType.ToggleH1,       "Toggle H1",     "Collapsible heading 1",      "▸H1", listOf("toh1", "toggle")),
    SlashItem(BlockType.ToggleH2,       "Toggle H2",     "Collapsible heading 2",      "▸H2", listOf("toh2", "toggle")),
    SlashItem(BlockType.ToggleH3,       "Toggle H3",     "Collapsible heading 3",      "▸H3", listOf("toh3", "toggle")),
    SlashItem(BlockType.Quote,          "Quote",         "Capture a quote",            "❝",   listOf("quote", "blockquote")),
    SlashItem(BlockType.ToggleListItem, "Toggle",        "Collapsible section",        "▸",   listOf("toggle", "collapse")),
    SlashItem(BlockType.NumberedListItem,"Numbered List","Ordered list",               "1.",  listOf("numbered", "ordered", "ol", "list")),
    SlashItem(BlockType.BulletListItem, "Bullet List",   "Simple bulleted list",       "•",   listOf("bullet", "unordered", "ul", "list")),
    SlashItem(BlockType.CheckListItem,  "Check List",    "Track tasks with a checkbox","☑",   listOf("check", "todo", "task")),
    SlashItem(BlockType.Paragraph,      "Text",          "Plain text block",           "¶",   listOf("text", "paragraph")),
    SlashItem(BlockType.CodeBlock,      "Code",          "Code block",                 "{}",  listOf("code", "pre", "mono")),
    SlashItem(BlockType.Divider,        "Divider",       "Visual separator",           "—",   listOf("divider", "separator", "line", "hr")),
    SlashItem(BlockType.Callout,        "Callout",       "Highlighted info box",       "💡",  listOf("callout", "note", "info")),
    SlashItem(BlockType.Interactive,    "Canvas Block",  "Interactive widget canvas",  "📊",  listOf("canvas", "interactive", "quiz", "widget")),
)

fun List<SlashItem>.filterByQuery(query: String): List<SlashItem> {
    if (query.isEmpty()) return this
    val lower = query.lowercase()
    return filter { item ->
        item.label.lowercase().contains(lower) ||
        item.keywords.any { it.startsWith(lower) }
    }
}
