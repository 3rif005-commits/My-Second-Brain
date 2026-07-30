package com.secondbrain.tablet.editor.model

enum class BlockColor(val key: String) {
    Default("default"),
    Gray("gray"),
    Brown("brown"),
    Red("red"),
    Orange("orange"),
    Yellow("yellow"),
    Green("green"),
    Blue("blue"),
    Purple("purple"),
    Pink("pink");

    companion object {
        fun from(key: String?): BlockColor =
            entries.firstOrNull { it.key == key } ?: Default
    }
}
