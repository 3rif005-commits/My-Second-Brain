package com.secondbrain.tablet.editor.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object EditorTypography {
    val Body: TextStyle
        @Composable get() = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, color = MaterialTheme.colorScheme.onBackground)

    val H1: TextStyle
        @Composable get() = TextStyle(fontSize = 48.sp, lineHeight = 56.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)

    val H2: TextStyle
        @Composable get() = TextStyle(fontSize = 32.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)

    val H3: TextStyle
        @Composable get() = TextStyle(fontSize = 21.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onBackground)

    val Quote: TextStyle
        @Composable get() = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

    val Code: TextStyle
        @Composable get() = TextStyle(fontSize = 13.sp, lineHeight = 20.sp, fontFamily = FontFamily.Monospace, color = Color(0xFFA5B4FC))

    val Callout: TextStyle
        @Composable get() = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, color = MaterialTheme.colorScheme.onBackground)
}
