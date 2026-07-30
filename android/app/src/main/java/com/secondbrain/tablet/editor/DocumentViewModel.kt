package com.secondbrain.tablet.editor

import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import com.secondbrain.tablet.data.Note
import com.secondbrain.tablet.editor.model.*
import com.secondbrain.tablet.editor.rich.InlineRichTextEngine
import com.secondbrain.tablet.editor.serialization.BlockNoteSerializer
import com.secondbrain.tablet.editor.serialization.BlockStateBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

class DocumentViewModel(
    val noteId: String,
    private val saveCallback: suspend (content: JsonArray, plainText: String) -> Unit,
    private val externalScope: CoroutineScope,
) {
    private val vmJob = SupervisorJob(externalScope.coroutineContext[Job])
    private val vmScope = CoroutineScope(externalScope.coroutineContext + vmJob)

    val blocks = mutableStateListOf<BlockState>()
    var isLoaded by mutableStateOf(false)
        private set
    var focusedBlockId: String? by mutableStateOf(null)
        private set
    var selectedBlockId: String? by mutableStateOf(null)
        private set

    val pendingFocus = mutableStateMapOf<String, CursorTarget>()

    // ── Slash menu ────────────────────────────────────────────────────────────
    var slashMenu: SlashMenuState? by mutableStateOf(null)
    var menuEnterPending by mutableStateOf(false)
        private set

    private var slashOffset: Int = -1
    private var slashQueryJob: Job? = null

    var mentionMenu: MentionMenuState? by mutableStateOf(null)
    var allNotes: List<Note> by mutableStateOf(emptyList())

    private var atOffset: Int = -1
    private var atQueryJob: Job? = null

    private val _saveTrigger = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    private val _hasPending = AtomicBoolean(false)

    // ── Init ─────────────────────────────────────────────────────────────────

    fun loadFromJson(json: JsonArray, plainFallback: String?) {
        val models = BlockNoteSerializer.deserialize(json)
        val states = when {
            models.isNotEmpty() -> models.map { BlockStateBridge.fromModel(it) }
            !plainFallback.isNullOrBlank() -> plainFallback.split("\n")
                .filter { it.isNotBlank() }
                .map { BlockState(id = uuid(), type = BlockType.Paragraph, initialText = it) }
            else -> listOf(BlockState(id = uuid(), type = BlockType.Paragraph))
        }
        blocks.clear()
        blocks.addAll(states)
        states.forEach { wireObserver(it) }
        startSaveLoop()
        isLoaded = true
    }

    private fun startSaveLoop() {
        vmScope.launch {
            _saveTrigger.debounce(800L).collect {
                try {
                    val models = blocks.map { BlockStateBridge.toModel(it) }
                    val json = BlockNoteSerializer.serialize(models)
                    val plain = BlockStateBridge.plainText(blocks.toList())
                    saveCallback(json, plain)
                    _hasPending.set(false)
                } catch (_: Exception) { }
            }
        }
    }

    private fun wireObserver(block: BlockState) {
        vmScope.launch {
            snapshotFlow { block.textState.text.toString() }.drop(1).collect { markDirty() }
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun cancel() {
        vmJob.cancel()
    }

    // ── Save ──────────────────────────────────────────────────────────────────

    fun markDirty() {
        _hasPending.set(true)
        _saveTrigger.tryEmit(Unit)
    }

    suspend fun flushPendingSave() {
        if (!_hasPending.get()) return
        try {
            val models = blocks.map { BlockStateBridge.toModel(it) }
            val json = BlockNoteSerializer.serialize(models)
            val plain = BlockStateBridge.plainText(blocks.toList())
            saveCallback(json, plain)
            _hasPending.set(false)
        } catch (_: Exception) { }
    }

    // ── Focus ─────────────────────────────────────────────────────────────────

    fun onBlockFocused(blockId: String) {
        focusedBlockId = blockId
        // Tapping a block clears block-level selection
        if (selectedBlockId != blockId) selectedBlockId = null
    }

    fun requestFocus(blockId: String, cursor: CursorTarget = CursorTarget.End) {
        pendingFocus[blockId] = cursor
    }

    fun updateNotes(notes: List<Note>) {
        allNotes = notes
    }

    // ── Block selection ───────────────────────────────────────────────────────

    fun selectBlock(blockId: String) {
        selectedBlockId = if (selectedBlockId == blockId) null else blockId
    }

    fun clearSelection() {
        selectedBlockId = null
    }

    // ── Slash menu ────────────────────────────────────────────────────────────

    fun onSlashTyped(blockId: String, offset: Int) {
        slashQueryJob?.cancel()
        slashOffset = offset
        slashMenu = SlashMenuState(blockId, query = "")

        val block = blocks.firstOrNull { it.id == blockId } ?: return
        slashQueryJob = vmScope.launch {
            snapshotFlow { block.textState.text.toString() }.drop(1).collect { text ->
                val menu = slashMenu ?: run { cancel(); return@collect }
                if (slashOffset >= text.length || text.getOrNull(slashOffset) != '/') {
                    closeSlashMenu()
                    cancel()
                    return@collect
                }
                val query = text.substring(slashOffset + 1)
                if (' ' in query || '\n' in query) { closeSlashMenu(); cancel(); return@collect }
                slashMenu = menu.copy(query = query)
            }
        }
    }

    fun selectSlashItem(type: BlockType) {
        val menu = slashMenu ?: return
        val block = blocks.firstOrNull { it.id == menu.blockId } ?: return
        val text = block.textState.text.toString()
        val endIdx = minOf(slashOffset + 1 + menu.query.length, text.length)
        val newText = text.substring(0, slashOffset.coerceAtLeast(0)) + text.substring(endIdx)
        block.textState.setTextAndPlaceCursorAtEnd(newText)
        changeType(menu.blockId, type)
        closeSlashMenu()
        markDirty()
        pendingFocus[menu.blockId] = CursorTarget.End
    }

    fun navigateSlashMenu(delta: Int) {
        val menu = slashMenu ?: return
        val newIdx = (menu.highlightIndex + delta).coerceAtLeast(0)
        slashMenu = menu.copy(highlightIndex = newIdx)
    }

    fun signalMenuEnter() {
        menuEnterPending = true
    }

    fun clearMenuEnterPending() {
        menuEnterPending = false
    }

    fun closeSlashMenu() {
        slashQueryJob?.cancel()
        slashMenu = null
        slashOffset = -1
        menuEnterPending = false
    }

    // ── Mention menu ──────────────────────────────────────────────────────────

    fun onAtTyped(blockId: String, offset: Int) {
        atQueryJob?.cancel()
        atOffset = offset
        mentionMenu = MentionMenuState(blockId, query = "")

        val block = blocks.firstOrNull { it.id == blockId } ?: return
        atQueryJob = vmScope.launch {
            snapshotFlow { block.textState.text.toString() }.drop(1).collect { text ->
                val menu = mentionMenu ?: run { cancel(); return@collect }
                if (atOffset >= text.length || text.getOrNull(atOffset) != '@') {
                    closeMentionMenu(); cancel(); return@collect
                }
                val query = text.substring(atOffset + 1)
                if (' ' in query || '\n' in query) { closeMentionMenu(); cancel(); return@collect }
                mentionMenu = menu.copy(query = query)
            }
        }
    }

    fun filteredMentionNotes(): List<Note> {
        val query = mentionMenu?.query ?: return emptyList()
        return if (query.isEmpty()) allNotes.take(10)
        else allNotes.filter { it.title.contains(query, ignoreCase = true) }.take(10)
    }

    fun selectMentionItem(note: Note) {
        val menu = mentionMenu ?: return
        val block = blocks.firstOrNull { it.id == menu.blockId } ?: return
        val text = block.textState.text.toString()
        val insertAt = atOffset.coerceAtLeast(0)
        val endIdx = minOf(atOffset + 1 + menu.query.length, text.length)
        val replacement = "@${note.title}"
        val newText = text.substring(0, insertAt) + replacement + text.substring(endIdx)

        // setTextAndPlaceCursorAtEnd fires RichInputTransformation which clears mentions/styles.
        // We add the new MentionAnchor after the edit commits.
        block.textState.setTextAndPlaceCursorAtEnd(newText)
        block.mentions.add(
            MentionAnchor(
                start    = insertAt,
                end      = insertAt + replacement.length,
                noteId   = note.id,
                noteName = note.title,
            )
        )

        closeMentionMenu()
        markDirty()
        pendingFocus[menu.blockId] = CursorTarget.End
    }

    fun navigateMentionMenu(delta: Int) {
        val menu = mentionMenu ?: return
        val newIdx = (menu.highlightIndex + delta).coerceAtLeast(0)
        mentionMenu = menu.copy(highlightIndex = newIdx)
    }

    fun closeMentionMenu() {
        atQueryJob?.cancel()
        mentionMenu = null
        atOffset = -1
        menuEnterPending = false
    }

    // ── Block mutations ───────────────────────────────────────────────────────

    fun splitBlock(blockId: String, atOffset: Int, rightText: String) {
        val idx = blocks.indexOfFirst { it.id == blockId }
        if (idx < 0) return
        val src = blocks[idx]
        val newType = when (src.type) {
            BlockType.H1, BlockType.H2, BlockType.H3,
            BlockType.ToggleH1, BlockType.ToggleH2, BlockType.ToggleH3,
            BlockType.CodeBlock, BlockType.Quote -> BlockType.Paragraph
            else -> if (rightText.isEmpty() && src.textState.text.isEmpty()) BlockType.Paragraph else src.type
        }
        val newBlock = BlockState(id = uuid(), type = newType, initialText = rightText)
        blocks.add(idx + 1, newBlock)
        wireObserver(newBlock)
        markDirty()
        pendingFocus[newBlock.id] = CursorTarget.Start
    }

    fun mergeWithPrevious(blockId: String) {
        val idx = blocks.indexOfFirst { it.id == blockId }
        if (idx <= 0) return
        val prev = blocks[idx - 1]
        val curr = blocks[idx]
        val merged = prev.textState.text.toString() + curr.textState.text.toString()
        prev.textState.setTextAndPlaceCursorAtEnd(merged)
        blocks.removeAt(idx)
        markDirty()
        pendingFocus[prev.id] = CursorTarget.End
    }

    fun deleteBlock(blockId: String) {
        val idx = blocks.indexOfFirst { it.id == blockId }
        if (idx < 0) return
        blocks.removeAt(idx)
        val focusId = when {
            idx > 0 -> blocks[idx - 1].id
            blocks.isNotEmpty() -> blocks[0].id
            else -> null
        }
        markDirty()
        focusId?.let { pendingFocus[it] = CursorTarget.End }
    }

    fun findBlock(id: String): BlockState? =
        blocks.firstOrNull { it.id == id }
            ?: blocks.mapNotNull { it.bodyBlock }.firstOrNull { it.id == id }

    fun insertNewBlock(afterId: String? = null, type: BlockType = BlockType.Paragraph, initialText: String = ""): String {
        val newBlock = BlockState(id = uuid(), type = type, initialText = initialText)
        val idx = afterId?.let { id -> blocks.indexOfFirst { it.id == id }.takeIf { it >= 0 }?.plus(1) }
            ?: blocks.size
        blocks.add(idx, newBlock)
        wireObserver(newBlock)
        markDirty()
        return newBlock.id
    }

    fun changeType(blockId: String, newType: BlockType) {
        blocks.firstOrNull { it.id == blockId }?.type = newType
        markDirty()
    }

    fun setBackgroundColor(blockId: String, color: BlockColor) {
        blocks.firstOrNull { it.id == blockId }?.color = color
        markDirty()
    }

    fun toggleChecked(blockId: String) {
        val block = blocks.firstOrNull { it.id == blockId } ?: return
        block.checked = !block.checked
        markDirty()
    }

    fun setBlockHtml(blockId: String, html: String) {
        blocks.firstOrNull { it.id == blockId }?.htmlContent = html
        markDirty()
    }

    fun setCalloutEmoji(blockId: String, emoji: String) {
        blocks.firstOrNull { it.id == blockId }?.calloutEmoji = emoji
        markDirty()
    }

    fun setCalloutColor(blockId: String, color: CalloutColor) {
        blocks.firstOrNull { it.id == blockId }?.calloutColor = color
        markDirty()
    }

    fun setToggleOpen(blockId: String, open: Boolean) {
        blocks.firstOrNull { it.id == blockId }?.isToggleOpen = open
        markDirty()
    }

    fun duplicateBlock(blockId: String) {
        val idx = blocks.indexOfFirst { it.id == blockId }
        if (idx < 0) return
        val src = blocks[idx]
        val copy = BlockState(
            id = uuid(), type = src.type, color = src.color,
            checked = src.checked, calloutEmoji = src.calloutEmoji, calloutColor = src.calloutColor,
            indentLevel = src.indentLevel,
            initialText = src.textState.text.toString(),
            rawChildren = src.rawChildren,
        )
        blocks.add(idx + 1, copy)
        wireObserver(copy)
        markDirty()
    }

    fun moveBlock(fromIndex: Int, toIndex: Int) {
        if (fromIndex == toIndex) return
        if (fromIndex < 0 || fromIndex >= blocks.size) return
        val block = blocks.removeAt(fromIndex)
        blocks.add(toIndex.coerceIn(0, blocks.size), block)
        markDirty()
    }

    // ── Inline style ops ─────────────────────────────────────────────────────

    fun toggleBold() {
        findBlock(focusedBlockId ?: return)?.let { InlineRichTextEngine.toggleBold(it, ::markDirty) }
    }

    fun toggleItalic() {
        findBlock(focusedBlockId ?: return)?.let { InlineRichTextEngine.toggleItalic(it, ::markDirty) }
    }

    fun toggleUnderline() {
        findBlock(focusedBlockId ?: return)?.let { InlineRichTextEngine.toggleUnderline(it, ::markDirty) }
    }

    fun toggleStrike() {
        findBlock(focusedBlockId ?: return)?.let { InlineRichTextEngine.toggleStrike(it, ::markDirty) }
    }

    fun insertMentionAtCursor(noteId: String, noteName: String) {
        val fakeNote = com.secondbrain.tablet.data.Note(id = noteId, title = noteName)
        selectMentionItem(fakeNote)
    }

    private fun uuid() = UUID.randomUUID().toString()
}
