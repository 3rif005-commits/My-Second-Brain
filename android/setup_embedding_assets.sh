#!/usr/bin/env bash
# Download BERT uncased vocab to Android assets so EmbeddingTokenizer can load it.
# Run from the android/ directory: ./setup_embedding_assets.sh
set -euo pipefail

VOCAB_URL="https://huggingface.co/bert-base-uncased/resolve/main/vocab.txt"
ASSETS_DIR="$(dirname "$0")/app/src/main/assets"
VOCAB_PATH="$ASSETS_DIR/bert_vocab.txt"

echo "=== Second Brain — Embedding Vocab Setup ==="

mkdir -p "$ASSETS_DIR"

if [[ -f "$VOCAB_PATH" ]]; then
    LINES=$(wc -l < "$VOCAB_PATH")
    echo "vocab already present ($LINES tokens). Delete $VOCAB_PATH to re-download."
    exit 0
fi

echo "Downloading BERT uncased vocab (~230 KB)..."
curl -L --progress-bar -o "$VOCAB_PATH" "$VOCAB_URL"

TOKENS=$(wc -l < "$VOCAB_PATH")
echo "Done! $VOCAB_PATH — $TOKENS tokens"
echo "Rebuild the app to include the vocab in the APK assets."
