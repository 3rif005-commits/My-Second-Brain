package com.secondbrain.tablet.ui.search

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.secondbrain.tablet.data.Note
import com.secondbrain.tablet.data.NotesRepository
import com.secondbrain.tablet.ui.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun SearchDialog(
    onDismiss: () -> Unit,
    onNoteSelected: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Note>>(emptyList()) }
    var isSearching by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }

    // Debounced search — 300ms, tries Supabase FTS then falls back to local
    LaunchedEffect(query) {
        if (query.isBlank()) { results = emptyList(); return@LaunchedEffect }
        delay(300)
        isSearching = true
        try {
            results = NotesRepository.searchNotes(query)
        } catch (_: Exception) {
            results = emptyList()
        } finally {
            isSearching = false
        }
    }

    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.6f))
                .clickable(onClick = onDismiss),
            contentAlignment = Alignment.TopCenter,
        ) {
            Column(
                Modifier
                    .padding(top = 80.dp)
                    .width(560.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .clickable(onClick = {}) // Prevent dismiss when clicking inside
            ) {
                // ── Search input ──────────────────────────────────────────────
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Search, null, Modifier.size(18.dp), tint = Slate400)
                    Spacer(Modifier.width(10.dp))
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        modifier = Modifier.weight(1f).focusRequester(focusRequester),
                        textStyle = TextStyle(color = MaterialTheme.colorScheme.onBackground, fontSize = 15.sp),
                        cursorBrush = SolidColor(Indigo500),
                        singleLine = true,
                        decorationBox = { inner ->
                            if (query.isEmpty()) Text(
                                "Search notes…",
                                color = Slate400,
                                fontSize = 15.sp,
                            )
                            inner()
                        },
                    )
                    if (query.isNotEmpty()) {
                        IconButton(onClick = { query = "" }, modifier = Modifier.size(28.dp)) {
                            Icon(Icons.Default.Close, null, Modifier.size(15.dp), tint = Slate400)
                        }
                    }
                }

                HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outline)

                // ── Results ───────────────────────────────────────────────────
                when {
                    isSearching -> Box(
                        Modifier.fillMaxWidth().padding(32.dp),
                        Alignment.Center,
                    ) { CircularProgressIndicator(Modifier.size(24.dp), color = Indigo500, strokeWidth = 2.dp) }

                    query.isNotEmpty() && results.isEmpty() -> Box(
                        Modifier.fillMaxWidth().padding(32.dp),
                        Alignment.Center,
                    ) { Text("No notes found for \"$query\"", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp) }

                    results.isNotEmpty() -> LazyColumn(
                        Modifier.heightIn(max = 400.dp),
                        contentPadding = PaddingValues(vertical = 6.dp),
                    ) {
                        items(results) { note ->
                            SearchResultItem(
                                note = note,
                                onClick = {
                                    scope.launch {
                                        onNoteSelected(note.id)
                                        onDismiss()
                                    }
                                },
                            )
                        }
                    }

                    else -> Box(
                        Modifier.fillMaxWidth().padding(32.dp),
                        Alignment.Center,
                    ) { Text("Start typing to search your notes", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp) }
                }
            }
        }
    }
}

@Composable
private fun SearchResultItem(note: Note, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(note.icon.ifBlank { "📄" }, fontSize = 16.sp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                note.title.ifBlank { "Untitled" },
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (note.topics.isNotEmpty()) {
                Text(
                    note.topics.joinToString(" · "),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
