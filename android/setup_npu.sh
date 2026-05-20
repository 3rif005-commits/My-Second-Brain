#!/usr/bin/env bash
# NPU (Qualcomm Hexagon) setup for LiteRT LLM on Redmi Pad Pro
#
# The Redmi Pad Pro uses a Qualcomm SoC (Snapdragon 7s Gen 2 / SM7475-AB).
# To use the NPU/Hexagon DSP, you need:
#   1. Qualcomm QNN delegate .so libraries in the APK
#   2. A QNN-compiled .litertlm model (different from the HuggingFace CPU model)
#
# STEP 1 — Identify your exact SoC
# Run this on your tablet while ADB is connected:
#   adb shell getprop ro.board.platform
#   adb shell getprop ro.hardware
# Common values:
#   kalama  = Snapdragon 8 Gen 3
#   lanai   = Snapdragon 7s Gen 2 (SM7475)
#   crow    = Snapdragon 7 Gen 3
#
# STEP 2 — Get QNN delegate libraries from Qualcomm AI Hub
# Visit: https://aihub.qualcomm.com
# Sign up (free), then export a Gemma model for your device.
# Download the "QNN .so libraries" package.
# The libs you need (arm64-v8a):
#   - libQnnHtp.so           (HTP runtime)
#   - libQnnHtpV75Stub.so    (for SM7475 Hexagon v75)
#   - libQnnHtpV73Stub.so    (for Snapdragon 8 Gen 2 Hexagon v73)
#   - libQnnSystem.so        (QNN system)
#   - libQnnHtpPrepare.so
#
# STEP 3 — Place libs in the APK
# Copy the .so files to:
#   android/app/src/main/jniLibs/arm64-v8a/
# Then rebuild the APK. Gradle will automatically bundle them.
#
# STEP 4 — Get the QNN-compiled model
# From Qualcomm AI Hub, export Gemma 2B (or 4 E2B) for your device.
# Download the .litertlm file (QNN variant, not the HuggingFace one).
# Push it to the tablet and use that path in the app.
#
# STEP 5 — Verify NPU is used
#   adb logcat -s LlmService:I
# Look for: "Backend NPU SUCCEEDED"

set -euo pipefail

echo "Checking your tablet SoC..."
if ! adb devices | grep -q "device$"; then
  echo "Error: no ADB device connected"
  exit 1
fi

PLATFORM=$(adb shell getprop ro.board.platform 2>/dev/null | tr -d '\r')
HARDWARE=$(adb shell getprop ro.hardware 2>/dev/null | tr -d '\r')
SOC_MODEL=$(adb shell getprop ro.soc.model 2>/dev/null | tr -d '\r')

echo "Platform:  $PLATFORM"
echo "Hardware:  $HARDWARE"
echo "SoC Model: $SOC_MODEL"

case "$PLATFORM" in
  kalama) echo "→ Snapdragon 8 Gen 3 — Hexagon v75 — need libQnnHtpV75Stub.so" ;;
  lanai)  echo "→ Snapdragon 7s Gen 2 — Hexagon v73 — need libQnnHtpV73Stub.so" ;;
  crow)   echo "→ Snapdragon 7 Gen 3 — Hexagon v75 — need libQnnHtpV75Stub.so" ;;
  pineapple) echo "→ Snapdragon 8 Gen 4 — Hexagon v79 — need libQnnHtpV79Stub.so" ;;
  *)      echo "→ Unknown platform '$PLATFORM' — check Qualcomm AI Hub for the right Hexagon version" ;;
esac

JNILIB_DIR="$(dirname "$0")/app/src/main/jniLibs/arm64-v8a"
echo ""
echo "Place your QNN .so files in:"
echo "  $JNILIB_DIR"
echo ""
echo "Current contents:"
ls -la "$JNILIB_DIR" 2>/dev/null || echo "  (empty — no QNN libs yet)"
