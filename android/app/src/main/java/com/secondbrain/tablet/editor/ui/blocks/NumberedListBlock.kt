package com.secondbrain.tablet.editor.ui.blocks

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.ui.EditorTypography
import com.secondbrain.tablet.editor.ui.LocalNumberedListIndex

@Composable
fun NumberedListBlock(
    block: BlockState,
    vm: DocumentViewModel,
    modifier: Modifier = Modifier,
) {
    val number = LocalNumberedListIndex.current[block.id] ?: 1
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(
            text = "$number.",
            style = EditorTypography.Body,
            textAlign = TextAlign.End,
            modifier = Modifier.width(28.dp).padding(top = 3.dp),
        )
        BlockTextField(
            block = block,
            vm = vm,
            textStyle = EditorTypography.Body,
            placeholder = "List item",
            modifier = Modifier.weight(1f).padding(start = 4.dp),
        )
    }
}
