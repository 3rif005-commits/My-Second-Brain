package com.secondbrain.tablet.editor.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import com.secondbrain.tablet.data.Note
import com.secondbrain.tablet.editor.DocumentViewModel

@Composable
fun NativeBlockEditor(
    vm: DocumentViewModel,
    allNotes: List<Note>,
    onOpenNote: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(allNotes) { vm.updateNotes(allNotes) }
    CompositionLocalProvider(LocalOpenNote provides onOpenNote) {
        BlockEditor(vm = vm, modifier = modifier)
    }
}
