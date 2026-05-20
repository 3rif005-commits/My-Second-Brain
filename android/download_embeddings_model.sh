#!/usr/bin/env bash
# Download all-MiniLM-L6-v2 TFLite model to connected Android device.
# Run from the android/ directory: ./download_embeddings_model.sh
set -euo pipefail

MODEL_NAME="all_minilm_embedding.tflite"
DEVICE_PATH="/sdcard/Download/$MODEL_NAME"
LOCAL_CACHE="/tmp/$MODEL_NAME"

# Converted TFLite model hosted on HuggingFace (sentence-transformers)
MODEL_URL="https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/${MODEL_NAME}"

echo "=== Second Brain — Embedding Model Setup ==="

# Check adb
if ! command -v adb &>/dev/null; then
    echo "Error: adb not found. Install Android SDK platform-tools first."
    exit 1
fi

# Check device connected
if ! adb get-serialno &>/dev/null; then
    echo "Error: no Android device connected (or adb not authorised)."
    exit 1
fi

# Download if not cached
if [[ ! -f "$LOCAL_CACHE" ]]; then
    echo "Downloading $MODEL_NAME (~22 MB)..."
    curl -L --progress-bar -o "$LOCAL_CACHE" "$MODEL_URL"
else
    echo "Using cached model at $LOCAL_CACHE"
fi

echo "Pushing to device at $DEVICE_PATH..."
adb push "$LOCAL_CACHE" "$DEVICE_PATH"

SIZE=$(adb shell "ls -lh $DEVICE_PATH 2>/dev/null | awk '{print \$5}'" 2>/dev/null || echo "?")
echo "Done! Model is on device ($SIZE). Semantic search will activate on next app launch."
