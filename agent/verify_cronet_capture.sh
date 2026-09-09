#!/bin/bash
# Cronet JVMTI capture verification checklist for debuggable apps.
set -euo pipefail

PACKAGE="${1:-}"
AGENT_SO="${2:-build/arm64-v8a/libnetwork_agent.so}"
PORT="${3:-6200}"

if [ -z "$PACKAGE" ]; then
  echo "Usage: $0 <debuggable.package.name> [agent.so] [port]"
  echo ""
  echo "Verification checklist:"
  echo "  1. Breakpoint on CronetEngine.newUrlRequestBuilder replaces Callback"
  echo "  2. Builder setHttpMethod/addHeader/setUploadDataProvider/build hooks fire"
  echo "  3. UrlRequest.read records ByteBuffer start position"
  echo "  4. onReadCompleted copies [start, position) response bytes"
  echo "  5. UploadDataProvider wrapper records request body chunks"
  echo "  6. Helper failures degrade without breaking host requests"
  exit 1
fi

if [ ! -f "$AGENT_SO" ]; then
  echo "Agent not found: $AGENT_SO"
  echo "Run ./build.sh first."
  exit 1
fi

echo "Pushing agent..."
adb push "$AGENT_SO" /data/local/tmp/libnetwork_agent.so
adb reverse "tcp:${PORT}" "tcp:${PORT}"

echo "Starting app and attaching agent..."
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 2
adb shell am attach-agent "$PACKAGE" /data/local/tmp/libnetwork_agent.so

echo ""
echo "Attached. Trigger Cronet traffic in the app, then inspect logs:"
echo "  adb logcat -s NetworkAgent NetworkHookHelper"
echo ""
echo "Expected log markers:"
echo "  - Breakpoint set on CronetEngine.newUrlRequestBuilder()"
echo "  - Breakpoint set on Cronet.Builder.setHttpMethod()/addHeader()/setUploadDataProvider()/build()"
echo "  - Breakpoint set on Cronet.UrlRequest.read()"
echo "  - http_record JSON emitted via nativeSendMessage"
