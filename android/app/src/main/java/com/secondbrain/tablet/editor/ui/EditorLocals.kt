package com.secondbrain.tablet.editor.ui

import androidx.compose.runtime.compositionLocalOf

val LocalNumberedListIndex = compositionLocalOf<Map<String, Int>> { emptyMap() }
val LocalOpenNote          = compositionLocalOf<(String) -> Unit> { {} }
