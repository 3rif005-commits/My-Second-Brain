package com.secondbrain.tablet.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.tensorflow.lite.Interpreter
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

/**
 * On-device sentence embeddings using all-MiniLM-L6-v2 (384-dim).
 *
 * Setup:
 *   1. Download the TFLite model to the device:
 *      adb push all_minilm_embedding.tflite /sdcard/Download/
 *      (or run android/download_embeddings_model.sh)
 *   2. Copy the BERT vocab to assets:
 *      Run: android/setup_embedding_assets.sh
 *
 * If the model file is absent, embed() returns null and the app
 * falls back to FTS-only search — no crash.
 */
object EmbeddingEngine {

    private const val TAG       = "EmbeddingEngine"
    private const val MODEL_FILENAME = "all_minilm_embedding.tflite"
    private const val VOCAB_ASSET    = "bert_vocab.txt"
    private const val MAX_LEN   = 128
    private const val DIM       = 384

    private var interpreter: Interpreter? = null
    private var tokenizer: EmbeddingTokenizer? = null
    val isReady: Boolean get() = interpreter != null && tokenizer != null

    fun init(context: Context) {
        if (isReady) return
        try {
            val modelFile = modelPath(context)
            if (!modelFile.exists()) {
                Log.i(TAG, "Model not found at ${modelFile.absolutePath} — semantic search disabled")
                return
            }
            val vocab = context.assets.open(VOCAB_ASSET).bufferedReader().readLines()
            tokenizer = EmbeddingTokenizer(vocab)
            interpreter = Interpreter(modelFile, Interpreter.Options().apply { setNumThreads(2) })
            Log.i(TAG, "EmbeddingEngine ready — model ${modelFile.length() / 1_000_000}MB, vocab ${vocab.size} tokens")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to init EmbeddingEngine: ${e.message}")
        }
    }

    /**
     * Returns a L2-normalised 384-dim float array, or null if engine not ready.
     * Safe to call from any thread; switches to IO internally.
     */
    suspend fun embed(text: String): FloatArray? = withContext(Dispatchers.Default) {
        val interp = interpreter ?: return@withContext null
        val tok    = tokenizer  ?: return@withContext null
        try {
            val (inputIds, attentionMask, tokenTypeIds) = tok.tokenize(text.take(512), MAX_LEN)

            // Build int[1][MAX_LEN] input buffers
            val inputIdsBuf       = toIntBuffer(inputIds)
            val attentionMaskBuf  = toIntBuffer(attentionMask)
            val tokenTypeIdsBuf   = toIntBuffer(tokenTypeIds)

            // Output: [1, MAX_LEN, DIM] last hidden state
            val outputBuf = Array(1) { Array(MAX_LEN) { FloatArray(DIM) } }

            interp.runForMultipleInputsOutputs(
                arrayOf(inputIdsBuf, attentionMaskBuf, tokenTypeIdsBuf),
                mapOf(0 to outputBuf),
            )

            // Mean pool over non-padding tokens, then L2-normalise
            meanPool(outputBuf[0], attentionMask)
        } catch (e: Exception) {
            Log.e(TAG, "embed() failed: ${e.message}")
            null
        }
    }

    private fun toIntBuffer(ids: IntArray): Array<IntArray> = arrayOf(ids)

    private fun meanPool(hidden: Array<FloatArray>, mask: IntArray): FloatArray {
        val result = FloatArray(DIM)
        var count = 0
        for (pos in mask.indices) {
            if (mask[pos] == 0) break
            for (d in 0 until DIM) result[d] += hidden[pos][d]
            count++
        }
        if (count > 0) for (d in 0 until DIM) result[d] /= count
        // L2 normalise
        val norm = sqrt(result.fold(0f) { acc, v -> acc + v * v })
        if (norm > 0f) for (d in 0 until DIM) result[d] /= norm
        return result
    }

    fun modelPath(context: Context): File =
        File(context.getExternalFilesDir(null)?.parentFile?.parentFile,
            "Download/$MODEL_FILENAME").let { external ->
            // Prefer /sdcard/Download, fall back to app-private dir
            if (external.parentFile?.exists() == true) external
            else File(context.filesDir, MODEL_FILENAME)
        }
}
