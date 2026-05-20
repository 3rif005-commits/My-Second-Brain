package com.secondbrain.tablet.editor.model

enum class BlockType {
    Paragraph,
    H1, H2, H3,
    ToggleH1, ToggleH2, ToggleH3,
    BulletListItem,
    NumberedListItem,
    CheckListItem,
    ToggleListItem,
    Quote,
    CodeBlock,
    Divider,
    Callout,
    Interactive;

    val isList: Boolean
        get() = this in setOf(BulletListItem, NumberedListItem, CheckListItem, ToggleListItem)

    val isHeading: Boolean
        get() = this in setOf(H1, H2, H3, ToggleH1, ToggleH2, ToggleH3)

    val isToggle: Boolean
        get() = this in setOf(ToggleH1, ToggleH2, ToggleH3, ToggleListItem)
}
