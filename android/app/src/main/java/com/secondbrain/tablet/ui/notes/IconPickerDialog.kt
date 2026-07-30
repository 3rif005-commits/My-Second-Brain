package com.secondbrain.tablet.ui.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.secondbrain.tablet.ui.theme.*

private val ICON_EMOJIS = listOf(
    "📄", "📝", "📚", "📖", "🧠", "💡", "🔬", "🧪",
    "💻", "🖥️", "🤖", "🧬", "🔭", "🌍", "🗺️", "📊",
    "📈", "💰", "🎯", "🏆", "⚡", "🔥", "💎", "🌟",
    "🎨", "🎵", "🎬", "🎮", "🏋️", "🌿", "🍀", "☀️",
    "🔑", "🗝️", "📌", "📎", "✅", "❓", "💬", "📧",
    "🏠", "🏢", "🚀", "✈️", "⚙️", "🔧", "🛠️", "📡",
)

@Composable
fun IconPickerDialog(
    currentIcon: String,
    onIconSelected: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Gray800,
        title = {
            Text("Choose Icon", color = Gray50, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        },
        text = {
            LazyVerticalGrid(
                columns = GridCells.Fixed(8),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.height(260.dp),
            ) {
                items(ICON_EMOJIS) { emoji ->
                    val selected = emoji == currentIcon
                    Box(
                        Modifier
                            .size(40.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (selected) Indigo600.copy(alpha = 0.3f) else androidx.compose.ui.graphics.Color.Transparent)
                            .clickable { onIconSelected(emoji); onDismiss() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(emoji, fontSize = 20.sp)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = Slate400)
            }
        },
    )
}
