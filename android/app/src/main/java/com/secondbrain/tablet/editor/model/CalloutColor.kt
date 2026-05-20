package com.secondbrain.tablet.editor.model

enum class CalloutColor(val key: String) {
    Blue("blue"),
    Red("red"),
    Orange("orange"),
    Green("green"),
    Purple("purple");

    companion object {
        fun from(key: String?): CalloutColor =
            entries.firstOrNull { it.key == key } ?: Blue
    }
}
