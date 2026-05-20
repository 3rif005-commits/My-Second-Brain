package com.secondbrain.tablet.editor.ui.blocks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.ui.EditorTypography
import com.secondbrain.tablet.ui.theme.Gray700
import com.secondbrain.tablet.ui.theme.Indigo500
import com.secondbrain.tablet.ui.theme.Slate400

@Composable
fun CheckListBlock(
    block: BlockState,
    vm: DocumentViewModel,
    modifier: Modifier = Modifier,
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Icon(
            imageVector = if (block.checked) Icons.Default.CheckBox else Icons.Default.CheckBoxOutlineBlank,
            contentDescription = null,
            tint = if (block.checked) Indigo500 else Slate400,
            modifier = Modifier
                .padding(top = 2.dp, end = 8.dp)
                .size(20.dp)
                .clickable { vm.toggleChecked(block.id) },
        )
        val textStyle = if (block.checked) {
            EditorTypography.Body.copy(
                textDecoration = TextDecoration.LineThrough,
                color = Gray700,
            )
        } else {
            EditorTypography.Body
        }
        BlockTextField(
            block = block,
            vm = vm,
            textStyle = textStyle,
            placeholder = "To-do",
            modifier = Modifier.weight(1f),
        )
    }
}
