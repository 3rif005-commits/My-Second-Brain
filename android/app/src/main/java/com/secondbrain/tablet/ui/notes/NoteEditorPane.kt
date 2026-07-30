package com.secondbrain.tablet.ui.notes

import android.content.Intent
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.secondbrain.tablet.data.Note
import com.secondbrain.tablet.data.NotesRepository
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.editor.serialization.HtmlSerializer
import com.secondbrain.tablet.editor.serialization.MarkdownSerializer
import com.secondbrain.tablet.editor.ui.NativeBlockEditor
import com.secondbrain.tablet.ui.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield

@Composable
fun NoteEditorPane(
    noteId: String,
    allNotes: List<Note>,
    onDeleted: () -> Unit,
    onOpenNote: (String) -> Unit,
    onNoteUpdated: (Note) -> Unit = {},
    onFilterByTopic: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // ── State ──────────────────────────────────────────────────────────────
    var note         by remember { mutableStateOf<Note?>(null) }
    var loadError    by remember { mutableStateOf<String?>(null) }
    var title        by remember { mutableStateOf("") }
    var saveStatus   by remember { mutableStateOf("") }
    var showMenu     by remember { mutableStateOf(false) }
    var showDelete   by remember { mutableStateOf(false) }
    var showProps    by remember { mutableStateOf(false) }
    var showIconPick by remember { mutableStateOf(false) }
    var isFavorited  by remember { mutableStateOf(false) }
    var currentIcon  by remember { mutableStateOf("📄") }
    var printHtml    by remember { mutableStateOf<String?>(null) }

    // ── DocumentViewModel — owned here so it uses NoteEditorPane's stable scope ──
    val vm = remember(noteId) {
        DocumentViewModel(
            noteId = noteId,
            saveCallback = { json, plain ->
                saveStatus = "Saving…"
                try {
                    NotesRepository.updateContent(noteId, title, json, plain)
                    saveStatus = "Saved"
                } catch (_: Exception) {
                    saveStatus = "Error saving"
                }
            },
            externalScope = scope,
        )
    }

    // Flush pending edits and cancel the old VM when switching notes.
    // Uses the stable NoteEditorPane scope, so it's never cancelled mid-flight.
    DisposableEffect(noteId) {
        onDispose {
            scope.launch { vm.flushPendingSave() }
            vm.cancel()
        }
    }

    // ── Load note ──────────────────────────────────────────────────────────
    LaunchedEffect(noteId) {
        note = null; loadError = null
        // yield() forces a real recomposition with note=null before loading,
        // so NativeBlockEditor leaves composition and the old VM is disposed cleanly.
        yield()
        try {
            val loaded = NotesRepository.getNote(noteId)
            note = loaded
            title = loaded.title
            isFavorited = loaded.isFavorited
            currentIcon = loaded.icon.ifBlank { "📄" }
            vm.loadFromJson(loaded.content, loaded.contentText)
            scope.launch { try { NotesRepository.updateLastViewed(noteId) } catch (_: Exception) {} }
        } catch (e: Exception) {
            loadError = e.message ?: "Failed to load note"
        }
    }


    // ── Auto-save title (debounced 800ms) ─────────────────────────────────
    LaunchedEffect(title) {
        if (note == null) return@LaunchedEffect
        delay(800)
        try {
            NotesRepository.updateTitle(noteId, title)
            saveStatus = "Saved"
        } catch (_: Exception) {
            saveStatus = "Error saving"
        }
    }

    // ── UI ─────────────────────────────────────────────────────────────────
    Box(modifier.background(MaterialTheme.colorScheme.background)) {
        Column(Modifier.fillMaxSize()) {

            // ── Toolbar ─────────────────────────────────────────────────
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(saveStatus, color = Slate400, fontSize = 11.sp, modifier = Modifier.weight(1f))

                // Star / favorite
                IconButton(
                    onClick = {
                        val newVal = !isFavorited
                        isFavorited = newVal
                        scope.launch {
                            try {
                                NotesRepository.updateFavorite(noteId, newVal)
                                note?.let { onNoteUpdated(it.copy(isFavorited = newVal)) }
                            } catch (_: Exception) { isFavorited = !newVal }
                        }
                    },
                    enabled = note != null,
                ) {
                    Icon(
                        if (isFavorited) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                        null,
                        tint = if (isFavorited) Red500 else Slate400,
                    )
                }

                // Properties
                IconButton(
                    onClick = { showProps = true },
                    enabled = note != null,
                ) {
                    Icon(Icons.Default.Info, null, tint = Slate400)
                }

                // ··· menu
                Box {
                    IconButton(onClick = { showMenu = true }) {
                        Text("···", color = Slate400, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    }
                    DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                        DropdownMenuItem(
                            text = { Text("Export Markdown") },
                            onClick = {
                                showMenu = false
                                val md = MarkdownSerializer.serialize(title, vm.blocks)
                                val intent = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, md)
                                    putExtra(Intent.EXTRA_SUBJECT, "$title.md")
                                }
                                context.startActivity(Intent.createChooser(intent, "Export as Markdown"))
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Export PDF") },
                            onClick = {
                                showMenu = false
                                printHtml = HtmlSerializer.serialize(title, vm.blocks)
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Share link") },
                            onClick = {
                                showMenu = false
                                scope.launch {
                                    try {
                                        NotesRepository.updatePublic(noteId, true)
                                        val url = "https://second-brain.vercel.app/share/$noteId"
                                        val clipboard = context.getSystemService(android.content.ClipboardManager::class.java)
                                        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Share link", url))
                                        val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                            type = "text/plain"
                                            putExtra(Intent.EXTRA_TEXT, url)
                                        }
                                        context.startActivity(Intent.createChooser(shareIntent, "Share note"))
                                    } catch (_: Exception) {}
                                }
                            },
                        )
                        HorizontalDivider()
                        DropdownMenuItem(
                            text = { Text("Delete note", color = Red500) },
                            leadingIcon = { Icon(Icons.Default.Delete, null, tint = Red500) },
                            onClick = { showMenu = false; showDelete = true },
                        )
                    }
                }
            }

            HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outline)

            // ── Breadcrumb ───────────────────────────────────────────────
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.background)
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("🧠", fontSize = 12.sp)
                Spacer(Modifier.width(4.dp))
                Text("Second Brain", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                Text("  ›  ", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                Text(
                    text = title.ifBlank { "Untitled" },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }

            // ── Title row with icon ──────────────────────────────────────
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.background)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Icon/emoji button
                Box(
                    Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(enabled = note != null) { showIconPick = true },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(currentIcon, fontSize = 24.sp)
                }

                Spacer(Modifier.width(10.dp))

                BasicTextField(
                    value = title,
                    onValueChange = { title = it; saveStatus = "Saving…" },
                    enabled = note != null,
                    textStyle = TextStyle(
                        color = MaterialTheme.colorScheme.onBackground,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                    ),
                    cursorBrush = SolidColor(Indigo500),
                    decorationBox = { inner ->
                        Box(Modifier.fillMaxWidth()) {
                            if (title.isEmpty()) Text(
                                "Untitled",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Bold,
                            )
                            inner()
                        }
                    },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
            }

            HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outline)

            // ── Native block editor ───────────────────────────────────
            Box(Modifier.weight(1f)) {
                when {
                    loadError != null -> Box(
                        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
                        Alignment.Center,
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Text("Failed to load note", color = Red500, fontSize = 15.sp)
                            Text(loadError!!, color = Slate400, fontSize = 12.sp)
                            TextButton(onClick = {
                                loadError = null
                                scope.launch {
                                    try {
                                        val loaded = NotesRepository.getNote(noteId)
                                        note = loaded; title = loaded.title
                                        isFavorited = loaded.isFavorited
                                        currentIcon = loaded.icon.ifBlank { "📄" }
                                        vm.loadFromJson(loaded.content, loaded.contentText)
                                    } catch (e: Exception) { loadError = e.message }
                                }
                            }) { Text("Retry", color = Indigo500) }
                        }
                    }

                    !vm.isLoaded -> Box(
                        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
                        Alignment.Center,
                    ) {
                        CircularProgressIndicator(color = Indigo500)
                    }

                    else -> NativeBlockEditor(
                        vm = vm,
                        allNotes = allNotes.filter { it.id != noteId },
                        onOpenNote = onOpenNote,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }

            // ── Backlinks panel ───────────────────────────────────────────
            val backlinks = remember(noteId, allNotes) {
                allNotes.filter { it.id != noteId && it.content.toString().contains(noteId) }
            }
            if (backlinks.isNotEmpty()) {
                var backlinksExpanded by remember { mutableStateOf(false) }
                HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outline)
                Column {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { backlinksExpanded = !backlinksExpanded }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "Referenced by ${backlinks.size} note${if (backlinks.size == 1) "" else "s"}",
                            color = Slate400,
                            fontSize = 12.sp,
                            modifier = Modifier.weight(1f),
                        )
                        Icon(
                            if (backlinksExpanded) Icons.Default.KeyboardArrowUp
                            else Icons.Default.KeyboardArrowDown,
                            null,
                            Modifier.size(16.dp),
                            tint = Slate400,
                        )
                    }
                    if (backlinksExpanded) {
                        backlinks.forEach { linked ->
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .clickable { onOpenNote(linked.id) }
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(linked.icon.ifBlank { "📄" }, fontSize = 14.sp)
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    linked.title.ifBlank { "Untitled" },
                                    color = Indigo500,
                                    fontSize = 13.sp,
                                )
                            }
                        }
                    }
                }
            }
        }

        // ── Delete dialog ─────────────────────────────────────────────────
        if (showDelete) {
            AlertDialog(
                onDismissRequest = { showDelete = false },
                title = { Text("Delete note?") },
                text  = { Text("This will permanently remove the note.") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            showDelete = false
                            scope.launch {
                                try { NotesRepository.deleteNote(noteId) } catch (_: Exception) {}
                                onDeleted()
                            }
                        },
                        colors = ButtonDefaults.textButtonColors(contentColor = Red500),
                    ) { Text("Delete") }
                },
                dismissButton = {
                    TextButton(onClick = { showDelete = false }) { Text("Cancel") }
                },
            )
        }

        // ── Properties dialog ─────────────────────────────────────────────
        if (showProps) {
            note?.let { n ->
                NotePropertiesDialog(
                    note = n,
                    onDismiss = { showProps = false },
                    onUpdated = { updated ->
                        note = updated
                        onNoteUpdated(updated)
                    },
                    onTopicClick = onFilterByTopic,
                )
            }
        }

        // ── Icon picker ───────────────────────────────────────────────────
        if (showIconPick) {
            IconPickerDialog(
                currentIcon = currentIcon,
                onIconSelected = { emoji ->
                    currentIcon = emoji
                    scope.launch {
                        try {
                            NotesRepository.updateIcon(noteId, emoji)
                            note?.let { onNoteUpdated(it.copy(icon = emoji)) }
                        } catch (_: Exception) {}
                    }
                },
                onDismiss = { showIconPick = false },
            )
        }

        // ── Hidden WebView PDF printer ────────────────────────────────────
        printHtml?.let { html ->
            val printTitle = title
            Box(Modifier.size(0.dp)) {
                AndroidView(factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = false
                        webViewClient = object : WebViewClient() {
                            override fun onPageFinished(view: WebView?, url: String?) {
                                val printManager = ctx.getSystemService(PrintManager::class.java)
                                val adapter = view!!.createPrintDocumentAdapter(printTitle)
                                printManager.print(
                                    printTitle,
                                    adapter,
                                    PrintAttributes.Builder().build(),
                                )
                                printHtml = null
                            }
                        }
                        loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
                    }
                })
            }
        }
    }
}

