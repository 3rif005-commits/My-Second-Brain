package com.secondbrain.tablet.ui.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.secondbrain.tablet.data.Note
import com.secondbrain.tablet.data.NotesRepository
import com.secondbrain.tablet.ui.theme.*
import kotlinx.coroutines.launch

private val MASTERY_STATES = listOf(
    Triple("not_started", "Not Started", Color(0xFF6B7280)),
    Triple("learning",    "Learning",    Color(0xFFF59E0B)),
    Triple("reviewing",   "Reviewing",   Color(0xFF3B82F6)),
    Triple("mastered",    "Mastered",    Color(0xFF10B981)),
)

@Composable
fun NotePropertiesDialog(
    note: Note,
    onDismiss: () -> Unit,
    onUpdated: (Note) -> Unit,
    onTopicClick: ((String) -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    var mastery by remember { mutableStateOf(note.masteryStatus) }
    var topics by remember { mutableStateOf(note.topics) }
    var newTopic by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Gray800,
        title = {
            Text("Note Properties", color = Gray50, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {

                // ── Mastery status ────────────────────────────────────────────
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("MASTERY", color = Slate400, fontSize = 10.sp, letterSpacing = 1.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        MASTERY_STATES.forEach { (key, label, color) ->
                            val selected = mastery == key
                            Box(
                                Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(if (selected) color.copy(alpha = 0.2f) else Color.Transparent)
                                    .border(
                                        1.dp,
                                        if (selected) color else Gray700,
                                        RoundedCornerShape(6.dp),
                                    )
                                    .clickable {
                                        mastery = key
                                        scope.launch {
                                            try {
                                                NotesRepository.updateMastery(note.id, key)
                                                onUpdated(note.copy(masteryStatus = key))
                                            } catch (_: Exception) {}
                                        }
                                    }
                                    .padding(horizontal = 8.dp, vertical = 5.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    label,
                                    color = if (selected) color else Slate400,
                                    fontSize = 11.sp,
                                    fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
                                )
                            }
                        }
                    }
                }

                // ── Topics ────────────────────────────────────────────────────
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("TOPICS", color = Slate400, fontSize = 10.sp, letterSpacing = 1.sp)
                    // Existing chips
                    if (topics.isNotEmpty()) {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            items(topics) { topic ->
                                Row(
                                    Modifier
                                        .clip(RoundedCornerShape(20.dp))
                                        .background(Indigo600.copy(alpha = 0.15f))
                                        .border(1.dp, Indigo500.copy(alpha = 0.4f), RoundedCornerShape(20.dp))
                                        .then(if (onTopicClick != null) Modifier.clickable {
                                            onTopicClick(topic)
                                            onDismiss()
                                        } else Modifier)
                                        .padding(start = 10.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(topic, color = Color(0xFFA5B4FC), fontSize = 12.sp)
                                    Spacer(Modifier.width(2.dp))
                                    IconButton(
                                        onClick = {
                                            val updated = topics - topic
                                            topics = updated
                                            scope.launch {
                                                try {
                                                    NotesRepository.updateTopics(note.id, updated)
                                                    onUpdated(note.copy(topics = updated))
                                                } catch (_: Exception) {}
                                            }
                                        },
                                        modifier = Modifier.size(18.dp),
                                    ) {
                                        Icon(Icons.Default.Close, null, Modifier.size(10.dp), tint = Slate400)
                                    }
                                }
                            }
                        }
                    }
                    // Add topic input
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(Gray900)
                            .border(1.dp, Gray700, RoundedCornerShape(8.dp))
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BasicTextField(
                            value = newTopic,
                            onValueChange = { newTopic = it },
                            modifier = Modifier.weight(1f),
                            textStyle = TextStyle(color = Gray50, fontSize = 13.sp),
                            cursorBrush = SolidColor(Indigo500),
                            singleLine = true,
                            decorationBox = { inner ->
                                if (newTopic.isEmpty()) Text("Add topic…", color = Slate400, fontSize = 13.sp)
                                inner()
                            },
                        )
                        if (newTopic.isNotBlank()) {
                            IconButton(
                                onClick = {
                                    val t = newTopic.trim()
                                    if (t.isNotEmpty() && t !in topics) {
                                        val updated = topics + t
                                        topics = updated
                                        newTopic = ""
                                        scope.launch {
                                            try {
                                                NotesRepository.updateTopics(note.id, updated)
                                                onUpdated(note.copy(topics = updated))
                                            } catch (_: Exception) {}
                                        }
                                    } else {
                                        newTopic = ""
                                    }
                                },
                                modifier = Modifier.size(24.dp),
                            ) {
                                Icon(Icons.Default.Add, null, Modifier.size(14.dp), tint = Indigo500)
                            }
                        }
                    }
                }

                // ── Source / metadata ─────────────────────────────────────────
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("INFO", color = Slate400, fontSize = 10.sp, letterSpacing = 1.sp)
                    // Source type badge
                    if (note.sourceType != null) {
                        val (badgeLabel, badgeColor) = when (note.sourceType) {
                            "pdf"    -> "PDF"  to Color(0xFFEF4444)
                            "url"    -> "URL"  to Color(0xFF3B82F6)
                            else     -> "Note" to Color(0xFF6B7280)
                        }
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Type: ", color = Slate400, fontSize = 12.sp)
                            Box(
                                Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(badgeColor.copy(alpha = 0.15f))
                                    .border(1.dp, badgeColor.copy(alpha = 0.4f), RoundedCornerShape(4.dp))
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            ) {
                                Text(badgeLabel, color = badgeColor, fontSize = 11.sp)
                            }
                        }
                    }
                    if (note.sourceFilename != null) {
                        Row {
                            Text("File: ", color = Slate400, fontSize = 12.sp)
                            Text(note.sourceFilename, color = Gray50, fontSize = 12.sp, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        }
                    }
                    if (note.sourceUrl != null) {
                        Row {
                            Text("URL: ", color = Slate400, fontSize = 12.sp)
                            Text(note.sourceUrl, color = Color(0xFF60A5FA), fontSize = 12.sp, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        }
                    }
                    if (note.createdAt.isNotEmpty()) {
                        Row {
                            Text("Created: ", color = Slate400, fontSize = 12.sp)
                            Text(note.createdAt.take(10), color = Gray50, fontSize = 12.sp)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Done", color = Indigo500)
            }
        },
    )
}
