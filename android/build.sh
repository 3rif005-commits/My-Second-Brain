#!/usr/bin/env bash
# Build and install the Second Brain tablet APK via ADB.
#
# Prerequisites:
#   - ANDROID_HOME set to your Android SDK path
#     e.g. export ANDROID_HOME=$HOME/Android/Sdk
#   - Tablet connected via USB with ADB debugging enabled, OR
#     connected via WiFi: adb connect <tablet-ip>:5555
#
# Usage:
#   bash build.sh           # build debug APK + install
#   bash build.sh release   # build release APK + install (no signing needed for sideload)

set -euo pipefail

cd "$(dirname "$0")"

MODE="${1:-debug}"

if [[ ! -f "gradlew" ]]; then
  echo "Downloading Gradle wrapper…"
  gradle wrapper --gradle-version 8.7 2>/dev/null || {
    echo "Error: 'gradle' not found. Install Gradle or add Android Studio's gradle to PATH."
    exit 1
  }
fi

echo "Building $MODE APK…"
if [[ "$MODE" == "release" ]]; then
  ./gradlew assembleRelease
  APK="app/build/outputs/apk/release/app-release-unsigned.apk"
else
  ./gradlew assembleDebug
  APK="app/build/outputs/apk/debug/app-debug.apk"
fi

echo "Build done → $APK"

if adb devices | grep -q "device$"; then
  echo "Installing on connected device…"
  adb install -r "$APK"
  echo "Installed. Launch 'Second Brain Tablet' on your device."
else
  echo "No ADB device found — copy $APK to the tablet manually."
fi
