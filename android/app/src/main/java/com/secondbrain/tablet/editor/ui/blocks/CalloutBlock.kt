package com.secondbrain.tablet.editor.ui.blocks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.ui.EditorColors
import com.secondbrain.tablet.editor.ui.EditorTypography

private val shape = RoundedCornerShape(8.dp)

@Composable
fun CalloutBlock(
    block: BlockState,
    vm: DocumentViewModel,
    modifier: Modifier = Modifier,
) {
    val bg = EditorColors.calloutBackground(block.calloutColor)
    val border = EditorColors.calloutBorder(block.calloutColor)

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(bg)
            .border(width = 1.dp, color = border, shape = shape)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = block.calloutEmoji,
            fontSize = 18.sp,
            modifier = Modifier.padding(top = 1.dp, end = 10.dp),
        )
        BlockTextField(
            block = block,
            vm = vm,
            textStyle = EditorTypography.Callout,
            placeholder = "Callout",
            modifier = Modifier.weight(1f),
        )
    }
}
