#include <jni.h>
#include <android/log.h>
#include <string>
#include <vector>
#include <cstring>

#include "llama.h"

#define TAG "LlamaJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// ── Global state (one model loaded at a time) ──────────────────────────────
static llama_model   * g_model   = nullptr;
static llama_context * g_ctx     = nullptr;
static llama_sampler * g_sampler = nullptr;
static std::string     g_backend_name;

// ── Helpers ────────────────────────────────────────────────────────────────

static std::string jstring_to_str(JNIEnv* env, jstring js) {
    if (!js) return "";
    const char* cs = env->GetStringUTFChars(js, nullptr);
    std::string s(cs);
    env->ReleaseStringUTFChars(js, cs);
    return s;
}

static jstring str_to_jstring(JNIEnv* env, const std::string& s) {
    return env->NewStringUTF(s.c_str());
}

// ── JNI exports ───────────────────────────────────────────────────────────
extern "C" {

// ----------------------------------------------------------------------------
// llamaLoad(modelPath: String, nCtx: Int): Boolean
// ----------------------------------------------------------------------------
JNIEXPORT jboolean JNICALL
Java_com_secondbrain_tablet_llama_LlamaJNI_llamaLoad(
        JNIEnv* env, jobject /*thiz*/,
        jstring j_model_path, jint n_ctx)
{
    // Free any previously loaded model
    if (g_sampler) { llama_sampler_free(g_sampler); g_sampler = nullptr; }
    if (g_ctx)     { llama_free(g_ctx);              g_ctx     = nullptr; }
    if (g_model)   { llama_model_free(g_model);      g_model   = nullptr; }

    llama_backend_init();

    // Route all llama.cpp logs through Android logcat
    llama_log_set([](ggml_log_level lvl, const char* text, void*) {
        int prio = (lvl == GGML_LOG_LEVEL_ERROR) ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO;
        __android_log_print(prio, "LlamaJNI", "%s", text);
    }, nullptr);

    std::string model_path = jstring_to_str(env, j_model_path);
    LOGI("Loading model: %s  n_ctx=%d", model_path.c_str(), (int)n_ctx);

    llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = 0; // CPU only — GPU paths (Vulkan/OpenCL) destabilized this Adreno 710 device

    g_model = llama_model_load_from_file(model_path.c_str(), mparams);
    if (!g_model) {
        LOGE("Failed to load model from %s", model_path.c_str());
        return JNI_FALSE;
    }

    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx        = (uint32_t)n_ctx;
    cparams.n_batch      = (uint32_t)n_ctx; // must be >= any prompt we send; n_ubatch controls actual compute chunk size
    cparams.n_ubatch     = 256;             // compute chunk size — controls memory (259MB at 256)

    g_ctx = llama_new_context_with_model(g_model, cparams);
    if (!g_ctx) {
        LOGE("Failed to create context");
        llama_model_free(g_model);
        g_model = nullptr;
        return JNI_FALSE;
    }

    // Sampler chain: top_k → top_p → temp → dist
    g_sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
    llama_sampler_chain_add(g_sampler, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(g_sampler, llama_sampler_init_top_p(0.95f, 1));
    llama_sampler_chain_add(g_sampler, llama_sampler_init_temp(0.8f));
    llama_sampler_chain_add(g_sampler, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    // Detect backend
    int n_devices = ggml_backend_dev_count();
    LOGI("Available backends: %d", n_devices);
    g_backend_name = "CPU (llama.cpp)";
    for (int i = 0; i < n_devices; i++) {
        ggml_backend_dev_t dev = ggml_backend_dev_get(i);
        enum ggml_backend_dev_type type = ggml_backend_dev_type(dev);
        size_t free_mem = 0, total_mem = 0;
        ggml_backend_dev_memory(dev, &free_mem, &total_mem);
        LOGI("  [%d] %s type=%d free=%zuMB total=%zuMB", i,
             ggml_backend_dev_name(dev), (int)type,
             free_mem / 1024 / 1024, total_mem / 1024 / 1024);
    }

    LOGI("Model loaded. Backend: %s", g_backend_name.c_str());
    return JNI_TRUE;
}

// ----------------------------------------------------------------------------
// llamaGenerate(prompt: String, maxTokens: Int): String
// ----------------------------------------------------------------------------
JNIEXPORT jstring JNICALL
Java_com_secondbrain_tablet_llama_LlamaJNI_llamaGenerate(
        JNIEnv* env, jobject /*thiz*/,
        jstring j_prompt, jint max_tokens)
{
    if (!g_model || !g_ctx || !g_sampler) {
        return str_to_jstring(env, "[Error: model not loaded]");
    }

    std::string prompt = jstring_to_str(env, j_prompt);
    const struct llama_vocab* vocab = llama_model_get_vocab(g_model);

    // Tokenize
    const int n_prompt_tokens = -llama_tokenize(
            vocab, prompt.c_str(), (int32_t)prompt.size(),
            nullptr, 0, /*add_special=*/true, /*parse_special=*/true);

    std::vector<llama_token> tokens(n_prompt_tokens);
    if (llama_tokenize(vocab, prompt.c_str(), (int32_t)prompt.size(),
                       tokens.data(), (int32_t)tokens.size(),
                       /*add_special=*/true, /*parse_special=*/true) < 0) {
        return str_to_jstring(env, "[Error: tokenization failed]");
    }

    LOGI("Prompt tokens: %d  max_new=%d", n_prompt_tokens, (int)max_tokens);

    // Prefill
    LOGI("Step: batch_get_one tokens=%d", n_prompt_tokens);
    llama_batch batch = llama_batch_get_one(tokens.data(), (int32_t)tokens.size());
    LOGI("Step: llama_decode prefill");
    if (llama_decode(g_ctx, batch) != 0) {
        return str_to_jstring(env, "[Error: prefill decode failed]");
    }
    LOGI("Step: prefill done");

    // Generate
    std::string result;
    result.reserve(512);

    llama_token eos = llama_vocab_eos(vocab);
    int n_generated  = 0;

    while (n_generated < (int)max_tokens) {
        LOGI("Step: sample token %d", n_generated);
        llama_token token = llama_sampler_sample(g_sampler, g_ctx, -1);
        if (token == eos || llama_vocab_is_eog(vocab, token)) break;

        char piece[256];
        // special=false: suppress special tokens from output text
        int n = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, false);
        if (n > 0) result.append(piece, n);

        LOGI("Step: decode token %d", n_generated);
        llama_batch next = llama_batch_get_one(&token, 1);
        if (llama_decode(g_ctx, next) != 0) break;
        n_generated++;
    }

    LOGI("Generated %d tokens", n_generated);

    // Clear KV cache and sampler state for next call
    LOGI("Step: clear memory");
    llama_memory_clear(llama_get_memory(g_ctx), false);
    LOGI("Step: reset sampler");
    llama_sampler_reset(g_sampler);

    return str_to_jstring(env, result);
}

// ----------------------------------------------------------------------------
// llamaGetBackend(): String
// ----------------------------------------------------------------------------
JNIEXPORT jstring JNICALL
Java_com_secondbrain_tablet_llama_LlamaJNI_llamaGetBackend(
        JNIEnv* env, jobject /*thiz*/)
{
    return str_to_jstring(env, g_backend_name.empty() ? "Unknown" : g_backend_name);
}

// ----------------------------------------------------------------------------
// llamaFree()
// ----------------------------------------------------------------------------
JNIEXPORT void JNICALL
Java_com_secondbrain_tablet_llama_LlamaJNI_llamaFree(
        JNIEnv* /*env*/, jobject /*thiz*/)
{
    if (g_sampler) { llama_sampler_free(g_sampler); g_sampler = nullptr; }
    if (g_ctx)     { llama_free(g_ctx);              g_ctx     = nullptr; }
    if (g_model)   { llama_model_free(g_model);      g_model   = nullptr; }
    llama_backend_free();
    LOGI("Model freed");
}

} // extern "C"
