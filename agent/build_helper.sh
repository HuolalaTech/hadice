#!/bin/bash
# Compile NetworkHookHelper.java to DEX and generate C++ header with embedded bytes.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JAVA_SRC="${SCRIPT_DIR}/java/com/hadice/agent/NetworkHookHelper.java"
GNET_CALLBACK_SRC="${SCRIPT_DIR}/java/com/hadice/agent/GnetCronetCaptureCallback.java"
CRONET_STUB_SRC_DIR="${SCRIPT_DIR}/java_stub"
BUILD_TMP="${SCRIPT_DIR}/build/helper_tmp"
OUT_HEADER="${SCRIPT_DIR}/include/helper_dex.h"

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ANDROID_JAR=""
for v in 35 34 33 32 31 30 29 28 27 26; do
    candidate="${ANDROID_HOME}/platforms/android-${v}/android.jar"
    if [ -f "$candidate" ]; then
        ANDROID_JAR="$candidate"
        break
    fi
done

if [ -z "$ANDROID_JAR" ]; then
    echo "Error: android.jar not found. Please install Android SDK platform."
    exit 1
fi

D8=""
for dir in $(ls -d "${ANDROID_HOME}/build-tools"/*/ 2>/dev/null | sort -V -r); do
    if [ -f "${dir}d8" ]; then
        D8="${dir}d8"
        break
    fi
done

if [ -z "$D8" ]; then
    echo "Error: d8 not found. Please install Android SDK build-tools."
    exit 1
fi

echo "Using android.jar: $ANDROID_JAR"
echo "Using d8: $D8"

rm -rf "$BUILD_TMP"
mkdir -p "$BUILD_TMP/classes"

echo "Compiling Java..."
javac -source 8 -target 8 \
    -cp "$ANDROID_JAR" \
    -d "$BUILD_TMP/classes" \
    "$JAVA_SRC" \
    "${CRONET_STUB_SRC_DIR}/org/chromium/net/UrlRequest.java" \
    "${CRONET_STUB_SRC_DIR}/org/chromium/net/UrlResponseInfo.java" \
    "${CRONET_STUB_SRC_DIR}/org/chromium/net/CronetException.java" \
    "${CRONET_STUB_SRC_DIR}/org/chromium/net/UploadDataProvider.java" \
    "${CRONET_STUB_SRC_DIR}/org/chromium/net/UploadDataSink.java" \
    "$GNET_CALLBACK_SRC" \
    "${CRONET_STUB_SRC_DIR}/gnet/android/org/chromium/net/UrlRequest.java" \
    "${CRONET_STUB_SRC_DIR}/gnet/android/org/chromium/net/ExperimentalUrlRequest.java" \
    "${CRONET_STUB_SRC_DIR}/gnet/android/org/chromium/net/UrlResponseInfo.java" \
    "${CRONET_STUB_SRC_DIR}/gnet/android/org/chromium/net/CronetException.java"

# Cronet is supplied by the target app. These compile-only API stubs let the
# helper DEX reference the official org.chromium.net callback types without
# bundling or shadowing any Cronet implementation in the target process.
jar cf "$BUILD_TMP/cronet-api-stubs.jar" \
    -C "$BUILD_TMP/classes" org/chromium/net \
    -C "$BUILD_TMP/classes" gnet/android/org/chromium/net

echo "Converting to DEX..."
"$D8" --min-api 26 \
    --classpath "$BUILD_TMP/cronet-api-stubs.jar" \
    --output "$BUILD_TMP" \
    "$BUILD_TMP/classes/com/hadice/agent/"*.class

DEX_FILE="$BUILD_TMP/classes.dex"
if [ ! -f "$DEX_FILE" ]; then
    echo "Error: DEX file not produced"
    exit 1
fi

DEX_SIZE=$(wc -c < "$DEX_FILE" | tr -d ' ')
echo "DEX size: $DEX_SIZE bytes"

echo "Generating C++ header..."
cat > "$OUT_HEADER" << 'HEADER_TOP'
#ifndef HELPER_DEX_H
#define HELPER_DEX_H

#include <cstdint>
#include <cstddef>

namespace network_agent {

HEADER_TOP

echo "static const uint8_t HELPER_DEX_BYTES[] = {" >> "$OUT_HEADER"
xxd -i < "$DEX_FILE" >> "$OUT_HEADER"
echo "};" >> "$OUT_HEADER"
echo "" >> "$OUT_HEADER"
echo "static const size_t HELPER_DEX_SIZE = sizeof(HELPER_DEX_BYTES);" >> "$OUT_HEADER"
echo "" >> "$OUT_HEADER"
echo "}" >> "$OUT_HEADER"
echo "" >> "$OUT_HEADER"
echo "#endif" >> "$OUT_HEADER"

echo "Generated: $OUT_HEADER ($DEX_SIZE bytes)"

rm -rf "$BUILD_TMP"
echo "Done."
