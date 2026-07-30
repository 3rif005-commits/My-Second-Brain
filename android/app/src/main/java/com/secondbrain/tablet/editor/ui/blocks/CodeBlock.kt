package com.secondbrain.tablet.editor.ui.blocks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.ui.EditorTypography

private val CodeBackground = Color(0xFF1E1E2E)

@Composable
fun CodeBlock(
    block: BlockState,
    vm: DocumentViewModel,
    modifier: Modifier = Modifier,
) {
    BlockTextField(
        block = block,
        vm = vm,
        textStyle = EditorTypography.Code,
        placeholder = "Code",
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(CodeBackground)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    )
}
