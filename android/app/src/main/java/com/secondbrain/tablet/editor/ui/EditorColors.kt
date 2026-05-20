package com.secondbrain.tablet.editor.ui

import androidx.compose.ui.graphics.Color
import com.secondbrain.tablet.editor.model.BlockColor
import com.secondbrain.tablet.editor.model.CalloutColor

object EditorColors {

    fun blockBackground(color: BlockColor): Color = when (color) {
        BlockColor.Default -> Color.Transparent
        BlockColor.Gray    -> Color(0x1F94A3B8)
        BlockColor.Brown   -> Color(0x1FA16207)
        BlockColor.Red     -> Color(0x1FEF4444)
        BlockColor.Orange  -> Color(0x1FF97316)
        BlockColor.Yellow  -> Color(0x1FEAB308)
        BlockColor.Green   -> Color(0x1F22C55E)
        BlockColor.Blue    -> Color(0x1F3B82F6)
        BlockColor.Purple  -> Color(0x1FA855F7)
        BlockColor.Pink    -> Color(0x1FEC4899)
    }

    fun calloutBorder(color: CalloutColor): Color = when (color) {
        CalloutColor.Blue   -> Color(0xFF3B82F6)
        CalloutColor.Red    -> Color(0xFFEF4444)
        CalloutColor.Orange -> Color(0xFFF97316)
        CalloutColor.Green  -> Color(0xFF22C55E)
        CalloutColor.Purple -> Color(0xFFA855F7)
    }

    // Full-opacity swatch colors for the color picker UI
    fun swatchColor(color: BlockColor): Color = when (color) {
        BlockColor.Default -> Color.Transparent
        BlockColor.Gray    -> Color(0xFF94A3B8)
        BlockColor.Brown   -> Color(0xFFA16207)
        BlockColor.Red     -> Color(0xFFEF4444)
        BlockColor.Orange  -> Color(0xFFF97316)
        BlockColor.Yellow  -> Color(0xFFEAB308)
        BlockColor.Green   -> Color(0xFF22C55E)
        BlockColor.Blue    -> Color(0xFF3B82F6)
        BlockColor.Purple  -> Color(0xFFA855F7)
        BlockColor.Pink    -> Color(0xFFEC4899)
    }

    fun calloutBackground(color: CalloutColor): Color = when (color) {
        CalloutColor.Blue   -> Color(0x1F3B82F6)
        CalloutColor.Red    -> Color(0x1FEF4444)
        CalloutColor.Orange -> Color(0x1FF97316)
        CalloutColor.Green  -> Color(0x1F22C55E)
        CalloutColor.Purple -> Color(0x1FA855F7)
    }
}
