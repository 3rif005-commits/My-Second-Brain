package com.secondbrain.tablet.editor.ui.menus

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.derivedStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.secondbrain.tablet.editor.DocumentViewModel
import com.secondbrain.tablet.ui.theme.Gray200
import com.secondbrain.tablet.ui.theme.Indigo500
import com.secondbrain.tablet.ui.theme.Slate400
import com.secondbrain.tablet.ui.theme.Slate800

private val menuShape = RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)

@Composable
fun MentionMenuPanel(
    vm: DocumentViewModel,
    modifier: Modifier = Modifier,
) {
    val menu = vm.mentionMenu ?: return
    val notes by remember { derivedStateOf { vm.filteredMentionNotes() } }
    val highlightIndex = menu.highlightIndex.coerceIn(0, maxOf(0, notes.lastIndex))

    // Handle Enter key / soft-keyboard confirm
    LaunchedEffect(vm.menuEnterPending) {
        if (vm.menuEnterPending && notes.isNotEmpty()) {
            vm.selectMentionItem(notes[highlightIndex])
            vm.clearMenuEnterPending()
        }
    }

    // Close when no matches and user has typed something
    LaunchedEffect(notes.isEmpty(), menu.query) {
        if (notes.isEmpty() && menu.query.isNotEmpty()) vm.closeMentionMenu()
    }

    val listState = rememberLazyListState()
    LaunchedEffect(highlightIndex) {
        if (notes.isNotEmpty()) listState.animateScrollToItem(highlightIndex)
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .shadow(8.dp, menuShape)
            .clip(menuShape)
            .background(Slate800),
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = if (menu.query.isEmpty()) "Link to note" else "@${menu.query}",
                    fontSize = 11.sp,
                    color = Slate400,
                    fontWeight = FontWeight.Medium,
                )
            }
            HorizontalDivider(color = Slate400.copy(alpha = 0.2f))

            if (notes.isEmpty()) {
                Text(
                    text = "No notes found",
                    fontSize = 13.sp,
                    color = Slate400,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                )
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 220.dp),
                ) {
                    itemsIndexed(notes) { index, note ->
                        val isHighlighted = index == highlightIndex
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(
                                    if (isHighlighted) Indigo500.copy(alpha = 0.25f) else Color.Transparent,
                                )
                                .clickable { vm.selectMentionItem(note) }
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = note.icon,
                                fontSize = 16.sp,
                            )
                            Spacer(Modifier.width(10.dp))
                            Text(
                                text = note.title,
                                fontSize = 14.sp,
                                color = Gray200,
                                fontWeight = if (isHighlighted) FontWeight.SemiBold else FontWeight.Normal,
                                maxLines = 1,
                            )
                        }
                        if (index < notes.lastIndex) {
                            HorizontalDivider(
                                color = Slate400.copy(alpha = 0.1f),
                                modifier = Modifier.padding(horizontal = 16.dp),
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(4.dp))
        }
    }
}
