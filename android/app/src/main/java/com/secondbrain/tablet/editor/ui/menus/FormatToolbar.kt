@file:OptIn(ExperimentalFoundationApi::class)

package com.secondbrain.tablet.editor.ui.menus

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockType
import com.secondbrain.tablet.editor.rich.InlineRichTextEngine
import androidx.compose.material3.MaterialTheme
import com.secondbrain.tablet.editor.ui.EditorColors
import com.secondbrain.tablet.ui.theme.Indigo500
import com.secondbrain.tablet.ui.theme.Slate400

@Composable
fun FormatToolbar(vm: DocumentViewModel, modifier: Modifier = Modifier) {
    val id           = vm.focusedBlockId ?: return
    val focusedBlock = vm.findBlock(id) ?: return
    val sel          = focusedBlock.textState.selection
    if (sel.collapsed) return

    val marks = InlineRichTextEngine.currentMarks(focusedBlock)
    var showColorPicker by remember { mutableStateOf(false) }

    Surface(
        color           = MaterialTheme.colorScheme.surfaceVariant,
        shape           = RoundedCornerShape(8.dp),
        shadowElevation = 8.dp,
        modifier        = modifier.focusProperties { canFocus = false },
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier          = Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
        ) {
            FormatBtn(label = "B",  active = marks.bold,      weight = FontWeight.Bold)               { vm.toggleBold() }
            FormatBtn(label = "I",  active = marks.italic,    fontStyle = FontStyle.Italic)            { vm.toggleItalic() }
            FormatBtn(label = "U",  active = marks.underline, decoration = TextDecoration.Underline)   { vm.toggleUnderline() }
            FormatBtn(label = "S",  active = marks.strike,    decoration = TextDecoration.LineThrough) { vm.toggleStrike() }

            ToolbarDivider()

            FormatBtn(label = "H1", active = false) { vm.changeType(focusedBlock.id, BlockType.H1) }
            FormatBtn(label = "H2", active = false) { vm.changeType(focusedBlock.id, BlockType.H2) }
            FormatBtn(label = "•",  active = false) { vm.changeType(focusedBlock.id, BlockType.BulletListItem) }

            ToolbarDivider()

            // Color indicator button — shows the block's current background color
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .focusProperties { canFocus = false }
                    .clickable { showColorPicker = true },
            ) {
                val dotColor = EditorColors.swatchColor(focusedBlock.color)
                Box(
                    modifier = Modifier
                        .size(16.dp)
                        .clip(CircleShape)
                        .border(1.dp, Slate400, CircleShape)
                        .background(dotColor),
                )
            }
        }
    }

    if (showColorPicker) {
        ColorPickerSheet(
            blockId      = focusedBlock.id,
            currentColor = focusedBlock.color,
            vm           = vm,
            onDismiss    = { showColorPicker = false },
        )
    }
}

@Composable
private fun FormatBtn(
    label:      String,
    active:     Boolean,
    weight:     FontWeight?      = null,
    fontStyle:  FontStyle?       = null,
    decoration: TextDecoration?  = null,
    onClick:    () -> Unit,
) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(36.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(if (active) Indigo500.copy(alpha = 0.20f) else Color.Transparent)
            .focusProperties { canFocus = false }
            .clickable(onClick = onClick),
    ) {
        Text(
            text  = label,
            style = TextStyle(
                fontSize       = 14.sp,
                fontWeight     = weight     ?: FontWeight.Normal,
                fontStyle      = fontStyle  ?: FontStyle.Normal,
                textDecoration = decoration,
                color          = if (active) Indigo500 else MaterialTheme.colorScheme.onSurface,
            ),
        )
    }
}

@Composable
private fun ToolbarDivider() {
    Box(
        modifier = Modifier
            .padding(horizontal = 4.dp)
            .height(20.dp)
            .width(1.dp)
            .background(MaterialTheme.colorScheme.outline),
    )
}
