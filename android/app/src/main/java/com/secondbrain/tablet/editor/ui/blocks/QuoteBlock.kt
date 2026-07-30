package com.secondbrain.tablet.editor.ui.blocks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.ui.EditorTypography
import com.secondbrain.tablet.ui.theme.Slate400

@Composable
fun QuoteBlock(
    block: BlockState,
    vm: DocumentViewModel,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .width(3.dp)
                .background(Slate400),
        )
        BlockTextField(
            block = block,
            vm = vm,
            textStyle = EditorTypography.Quote,
            placeholder = "Quote",
            modifier = Modifier
                .weight(1f)
                .padding(start = 12.dp),
        )
    }
}
