package com.secondbrain.tablet.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color

val Indigo500  = Color(0xFF6366F1)
val Indigo600  = Color(0xFF4F46E5)
val Indigo700  = Color(0xFF4338CA)
val Slate900   = Color(0xFF0F172A)
val Slate800   = Color(0xFF1E293B)
val Slate400   = Color(0xFF94A3B8)
val Gray900    = Color(0xFF111827)
val Gray800    = Color(0xFF1F2937)
val Gray700    = Color(0xFF374151)
val Gray200    = Color(0xFFE5E7EB)
val Gray50     = Color(0xFFF9FAFB)
val Red500     = Color(0xFFEF4444)

val LocalDarkTheme = compositionLocalOf { true }

private val DarkColors = darkColorScheme(
    primary             = Indigo500,
    onPrimary           = Color.White,
    primaryContainer    = Indigo700,
    onPrimaryContainer  = Color.White,
    secondary           = Slate400,
    onSecondary         = Color.White,
    background          = Gray900,
    onBackground        = Gray50,
    surface             = Slate900,
    onSurface           = Gray200,
    surfaceVariant      = Gray800,
    onSurfaceVariant    = Slate400,
    outline             = Gray700,
    error               = Red500,
    onError             = Color.White,
)

private val LightColors = lightColorScheme(
    primary             = Indigo600,
    onPrimary           = Color.White,
    primaryContainer    = Color(0xFFEEF2FF),
    onPrimaryContainer  = Indigo700,
    secondary           = Color(0xFF64748B),
    onSecondary         = Color.White,
    background          = Color(0xFFF8FAFC),
    onBackground        = Color(0xFF0F172A),
    surface             = Color.White,
    onSurface           = Color(0xFF1E293B),
    surfaceVariant      = Color(0xFFF1F5F9),
    onSurfaceVariant    = Color(0xFF64748B),
    outline             = Color(0xFFCBD5E1),
    error               = Red500,
    onError             = Color.White,
)

@Composable
fun SecondBrainTheme(darkTheme: Boolean = true, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
