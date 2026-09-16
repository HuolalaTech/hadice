#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="$(dirname "$1")"
ARCH="$2"

# Rebuild bin/ from scratch so stale files from previous branches/builds do not leak.
rm -rf "$OUTPUT_DIR/bin"
mkdir -p "$OUTPUT_DIR/bin"
if [ -d "assets/windows/$ARCH/bin" ]; then cp -r "assets/windows/$ARCH/bin/"* "$OUTPUT_DIR/bin/"; fi

for abi in arm64-v8a armeabi-v7a; do
  SRC="agent/build/$abi/libnetwork_agent.so"
  if [ ! -f "$SRC" ]; then
    echo "Error: missing $SRC — run 'task build:agent' first"
    exit 1
  fi
  AGENT_DIR="$OUTPUT_DIR/resources/agent/$abi"
  mkdir -p "$AGENT_DIR"
  cp "$SRC" "$AGENT_DIR/"
done

# Ship third-party attribution with redistributed native binaries (never ship .env.ci).
mkdir -p "$OUTPUT_DIR/resources"
if [ -f NOTICE ]; then cp NOTICE "$OUTPUT_DIR/resources/NOTICE"; cp NOTICE "$OUTPUT_DIR/NOTICE"; fi
if [ -f assets/NOTICE ]; then cp assets/NOTICE "$OUTPUT_DIR/resources/THIRD_PARTY_NOTICE"; cp assets/NOTICE "$OUTPUT_DIR/THIRD_PARTY_NOTICE"; fi
if [ -f LICENSE ]; then cp LICENSE "$OUTPUT_DIR/resources/LICENSE"; cp LICENSE "$OUTPUT_DIR/LICENSE"; fi
