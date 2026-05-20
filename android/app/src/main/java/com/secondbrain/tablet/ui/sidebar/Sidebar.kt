package com.secondbrain.tablet.ui.sidebar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.secondbrain.tablet.data.Collection
import com.secondbrain.tablet.data.Note
import com.secondbrain.tablet.ui.theme.*
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

private const val PLACEHOLDER = "" // reserved

@Composable
fun Sidebar(
    notes: List<Note>,
    collections: List<Collection> = emptyList(),
    trashedNotes: List<Note>,
    selectedNoteId: String?,
    showChat: Boolean,
    filterTopic: String?,
    onClearTopicFilter: () -> Unit,
    onNoteClick: (String) -> Unit,
    onNewNote: () -> Unit,
    onChatClick: () -> Unit,
    onIngestClick: () -> Unit,
    onSearchClick: () -> Unit,
    onSignOut: () -> Unit,
    onRestoreNote: (String) -> Unit,
    onDeleteForever: (String) -> Unit,
    onNotesReordered: (List<String>) -> Unit,
    onToggleTheme: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val isDark = LocalDarkTheme.current
    var confirmSignOut by remember { mutableStateOf(false) }
    var trashExpanded  by remember { mutableStateOf(false) }
    val collExpanded = remember { mutableStateMapOf<String, Boolean>() }

    // Mutable reorderable list (syncs from props)
    val reorderableNotes = remember { mutableStateListOf<Note>() }
    LaunchedEffect(notes) {
        reorderableNotes.clear()
        reorderableNotes.addAll(notes)
    }

    val starred  = remember(reorderableNotes.toList()) { reorderableNotes.filter { it.isFavorited } }
    val recent   = remember(reorderableNotes.toList()) {
        reorderableNotes.filter { it.lastViewedAt != null }
            .sortedByDescending { it.lastViewedAt }
            .take(5)
    }

    val listState    = rememberLazyListState()
    val reorderState = rememberReorderableLazyListState(listState) { from, to ->
        val fromKey = from.key as? String ?: return@rememberReorderableLazyListState
        val toKey   = to.key   as? String ?: return@rememberReorderableLazyListState
        // Only reorder plain note keys (not prefixed with "star_", "recent_", "trash_")
        if (fromKey.contains("_") || toKey.contains("_")) return@rememberReorderableLazyListState
        val fromIdx = reorderableNotes.indexOfFirst { it.id == fromKey }
        val toIdx   = reorderableNotes.indexOfFirst { it.id == toKey }
        if (fromIdx >= 0 && toIdx >= 0) {
            reorderableNotes.add(toIdx, reorderableNotes.removeAt(fromIdx))
            onNotesReordered(reorderableNotes.map { it.id })
        }
    }

    Column(modifier = modifier.background(Slate900)) {

        // ── Brand header ──────────────────────────────────────────────
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(Indigo600),
                contentAlignment = Alignment.Center,
            ) { Text("🧠", fontSize = 16.sp) }
            Spacer(Modifier.width(10.dp))
            Text(
                "Second Brain",
                color = Gray50, fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp, letterSpacing = (-0.3).sp,
                modifier = Modifier.weight(1f),
            )
        }

        // ── Topic filter chip ─────────────────────────────────────────
        if (filterTopic != null) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(Indigo600.copy(alpha = 0.15f))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Topic: ", color = Slate400, fontSize = 12.sp)
                Text(filterTopic, color = Color(0xFFA5B4FC), fontSize = 12.sp, modifier = Modifier.weight(1f))
                IconButton(onClick = onClearTopicFilter, modifier = Modifier.size(20.dp)) {
                    Icon(Icons.Default.Close, null, Modifier.size(12.dp), tint = Slate400)
                }
            }
            Spacer(Modifier.height(4.dp))
        }

        // ── New Note ──────────────────────────────────────────────────
        Button(
            onClick = onNewNote,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp).height(36.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Indigo600),
            shape = RoundedCornerShape(8.dp),
            contentPadding = PaddingValues(horizontal = 12.dp),
        ) {
            Icon(Icons.Default.Add, null, Modifier.size(15.dp))
            Spacer(Modifier.width(6.dp))
            Text("New Note", fontSize = 13.sp, fontWeight = FontWeight.Medium)
        }

        Spacer(Modifier.height(4.dp))

        // ── Search ────────────────────────────────────────────────────
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp)
                .clip(RoundedCornerShape(6.dp))
                .clickable(onClick = onSearchClick)
                .padding(horizontal = 8.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.Search, null, Modifier.size(14.dp), tint = Slate400)
            Spacer(Modifier.width(8.dp))
            Text("Search", color = Slate400, fontSize = 13.sp, modifier = Modifier.weight(1f))
            Box(
                Modifier.clip(RoundedCornerShape(4.dp)).background(Gray800).padding(horizontal = 5.dp, vertical = 2.dp),
            ) { Text("⌘K", color = Slate400, fontSize = 10.sp) }
        }

        Spacer(Modifier.height(2.dp))

        // ── Nav items ─────────────────────────────────────────────────
        NavItem(Icons.Default.Chat, "AI Tutor", showChat, onChatClick)
        NavItem(Icons.Default.PictureAsPdf, "Import Knowledge", false, onIngestClick)

        HorizontalDivider(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), thickness = 0.5.dp, color = Gray700)

        // ── Scrollable sections ───────────────────────────────────────
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(bottom = 8.dp),
        ) {
            // ── Starred ───────────────────────────────────────────────
            if (starred.isNotEmpty()) {
                item { SectionLabel("STARRED") }
                items(starred, key = { "star_${it.id}" }) { note ->
                    SidebarNoteItem(note, note.id == selectedNoteId, onClick = { onNoteClick(note.id) })
                }
                item { Spacer(Modifier.height(4.dp)) }
            }

            // ── Recent ────────────────────────────────────────────────
            if (recent.isNotEmpty()) {
                item { SectionLabel("RECENT") }
                items(recent, key = { "recent_${it.id}" }) { note ->
                    SidebarNoteItem(note, note.id == selectedNoteId, onClick = { onNoteClick(note.id) })
                }
                item { Spacer(Modifier.height(4.dp)) }
            }

            // ── Collections (each with expand/collapse header) ────────────
            collections.sortedBy { it.position }.forEach { coll ->
                val collNotes = reorderableNotes.filter { it.collectionId == coll.id }
                if (collNotes.isNotEmpty()) {
                    val expanded = collExpanded[coll.id] ?: true
                    item(key = "coll_hdr_${coll.id}") {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { collExpanded[coll.id] = !expanded }
                                .padding(horizontal = 12.dp, vertical = 5.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                if (expanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight,
                                null, Modifier.size(12.dp), tint = Slate400,
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(coll.icon, fontSize = 11.sp)
                            Spacer(Modifier.width(5.dp))
                            Text(
                                coll.name,
                                color = Slate400, fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold, letterSpacing = 0.5.sp,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                "${collNotes.size}",
                                color = Slate400.copy(alpha = 0.6f), fontSize = 10.sp,
                            )
                        }
                    }
                    if (expanded) {
                        items(collNotes, key = { "cn_${coll.id}_${it.id}" }) { note ->
                            SidebarNoteItem(
                                note, note.id == selectedNoteId,
                                indent = true,
                                onClick = { onNoteClick(note.id) },
                            )
                        }
                    }
                }
            }

            // ── Uncollected notes (reorderable) ───────────────────────
            val uncollected = reorderableNotes.filter { it.collectionId == null }
            if (uncollected.isNotEmpty() || collections.isEmpty()) {
                item {
                    SectionLabel(
                        when {
                            filterTopic != null   -> "FILTERED NOTES"
                            collections.isNotEmpty() -> "NOTES"
                            else                  -> "NOTES"
                        }
                    )
                }
                items(uncollected.ifEmpty { reorderableNotes }, key = { it.id }) { note ->
                    ReorderableItem(reorderState, key = note.id) { isDragging ->
                        val bg = when {
                            isDragging                -> Color.White.copy(alpha = 0.05f)
                            note.id == selectedNoteId -> Color.White.copy(alpha = 0.08f)
                            else                      -> Color.Transparent
                        }
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 8.dp, vertical = 1.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(bg)
                                .clickable { onNoteClick(note.id) }
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(note.icon.ifBlank { "📄" }, fontSize = 12.sp)
                            Spacer(Modifier.width(6.dp))
                            Text(
                                note.title.ifBlank { "Untitled" },
                                color = if (note.id == selectedNoteId) Gray50 else Slate400,
                                fontSize = 13.sp,
                                fontWeight = if (note.id == selectedNoteId) FontWeight.Medium else FontWeight.Normal,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                            if (note.isFavorited) {
                                Text("★", color = Color(0xFFF59E0B), fontSize = 10.sp)
                                Spacer(Modifier.width(2.dp))
                            }
                            Icon(
                                Icons.Default.DragHandle,
                                "Drag to reorder",
                                Modifier.size(14.dp).draggableHandle(),
                                tint = Slate400.copy(alpha = 0.4f),
                            )
                        }
                    }
                }
            }

            // ── Trash ─────────────────────────────────────────────────
            if (trashedNotes.isNotEmpty()) {
                item { Spacer(Modifier.height(4.dp)) }
                item {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { trashExpanded = !trashExpanded }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Default.Delete, null, Modifier.size(11.dp), tint = Slate400)
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "TRASH", color = Slate400, fontSize = 10.sp,
                            fontWeight = FontWeight.Medium, letterSpacing = 1.sp,
                            modifier = Modifier.weight(1f),
                        )
                        Icon(
                            if (trashExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                            null, Modifier.size(14.dp), tint = Slate400,
                        )
                    }
                }
                if (trashExpanded) {
                    items(trashedNotes, key = { "trash_${it.id}" }) { note ->
                        TrashNoteItem(note, onRestore = { onRestoreNote(note.id) }, onDeleteForever = { onDeleteForever(note.id) })
                    }
                }
            }
        }

        // ── Sign out ──────────────────────────────────────────────────
        HorizontalDivider(thickness = 0.5.dp, color = Gray700)
        if (confirmSignOut) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("Sign out?", color = Slate400, fontSize = 12.sp, modifier = Modifier.weight(1f).padding(top = 6.dp))
                TextButton(onClick = onSignOut, colors = ButtonDefaults.textButtonColors(contentColor = Red500)) {
                    Text("Yes", fontSize = 12.sp)
                }
                TextButton(onClick = { confirmSignOut = false }, colors = ButtonDefaults.textButtonColors(contentColor = Slate400)) {
                    Text("No", fontSize = 12.sp)
                }
            }
        } else {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    Modifier
                        .weight(1f)
                        .clickable { confirmSignOut = true }
                        .padding(horizontal = 8.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Logout, null, Modifier.size(15.dp), tint = Slate400)
                    Spacer(Modifier.width(8.dp))
                    Text("Sign out", color = Slate400, fontSize = 13.sp)
                }
                IconButton(onClick = onToggleTheme) {
                    Icon(
                        if (isDark) Icons.Default.LightMode else Icons.Default.DarkMode,
                        contentDescription = if (isDark) "Switch to light mode" else "Switch to dark mode",
                        tint = Slate400,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun NavItem(icon: ImageVector, label: String, selected: Boolean, onClick: () -> Unit) {
    val bg        = if (selected) Indigo600.copy(alpha = 0.2f) else Color.Transparent
    val textColor = if (selected) Color(0xFFA5B4FC) else Slate400
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 1.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, Modifier.size(15.dp), tint = textColor)
        Spacer(Modifier.width(8.dp))
        Text(label, color = textColor, fontSize = 13.sp)
    }
}

