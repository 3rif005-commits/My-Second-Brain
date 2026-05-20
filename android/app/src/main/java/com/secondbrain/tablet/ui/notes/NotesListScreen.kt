package com.secondbrain.tablet.ui.notes

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.secondbrain.tablet.data.Note
import com.secondbrain.tablet.data.NotesRepository
import com.secondbrain.tablet.data.supabase
import io.github.jan.supabase.gotrue.auth
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotesListScreen(
    onNoteClick: (String) -> Unit,
    onChatClick: () -> Unit,
    onIngestClick: () -> Unit,
    onSignOut: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var notes by remember { mutableStateOf<List<Note>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            notes = NotesRepository.listNotes()
        } catch (e: Exception) {
            error = e.message
        } finally {
            loading = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("⚡ Second Brain") },
                actions = {
                    IconButton(onClick = onChatClick) {
                        Icon(Icons.Default.Chat, "Chat with AI")
                    }
                    IconButton(onClick = {
                        scope.launch {
                            supabase.auth.signOut()
                            onSignOut()
                        }
                    }) {
                        Icon(Icons.Default.Logout, "Sign out")
                    }
                }
            )
        },
        floatingActionButton = {
            Column(horizontalAlignment = Alignment.End) {
                SmallFloatingActionButton(onClick = onIngestClick) {
                    Icon(Icons.Default.PictureAsPdf, "Ingest PDF")
                }
                Spacer(Modifier.height(8.dp))
                FloatingActionButton(onClick = {
                    scope.launch {
                        try {
                            val note = NotesRepository.createNote("Untitled", "")
                            onNoteClick(note.id)
                        } catch (e: Exception) {
                            error = e.message
                        }
                    }
                }) {
                    Icon(Icons.Default.Add, "New note")
                }
            }
        }
    ) { padding ->
        when {
            loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                CircularProgressIndicator()
            }
            error != null -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                Text("Error: $error", color = MaterialTheme.colorScheme.error)
            }
            notes.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("No notes yet", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    Text("Tap + to create one or import a PDF", style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            else -> LazyColumn(contentPadding = padding) {
                items(notes, key = { it.id }) { note ->
                    NoteListItem(note, onClick = { onNoteClick(note.id) }, onDelete = {
                        scope.launch {
                            NotesRepository.deleteNote(note.id)
                            notes = NotesRepository.listNotes()
                        }
                    })
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun NoteListItem(note: Note, onClick: () -> Unit, onDelete: () -> Unit) {
    var showMenu by remember { mutableStateOf(false) }
    ListItem(
        headlineContent = { Text(note.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Text(
                note.contentText?.take(80) ?: note.topics.joinToString(", "),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        },
        trailingContent = {
            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(Icons.Default.MoreVert, "Options")
                }
                DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                    DropdownMenuItem(
                        text = { Text("Delete") },
                        leadingIcon = { Icon(Icons.Default.Delete, null) },
                        onClick = { showMenu = false; onDelete() }
                    )
                }
            }
        },
        modifier = Modifier.clickable(onClick = onClick)
    )
}
