#!/usr/bin/env bash
# Hadice 一键脚本。完整启动说明见同目录：hadice.md
# 快速查看：./hadice.sh help

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"
DOC_FILE="${ROOT_DIR}/hadice.md"

# ---- PATH：Homebrew + Go install bin ----------------------------------------
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/go/bin:${PATH}"

# ---- 环境：NDK / JDK（agent 构建用）-----------------------------------------
setup_android_env() {
  if [[ -z "${ANDROID_HOME:-}" && -d "${HOME}/Library/Android/sdk" ]]; then
    export ANDROID_HOME="${HOME}/Library/Android/sdk"
  fi
  if [[ -z "${ANDROID_NDK_HOME:-}" && -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}/ndk" ]]; then
    local newest
    newest="$(ls -1 "${ANDROID_HOME}/ndk" 2>/dev/null | sort -V | tail -1 || true)"
    if [[ -n "$newest" ]]; then
      export ANDROID_NDK_HOME="${ANDROID_HOME}/ndk/${newest}"
    fi
  fi
  if [[ -z "${JAVA_HOME:-}" ]] && command -v /usr/libexec/java_home >/dev/null 2>&1; then
    export JAVA_HOME="$(/usr/libexec/java_home 2>/dev/null || true)"
  fi
}

need_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "缺少命令: $name" >&2
    case "$name" in
      go) echo "  brew install go" >&2 ;;
      task) echo "  brew install go-task" >&2 ;;
      wails3) echo "  go install github.com/wailsapp/wails/v3/cmd/wails3@latest" >&2 ;;
      npm) echo "  brew install node" >&2 ;;
      docker) echo "  安装 Docker Desktop（跨平台/Windows 打包需要）" >&2 ;;
    esac
    exit 1
  fi
}

host_arch() {
  case "$(uname -m)" in
    arm64|aarch64) echo "arm64" ;;
    x86_64|amd64) echo "amd64" ;;
    *)
      echo "无法识别本机架构: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

# 归一化目标：macos-arm64 | macos-amd64 | windows-amd64 | all
# 兼容：arm64 / amd64 / windows / win / all / cross / macos-arm64 ...
normalize_target() {
  local arg="${1:-}"
  if [[ -z "$arg" ]]; then
    echo "macos-$(host_arch)"
    return
  fi
  case "$arg" in
    arm64|aarch64|macos-arm64|darwin-arm64) echo "macos-arm64" ;;
    amd64|x86_64|x64|macos-amd64|darwin-amd64|intel) echo "macos-amd64" ;;
    windows|win|windows-amd64|win-amd64|windows/amd64) echo "windows-amd64" ;;
    all|cross|universal) echo "all" ;;
    *)
      echo "未知目标: ${arg}" >&2
      echo "支持: arm64 | amd64 | windows | all" >&2
      echo "示例: ./hadice.sh app arm64 | ./hadice.sh app windows | ./hadice.sh app all" >&2
      exit 1
      ;;
  esac
}

print_artifacts() {
  echo ""
  echo "产物目录:"
  local found=0
  local f
  for f in \
    dist/macos-arm64/Hadice-macos-arm64-v*.dmg \
    dist/macos-amd64/Hadice-macos-amd64-v*.dmg \
    dist/windows/Hadice-windows-amd64-setup-v*.exe \
    dist/windows/Hadice-windows-amd64-portable-v*.zip
  do
    if [[ -e "$f" ]]; then
      found=1
      ls -lh "$f" | awk '{print "  " $NF "  (" $5 ")"}'
    fi
  done
  if [[ "$found" -eq 0 ]]; then
    echo "  (暂无匹配产物，先 ./hadice.sh app …)"
  fi
}

cmd_help() {
  echo ""
  echo "说明文档: ${DOC_FILE}"
  echo "============================================================================="
  if [[ -f "$DOC_FILE" ]]; then
    cat "$DOC_FILE"
  else
    echo "缺少 hadice.md。常用命令:"
    echo "  ./hadice.sh          # 交互菜单（不自动启动）"
    echo "  ./hadice.sh hot      # 热启动"
    echo "  ./hadice.sh app      # 编译本机 macOS App + DMG"
    echo "  ./hadice.sh app all  # macOS arm64+amd64 + Windows"
    echo "  ./hadice.sh open     # 打开产物"
  fi
  echo ""
}

# 无参数：只出菜单，不自动热启动
cmd_menu() {
  local host
  host="$(host_arch)"
  echo ""
  echo "Hadice — 请选择操作（不会自动启动）"
  echo "说明: ${DOC_FILE}"
  echo "本机架构: ${host}"
  echo "----------------------------------------"
  echo "  1) hot         热启动开发（Vite / Wails 热重载）"
  echo "  2) app         打包本机 macOS（${host}）App + DMG"
  echo "  3) app-arm64   打包 macOS Apple Silicon"
  echo "  4) app-amd64   打包 macOS Intel"
  echo "  5) app-windows 打包 Windows amd64（安装包+ZIP，需 Docker）"
  echo "  6) app-all     打包全部：macOS arm64/amd64 + Windows"
  echo "  7) build       仅编译本机二进制（不打安装包）"
  echo "  8) open        打开本机架构的 Hadice.app"
  echo "  9) dist        列出 dist 产物"
  echo "  h) help        查看完整说明"
  echo "  0) quit        退出"
  echo "----------------------------------------"
  local choice
  read -r -p "输入序号或命令名 [0]: " choice
  choice="${choice:-0}"
  case "$choice" in
    1|hot|dev|start) cmd_dev ;;
    2|app|package|dmg) cmd_app ;;
    3|app-arm64|arm64) cmd_app arm64 ;;
    4|app-amd64|amd64|intel) cmd_app amd64 ;;
    5|app-windows|windows|win) cmd_app windows ;;
    6|app-all|all|cross) cmd_app all ;;
    7|build) cmd_build ;;
    8|open) cmd_open ;;
    9|dist|list) cmd_dist ;;
    h|help|-h|--help) cmd_help ;;
    0|q|quit|exit|"") echo "已取消。" ;;
    *)
      echo "无效选项: ${choice}" >&2
      echo "再运行 ./hadice.sh 或 ./hadice.sh help" >&2
      exit 1
      ;;
  esac
}

