package com.secondbrain.tablet.llama

object LlamaJNI {
    init {
        System.loadLibrary("llama_jni")
    }

    /** Load a GGUF model. Returns true on success. GPU (Vulkan) is used automatically
     *  when the lib was built with GGML_VULKAN=ON and a Vulkan device is present. */
    external fun llamaLoad(modelPath: String, nCtx: Int): Boolean

    /** Generate a response for the given pre-formatted prompt string.
     *  Blocks until [maxTokens] tokens are generated or EOS is reached. */
    external fun llamaGenerate(prompt: String, maxTokens: Int): String

    /** Returns the active backend name, e.g. "GPU (Vulkan) — Adreno 710" or "CPU". */
    external fun llamaGetBackend(): String

    /** Release all native resources. Safe to call even if llamaLoad was never called. */
    external fun llamaFree()
}
