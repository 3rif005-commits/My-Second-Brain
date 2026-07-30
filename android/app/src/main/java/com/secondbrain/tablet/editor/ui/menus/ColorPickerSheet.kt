package com.secondbrain.tablet.editor.ui.menus

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.model.BlockColor
import com.secondbrain.tablet.editor.ui.EditorColors
import com.secondbrain.tablet.ui.theme.Gray700
import com.secondbrain.tablet.ui.theme.Gray800
import com.secondbrain.tablet.ui.theme.Gray50
import com.secondbrain.tablet.ui.theme.Indigo500
import com.secondbrain.tablet.ui.theme.Slate400

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ColorPickerSheet(
    blockId: String,
    currentColor: BlockColor,
    vm: DocumentViewModel,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState       = sheetState,
        containerColor   = Gray800,
        contentColor     = Gray50,
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
                        .background(Gray700, RoundedCornerShape(2.dp))
                )
            }
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
        ) {
            Text(
                text          = "BACKGROUND COLOR",
                color         = Slate400,
                fontSize      = 11.sp,
                fontWeight    = FontWeight.SemiBold,
                letterSpacing = 0.8.sp,
                modifier      = Modifier.padding(bottom = 16.dp),
            )

            val entries = BlockColor.entries
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier              = Modifier.fillMaxWidth(),
            ) {
                entries.take(5).forEach { color ->
                    ColorSwatch(
                        color      = color,
                        isSelected = color == currentColor,
                        onClick    = { vm.setBackgroundColor(blockId, color); onDismiss() },
                        modifier   = Modifier.weight(1f),
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier              = Modifier.fillMaxWidth(),
            ) {
                entries.drop(5).forEach { color ->
                    ColorSwatch(
                        color      = color,
                        isSelected = color == currentColor,
                        onClick    = { vm.setBackgroundColor(blockId, color); onDismiss() },
                        modifier   = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

@Composable
fun ColorSwatch(
    color: BlockColor,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val fill = EditorColors.swatchColor(color)
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .aspectRatio(1f)
            .clip(CircleShape)
            .border(
                width = if (isSelected) 2.dp else 1.dp,
                color = if (isSelected) Indigo500 else Gray700,
                shape = CircleShape,
            )
            .background(fill)
            .clickable(onClick = onClick),
    ) {
        if (color == BlockColor.Default) {
            Icon(
                imageVector        = Icons.Default.Close,
                contentDescription = "No color",
                tint               = Slate400,
                modifier           = Modifier.size(14.dp),
            )
        }
    }
}
