#!/usr/bin/env bash
# Download Gemma 4 E2B model variants to the tablet.
#
# Prerequisites:
#   - adb connected to the tablet (USB or WiFi)
#   - Hugging Face token with Gemma access
#
# Usage:
#   export HF_TOKEN=hf_xxxx
#   bash download_model.sh            # CPU int4 (default)
#   bash download_model.sh gpu        # GPU float16 (needs Adreno OpenCL)
#   bash download_model.sh npu        # NPU/QNN (needs Qualcomm QNN libs in APK)

set -euo pipefail

VARIANT="${1:-cpu}"
HF_BASE="https://huggingface.co"

case "$VARIANT" in
  cpu)
    # int4 quantized — works on CPU, NOT compatible with GPU delegate
    MODEL_URL="$HF_BASE/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm"
    LOCAL_FILE="/tmp/gemma-4-e2b-cpu.litertlm"
    DEST_PATH="/sdcard/Download/gemma-4-E2B-it-cpu.litertlm"
    ;;
  gpu)
    # float16 quantized — compatible with Adreno GPU OpenCL delegate
    # Check https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm for available files
    MODEL_URL="$HF_BASE/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-gpu.litertlm"
    LOCAL_FILE="/tmp/gemma-4-e2b-gpu.litertlm"
    DEST_PATH="/sdcard/Download/gemma-4-E2B-it-gpu.litertlm"
    echo "NOTE: GPU model requires float16 quantization. If this URL 404s, check the HuggingFace repo"
    echo "      for the correct filename: https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/tree/main"
    ;;
  npu)
    # QNN-compiled — requires Qualcomm HTP delegate libs bundled in the APK
    # Get from Qualcomm AI Hub: https://aihub.qualcomm.com/models/gemma2_2b_quantized
    echo "NPU models must be downloaded from Qualcomm AI Hub (not HuggingFace)."
    echo "  1. Visit: https://aihub.qualcomm.com/compute/models"
    echo "  2. Search for Gemma and export for your chip (SM7475 = 7s Gen 2, or SM8635 = 8s Gen 3)"
    echo "  3. Download the .litertlm QNN model and the libQnnHtp.so delegate"
    echo "  4. Place libQnn*.so files in android/app/src/main/jniLibs/arm64-v8a/"
    exit 0
    ;;
  gguf)
    # Gemma 4 E2B in GGUF Q4_K_M format — for llama.cpp + Vulkan GPU inference
    MODEL_URL="$HF_BASE/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf"
    LOCAL_FILE="/tmp/gemma-4-e2b-it-Q4_K_M.gguf"
    DEST_PATH="/sdcard/Download/gemma-4-e2b-it-Q4_K_M.gguf"
    ;;
  *)
    echo "Usage: $0 [cpu|gpu|npu|gguf]"
    exit 1
    ;;
esac

if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "Error: set HF_TOKEN to your Hugging Face access token"
  exit 1
fi

if ! adb devices | grep -q "device$"; then
  echo "Error: no ADB device connected (run 'adb devices' to check)"
  exit 1
fi

echo "Downloading $VARIANT model (~2 GB)…"
curl -L --header "Authorization: Bearer $HF_TOKEN" \
     --progress-bar \
     "$MODEL_URL" -o "$LOCAL_FILE"

echo "Pushing to tablet at $DEST_PATH…"
adb push "$LOCAL_FILE" "$DEST_PATH"

echo "Done. Model is at $DEST_PATH on the tablet."
echo "Enter that path in the app and tap 'Start Server'."
