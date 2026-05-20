package com.secondbrain.tablet.data

/**
 * Minimal BERT WordPiece tokenizer for inference only.
 * Handles English text for all-MiniLM-L6-v2 (bert-base-uncased vocab).
 */
class EmbeddingTokenizer(vocabLines: List<String>) {

    private val vocab: Map<String, Int> = vocabLines
        .mapIndexed { idx, token -> token.trim() to idx }
        .toMap()

    private val unkId   = vocab["[UNK]"] ?: 100
    private val clsId   = vocab["[CLS]"] ?: 101
    private val sepId   = vocab["[SEP]"] ?: 102
    private val padId   = vocab["[PAD]"] ?: 0

    /**
     * Tokenize [text] and return (inputIds, attentionMask, tokenTypeIds)
     * each of length [maxLen]. Truncates if longer.
     */
    fun tokenize(text: String, maxLen: Int = 128): Triple<IntArray, IntArray, IntArray> {
        val wordPieceIds = mutableListOf(clsId)

        // Basic whitespace + punctuation split, then WordPiece
        val words = splitIntoWords(text.lowercase().take(4096))
        for (word in words) {
            if (wordPieceIds.size >= maxLen - 1) break
            wordPieceIds += wordPieceIds(word)
        }
        // Always cap and add [SEP]
        val keepCount = minOf(wordPieceIds.size, maxLen - 1)
        val ids = wordPieceIds.take(keepCount).toMutableList()
        ids.add(sepId)

        val inputIds     = IntArray(maxLen) { padId }
        val attentionMask = IntArray(maxLen) { 0 }
        ids.forEachIndexed { i, id ->
            inputIds[i] = id
            attentionMask[i] = 1
        }
        val tokenTypeIds = IntArray(maxLen) { 0 }

        return Triple(inputIds, attentionMask, tokenTypeIds)
    }

    private fun wordPieceIds(word: String): List<Int> {
        if (word.length > 100) return listOf(unkId)
        val result = mutableListOf<Int>()
        var start = 0
        while (start < word.length) {
            var end = word.length
            var found = false
            while (start < end) {
                val sub = if (start == 0) word.substring(start, end)
                          else "##${word.substring(start, end)}"
                val id = vocab[sub]
                if (id != null) {
                    result.add(id)
                    start = end
                    found = true
                    break
                }
                end--
            }
            if (!found) return listOf(unkId)
        }
        return result
    }

    private fun splitIntoWords(text: String): List<String> {
        val words = mutableListOf<String>()
        val current = StringBuilder()
        for (ch in text) {
            when {
                ch.isWhitespace() -> {
                    if (current.isNotEmpty()) { words.add(current.toString()); current.clear() }
                }
                isPunctuation(ch) -> {
                    if (current.isNotEmpty()) { words.add(current.toString()); current.clear() }
                    words.add(ch.toString())
                }
                else -> current.append(ch)
            }
        }
        if (current.isNotEmpty()) words.add(current.toString())
        return words
    }

    private fun isPunctuation(ch: Char): Boolean =
        ch in "!\"#\$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
}