cmd_dev() {
  setup_android_env
  need_cmd go
  need_cmd task
  need_cmd wails3
  need_cmd npm

  if [[ ! -d frontend/node_modules ]]; then
    echo "==> frontend: npm install"
    (cd frontend && npm install)
  fi

  echo "==> 热启动: task dev"
  echo "    说明: ${DOC_FILE}"
  echo "    帮助: ./hadice.sh help"
  echo "    NDK: ${ANDROID_NDK_HOME:-"(未设置，由 agent/build.sh 自动探测)"}"
  echo "    JAVA_HOME: ${JAVA_HOME:-"(未设置)"}"
  exec task dev
}

cmd_build() {
  setup_android_env
  need_cmd go
  need_cmd task
  need_cmd npm
  local target
  target="$(normalize_target "${1:-}")"
  case "$target" in
    macos-arm64)
      echo "==> 编译 macOS arm64 二进制（不含 DMG）"
      task "build:macos:arm64"
      ;;
    macos-amd64)
      echo "==> 编译 macOS amd64 二进制（不含 DMG）"
      task "build:macos:amd64"
      ;;
    windows-amd64)
      echo "==> 编译 Windows amd64 二进制（不含安装包；跨平台通常需 Docker）"
      task "build:windows:amd64"
      ;;
    all)
      echo "==> 跨平台编译全部架构（build:cross）"
      task "build:cross"
      ;;
  esac
  print_artifacts
}

cmd_app() {
  setup_android_env
  need_cmd go
  need_cmd task
  need_cmd npm
  local target
  target="$(normalize_target "${1:-}")"
  case "$target" in
    macos-arm64)
      echo "==> 打包 macOS arm64 App + DMG"
      task "package:macos:arm64"
      echo "  App: ${ROOT_DIR}/dist/macos-arm64/Hadice.app"
      ;;
    macos-amd64)
      echo "==> 打包 macOS amd64 App + DMG"
      task "package:macos:amd64"
      echo "  App: ${ROOT_DIR}/dist/macos-amd64/Hadice.app"
      ;;
    windows-amd64)
      echo "==> 打包 Windows amd64（安装包 + 免安装 ZIP）"
      echo "    提示: 在 macOS 上跨编 Windows 通常需要 Docker（task setup:docker）"
      task "package:windows:amd64"
      ;;
    all)
      echo "==> 打包全部平台（package:cross）"
      echo "    = macOS arm64 + macOS amd64 + Windows amd64"
      echo "    提示: Windows 跨编通常需要 Docker"
      task "package:cross"
      ;;
  esac
  echo ""
  echo "完成。"
  print_artifacts
  if [[ "$target" == macos-arm64 || "$target" == macos-amd64 ]]; then
    local arch="${target#macos-}"
    echo ""
    echo "打开: ./hadice.sh open ${arch}"
  fi
}

cmd_open() {
  local target
  target="$(normalize_target "${1:-}")"
  case "$target" in
    macos-arm64|macos-amd64)
      local arch="${target#macos-}"
      local app="${ROOT_DIR}/dist/macos-${arch}/Hadice.app"
      if [[ ! -d "$app" ]]; then
        echo "未找到 ${app}" >&2
        echo "先执行: ./hadice.sh app ${arch}" >&2
        exit 1
      fi
      open "$app"
      ;;
    windows-amd64|all)
      echo "open 仅支持 macOS 产物。Windows 请到 dist/windows/ 安装或解压。" >&2
      print_artifacts
      exit 1
      ;;
  esac
}

cmd_dist() {
  print_artifacts
}

main() {
  if [[ $# -eq 0 ]]; then
    cmd_menu
    return
  fi
  local cmd="$1"
  shift
  case "$cmd" in
    help|-h|--help) cmd_help ;;
    menu) cmd_menu ;;
    dev|hot|start) cmd_dev "$@" ;;
    build) cmd_build "$@" ;;
    app|package|dmg) cmd_app "$@" ;;
    open) cmd_open "$@" ;;
    dist|list|artifacts) cmd_dist ;;
    # 快捷：./hadice.sh arm64 | windows | all
    arm64|amd64|windows|win|all|cross)
      cmd_app "$cmd" "$@"
      ;;
    *)
      echo "未知命令: $cmd" >&2
      echo "运行 ./hadice.sh 选菜单，或 ./hadice.sh help" >&2
      exit 1
      ;;
  esac
}

main "$@"
