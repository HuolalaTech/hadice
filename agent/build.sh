#!/bin/bash

# Network Agent Build Script
# Builds the JVMTI agent for Android (arm64-v8a and armeabi-v7a)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
ANDROID_NDK="${ANDROID_NDK_HOME:-${ANDROID_HOME}/ndk/25.2.9519653}"

if [ ! -d "$ANDROID_NDK" ]; then
	echo "Error: Android NDK not found."
	echo "Please set ANDROID_NDK_HOME or ANDROID_HOME environment variable."
	echo "Expected path: $ANDROID_NDK"
	exit 1
fi

echo "Using NDK: $ANDROID_NDK"

CMAKE_PATH="${ANDROID_NDK}/build/cmake/android.toolchain.cmake"
if [ ! -f "$CMAKE_PATH" ]; then
	echo "Error: Android NDK toolchain not found at $CMAKE_PATH"
	exit 1
fi

build_arch() {
	local ABI=$1
	local BUILD_TYPE=${2:-Release}

	echo "Building for $ABI..."

	local ARCH_BUILD_DIR="${BUILD_DIR}/${ABI}"
	mkdir -p "$ARCH_BUILD_DIR"

	cmake \
		-S "${SCRIPT_DIR}" \
		-B "${ARCH_BUILD_DIR}" \
		-DANDROID_ABI="$ABI" \
		-DANDROID_PLATFORM=android-26 \
		-DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
		-DCMAKE_TOOLCHAIN_FILE="$CMAKE_PATH" \
		-DANDROID_STL=c++_static \
		-G "Unix Makefiles"

	local JOBS
	JOBS=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
	cmake --build "${ARCH_BUILD_DIR}" --config "$BUILD_TYPE" -j"$JOBS"

	local SO_FILE="${ARCH_BUILD_DIR}/libnetwork_agent.so"
	if [ -f "$SO_FILE" ]; then
		echo "Built: $SO_FILE"
		ls -la "$SO_FILE"
	else
		echo "Error: Build failed - $SO_FILE not found"
		exit 1
	fi
}

mkdir -p "${BUILD_DIR}"

echo "=========================================="
echo "Building Helper DEX"
echo "=========================================="
bash "${SCRIPT_DIR}/build_helper.sh"

echo "=========================================="
echo "Building Network Agent for Android"
echo "=========================================="

build_arch "arm64-v8a"
build_arch "armeabi-v7a"

echo "=========================================="
echo "Build complete!"
echo "=========================================="
echo "Output files:"
ls -la "${BUILD_DIR}"/*/libnetwork_agent.so 2>/dev/null || echo "No output files found"

echo ""
echo "To push agent to device:"
echo "  adb push build/arm64-v8a/libnetwork_agent.so /data/local/tmp/"
