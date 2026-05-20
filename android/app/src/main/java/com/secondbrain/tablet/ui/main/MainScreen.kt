package com.secondbrain.tablet.ui.main

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.secondbrain.tablet.data.Collection
import com.secondbrain.tablet.data.Note
import com.secondbrain.tablet.data.NotesRepository
import com.secondbrain.tablet.data.supabase
import com.secondbrain.tablet.ui.chat.ChatPane
import com.secondbrain.tablet.ui.ingest.IngestDialog
import com.secondbrain.tablet.ui.notes.NoteEditorPane
import com.secondbrain.tablet.ui.search.SearchDialog
import com.secondbrain.tablet.ui.sidebar.Sidebar
import com.secondbrain.tablet.ui.theme.*
import io.github.jan.supabase.gotrue.SessionStatus
import io.github.jan.supabase.gotrue.auth
import kotlinx.coroutines.launch

@Composable
fun MainScreen(onSignOut: () -> Unit, onToggleTheme: () -> Unit = {}) {
    val scope = rememberCoroutineScope()
    var notes by remember { mutableStateOf<List<Note>>(emptyList()) }
    var trashedNotes by remember { mutableStateOf<List<Note>>(emptyList()) }
    var collections by remember { mutableStateOf<List<Collection>>(emptyList()) }
    var selectedNoteId by remember { mutableStateOf<String?>(null) }
    var showChat by remember { mutableStateOf(false) }
    var showIngest by remember { mutableStateOf(false) }
    var showSearch by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    var pendingFileUri by remember { mutableStateOf<Uri?>(null) }

    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val prefs = remember { context.getSharedPreferences("app_prefs", Context.MODE_PRIVATE) }
    val isTablet = configuration.screenWidthDp >= 600
    var sidebarOpen by remember { mutableStateOf(prefs.getBoolean("sidebar_open", isTablet)) }
    var filterTopic by remember { mutableStateOf<String?>(null) }
    val displayNotes = remember(notes, filterTopic) {
        if (filterTopic != null) notes.filter { filterTopic!! in it.topics } else notes
    }
    val sidebarWidth by animateDpAsState(
        targetValue = if (sidebarOpen) 260.dp else 0.dp,
        animationSpec = tween(durationMillis = 240, easing = FastOutSlowInEasing),
        label = "sidebar_width",
    )
    LaunchedEffect(sidebarOpen) {
        prefs.edit().putBoolean("sidebar_open", sidebarOpen).apply()
    }

    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        android.util.Log.d("MainScreen", "filePicker result: code=${result.resultCode} data=${result.data} uri=${result.data?.data}")
        val uri = result.data?.data ?: run {
            android.util.Log.w("MainScreen", "filePicker: no URI in result — ignoring")
            return@rememberLauncherForActivityResult
        }
        pendingFileUri = uri
        showIngest = true  // Re-open dialog if MIUI reset it while picker was open
        android.util.Log.d("MainScreen", "filePicker: set pendingFileUri=$uri showIngest=true")
    }

    // Load from local DB immediately (no network needed)
    fun loadLocal() {
        try {
            notes = NotesRepository.listNotes()
            trashedNotes = NotesRepository.listTrashed()
            collections = NotesRepository.listCollections()
        } catch (_: Exception) {}
    }

    // Background sync: push dirty → pull server → refresh list
    suspend fun syncAndRefresh() {
        isLoading = true
        loadError = null
        try {
            NotesRepository.sync()
        } catch (e: Exception) {
            // Only show non-network errors (network failures are expected offline)
            val msg = e.message ?: ""
            if (!msg.contains("Unable to resolve host") && !msg.contains("Network is unreachable")
                && !msg.contains("failed to connect") && !msg.contains("timeout", ignoreCase = true)) {
                loadError = msg
            }
        } finally {
            notes = NotesRepository.listNotes()
            collections = NotesRepository.listCollections()
            isLoading = false
        }
    }

    fun refreshNotes() {
        loadLocal()
    }

    // Update a single note in the local list without a full refresh
    fun updateNoteInList(updated: Note) {
        notes = notes.map { if (it.id == updated.id) updated else it }
    }

    // Load local notes immediately on first composition
    LaunchedEffect(Unit) { loadLocal() }

    // On every Authenticated event: run sync in background, then refresh list
    LaunchedEffect(Unit) {
        supabase.auth.sessionStatus.collect { status ->
            if (status is SessionStatus.Authenticated) {
                syncAndRefresh()
            }
        }
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding()) {

        // ── Error banner ───────────────────────────────────────────────
        if (loadError != null) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Red500.copy(alpha = 0.15f))
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "⚠ ${loadError}",
                    color = Red500,
                    fontSize = 12.sp,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { refreshNotes() }) {
                    Text("Retry", color = Red500, fontSize = 12.sp)
                }
            }
        }

        Row(Modifier.weight(1f)) {
            // ── Sidebar ─────────────────────────────────────────────────
            Sidebar(
                notes = displayNotes,
                collections = collections,
                trashedNotes = trashedNotes,
                selectedNoteId = selectedNoteId,
                showChat = showChat,
                filterTopic = filterTopic,
                onClearTopicFilter = { filterTopic = null },
                onNoteClick = { id ->
                    selectedNoteId = id
                    showChat = false
                },
                onNewNote = {
                    scope.launch {
                        try {
                            val note = NotesRepository.createNote("Untitled", "")
                            loadLocal()
                            selectedNoteId = note.id
                            showChat = false
                        } catch (e: Exception) {
                            loadError = e.message ?: "Failed to create note"
                        }
                    }
                },
                onChatClick = {
                    showChat = true
                    selectedNoteId = null
                },
                onIngestClick = { showIngest = true },
                onSearchClick = { showSearch = true },
                onNotesReordered = { orderedIds ->
                    scope.launch { NotesRepository.updatePositions(orderedIds) }
                },
                onToggleTheme = onToggleTheme,

                onSignOut = {
                    scope.launch {
                        try { supabase.auth.signOut() } catch (_: Exception) {}
                        onSignOut()
                    }
                },
                onRestoreNote = { id ->
                    scope.launch {
                        try {
                            NotesRepository.restoreNote(id)
                            loadLocal()
                        } catch (e: Exception) {
                            loadError = e.message ?: "Failed to restore note"
                        }
                    }
                },
                onDeleteForever = { id ->
                    if (selectedNoteId == id) selectedNoteId = null
                    scope.launch {
                        try {
                            NotesRepository.permanentDelete(id)
                            loadLocal()
                        } catch (e: Exception) {
                            loadError = e.message ?: "Failed to delete note"
                        }
                    }
                },
                modifier = Modifier.width(sidebarWidth).fillMaxHeight().clipToBounds(),
            )

            // ── Divider ─────────────────────────────────────────────────
            if (sidebarWidth > 0.dp) {
                Box(Modifier.width(1.dp).fillMaxHeight().background(MaterialTheme.colorScheme.outline))
            }

            // ── Content pane ─────────────────────────────────────────────
            Box(Modifier.weight(1f).fillMaxHeight()) {
                when {
                    showChat -> ChatPane(Modifier.fillMaxSize())

                    selectedNoteId != null -> NoteEditorPane(
                        noteId = selectedNoteId!!,
                        allNotes = notes,
                        onDeleted = {
                            selectedNoteId = null
                            loadLocal()
                        },
                        onOpenNote = { id ->
                            selectedNoteId = id
                            scope.launch {
                                try {
                                    val updated = NotesRepository.getNote(id)
                                    updateNoteInList(updated)
                                } catch (_: Exception) {}
                            }
                        },
                        onNoteUpdated = { updated ->
                            updateNoteInList(updated)
                        },
                        onFilterByTopic = { topic ->
                            filterTopic = topic
                            sidebarOpen = true
                        },
                        modifier = Modifier.fillMaxSize(),
                    )

                    else -> EmptyState(
                        isLoading = isLoading,
                        onNewNote = {
                            scope.launch {
                                try {
                                    val note = NotesRepository.createNote("Untitled", "")
                                    loadLocal()
                                    selectedNoteId = note.id
                                } catch (e: Exception) {
                                    loadError = e.message ?: "Failed to create note"
                                }
                            }
                        },
                    )
                }

                // ── Hamburger toggle ─────────────────────────────────────
                IconButton(
                    onClick = { sidebarOpen = !sidebarOpen },
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(4.dp),
                ) {
                    Icon(
                        imageVector = Icons.Default.Menu,
                        contentDescription = if (sidebarOpen) "Close sidebar" else "Open sidebar",
                        tint = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.6f),
                    )
                }
            }
        }
    }

    // ── PDF ingest overlay ────────────────────────────────────────────
    if (showIngest) {
        IngestDialog(
            onDismiss = { showIngest = false },
            onNoteCreated = { id ->
                showIngest = false
                selectedNoteId = id
                showChat = false
                loadLocal()
            },
            pendingFileUri = pendingFileUri,
            onFilePicked = {
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/pdf", "text/plain", "text/markdown"))
                    addCategory(Intent.CATEGORY_OPENABLE)
                }
                filePicker.launch(intent)
            },
            onFileUriConsumed = { pendingFileUri = null },
        )
    }

    // ── Search overlay ────────────────────────────────────────────────
    if (showSearch) {
        SearchDialog(
            onDismiss = { showSearch = false },
            onNoteSelected = { id ->
                selectedNoteId = id
                showChat = false
                showSearch = false
                loadLocal()
            },
        )
    }
}

@Composable
private fun EmptyState(isLoading: Boolean, onNewNote: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier
                .size(72.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(
                    androidx.compose.ui.graphics.Brush.linearGradient(
                        listOf(Indigo700, Indigo500)
                    )
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text("🧠", fontSize = 34.sp)
        }
        Spacer(Modifier.height(20.dp))
        Text("Your Second Brain", color = MaterialTheme.colorScheme.onBackground, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        if (isLoading) {
            CircularProgressIndicator(Modifier.size(24.dp), color = Indigo500, strokeWidth = 2.dp)
        } else {
            Text(
                "Select a note from the sidebar or create a new one",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 14.sp,
            )
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = onNewNote,
                colors = ButtonDefaults.buttonColors(containerColor = Indigo600),
                shape = RoundedCornerShape(10.dp),
            ) {
                Icon(Icons.Default.Edit, null, Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("New Note", fontSize = 14.sp)
            }
        }
    }
}