@Composable
private fun SectionLabel(label: String) {
    Text(
        label, color = Slate400, fontSize = 10.sp,
        fontWeight = FontWeight.Medium, letterSpacing = 1.sp,
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

@Composable
private fun SidebarNoteItem(note: Note, selected: Boolean, indent: Boolean = false, onClick: () -> Unit) {
    val bg = if (selected) Color.White.copy(alpha = 0.08f) else Color.Transparent
    val startPad = if (indent) 20.dp else 8.dp
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = startPad, end = 8.dp, top = 1.dp, bottom = 1.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(note.icon.ifBlank { "📄" }, fontSize = 12.sp)
        Spacer(Modifier.width(6.dp))
        Text(
            note.title.ifBlank { "Untitled" },
            color = if (selected) Gray50 else Slate400,
            fontSize = 13.sp,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (note.isFavorited) {
            Spacer(Modifier.width(4.dp))
            Text("★", color = Color(0xFFF59E0B), fontSize = 10.sp)
        }
    }
}

@Composable
private fun TrashNoteItem(note: Note, onRestore: () -> Unit, onDeleteForever: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 1.dp)
            .clip(RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(note.icon.ifBlank { "📄" }, fontSize = 11.sp)
        Spacer(Modifier.width(6.dp))
        Text(
            note.title.ifBlank { "Untitled" },
            color = Slate400, fontSize = 12.sp, maxLines = 1,
            overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onRestore, modifier = Modifier.size(28.dp)) {
            Icon(Icons.Default.Restore, "Restore", Modifier.size(14.dp), tint = Color(0xFF6EE7B7))
        }
        IconButton(onClick = onDeleteForever, modifier = Modifier.size(28.dp)) {
            Icon(Icons.Default.DeleteForever, "Delete forever", Modifier.size(14.dp), tint = Red500)
        }
    }
}
