package com.secondbrain.tablet.editor.ui.menus

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.editor.model.BlockType
import com.secondbrain.tablet.editor.model.BlockColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import com.secondbrain.tablet.editor.ui.EditorColors
import com.secondbrain.tablet.ui.theme.Indigo500
import com.secondbrain.tablet.ui.theme.Red500
import com.secondbrain.tablet.ui.theme.Slate400

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BlockActionsMenu(
    onDismiss: () -> Unit,
    block: BlockState,
    vm: DocumentViewModel,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val currentItem = AllSlashItems.find { it.type == block.type }
    val turnIntoItems = AllSlashItems.filter { it.type != BlockType.Divider }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
        dragHandle = {
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .size(width = 36.dp, height = 4.dp)
                        .background(MaterialTheme.colorScheme.outline, RoundedCornerShape(2.dp))
                )
            }
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
        ) {
            // Current block type header
            Text(
                text = currentItem?.label ?: "Block",
                color = Slate400,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
            )

            HorizontalDivider(color = MaterialTheme.colorScheme.outline, thickness = 0.5.dp)

            // "TURN INTO" section label
            Text(
                text = "TURN INTO",
                color = Slate400,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.8.sp,
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 4.dp),
            )

            // Block type list
            turnIntoItems.forEach { item ->
                val isCurrent = item.type == block.type
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            if (!isCurrent) vm.changeType(block.id, item.type)
                            onDismiss()
                        }
                        .padding(horizontal = 20.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) {
                        Text(
                            text = item.symbol,
                            fontSize = 14.sp,
                            color = if (isCurrent) Indigo500 else Slate400,
                        )
                    }
                    Text(
                        text = item.label,
                        color = if (isCurrent) Indigo500 else MaterialTheme.colorScheme.onSurface,
                        fontSize = 15.sp,
                        modifier = Modifier.weight(1f),
                    )
                    if (isCurrent) {
                        Icon(Icons.Default.Check, null, tint = Indigo500, modifier = Modifier.size(16.dp))
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outline, thickness = 0.5.dp)

            // Duplicate
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { vm.duplicateBlock(block.id); onDismiss() }
                    .padding(horizontal = 20.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon(Icons.Default.ContentCopy, null, tint = MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(18.dp))
                Text("Duplicate", color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp)
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outline, thickness = 0.5.dp)

            // Delete
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { vm.deleteBlock(block.id); onDismiss() }
                    .padding(horizontal = 20.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon(Icons.Default.Delete, null, tint = Red500, modifier = Modifier.size(18.dp))
                Text("Delete", color = Red500, fontSize = 15.sp)
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outline, thickness = 0.5.dp)

            // Background color
            Text(
                text          = "BACKGROUND COLOR",
                color         = Slate400,
                fontSize      = 11.sp,
                fontWeight    = FontWeight.SemiBold,
                letterSpacing = 0.8.sp,
                modifier      = Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 8.dp),
            )

            val colorEntries = BlockColor.entries
            Column(modifier = Modifier.padding(horizontal = 20.dp)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier              = Modifier.fillMaxWidth().padding(bottom = 10.dp),
                ) {
                    colorEntries.take(5).forEach { color ->
                        ColorSwatch(
                            color      = color,
                            isSelected = block.color == color,
                            onClick    = { vm.setBackgroundColor(block.id, color); onDismiss() },
                            modifier   = Modifier.weight(1f),
                        )
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier              = Modifier.fillMaxWidth(),
                ) {
                    colorEntries.drop(5).forEach { color ->
                        ColorSwatch(
                            color      = color,
                            isSelected = block.color == color,
                            onClick    = { vm.setBackgroundColor(block.id, color); onDismiss() },
                            modifier   = Modifier.weight(1f),
                        )
                    }
                }
            }

            Spacer(Modifier.height(32.dp))
        }
    }
}
