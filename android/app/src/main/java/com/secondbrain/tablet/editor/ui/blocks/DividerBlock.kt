package com.secondbrain.tablet.editor.ui.blocks

import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.secondbrain.tablet.ui.theme.Slate400

@Composable
fun DividerBlock(modifier: Modifier = Modifier) {
    HorizontalDivider(
        modifier = modifier,
        thickness = 1.dp,
        color = Slate400.copy(alpha = 0.4f),
    )
}
