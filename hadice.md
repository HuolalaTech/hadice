# Hadice 一键脚本

仓库根目录：`./hadice.sh`（配套说明：本文件）。

## 一分钟启动

```bash
# 1. 依赖（首次）
brew install go go-task node
go install github.com/wailsapp/wails/v3/cmd/wails3@latest
# Android Agent：本机 Android Studio SDK + NDK、JDK（脚本会尽量自动找）
# 跨平台打 Windows：建议安装 Docker Desktop，并执行一次 task setup:docker

# 2. 可选私密配置
cp .env.ci.example .env.ci

# 3. 先选动作（无参数不会自动热启动）
./hadice.sh          # 交互菜单：选 hot / app / build / open / help
./hadice.sh hot      # 直接热启动
./hadice.sh app      # 直接编译本机 macOS App
./hadice.sh help     # 完整说明
```

热重载窗口由 Wails 拉起；**不要**用 `dist` 里的 `.app` 当开发环境（不会热更新）。

## 编译 App（多架构）

```bash
./hadice.sh app              # 当前本机架构 → .app + DMG
./hadice.sh app arm64        # macOS Apple Silicon
./hadice.sh app amd64        # macOS Intel
./hadice.sh app windows      # Windows amd64：安装包 EXE + 免安装 ZIP
./hadice.sh app all          # 全部：macOS arm64 + amd64 + Windows
./hadice.sh open [arch]      # 打开 macOS 产物
./hadice.sh build [target]   # 只编二进制，不打安装包
./hadice.sh dist             # 列出 dist 产物
```

也可：`./hadice.sh arm64` / `./hadice.sh windows` / `./hadice.sh all`（等价于 `app …`）。

产物：

| 目标 | 产物路径 |
|------|----------|
| macOS arm64 | `dist/macos-arm64/Hadice.app`、`Hadice-macos-arm64-v*.dmg` |
| macOS amd64 | `dist/macos-amd64/Hadice.app`、`Hadice-macos-amd64-v*.dmg` |
| Windows amd64 | `dist/windows/Hadice-windows-amd64-setup-v*.exe`、`…-portable-v*.zip` |

底层对应 Task：`package:macos:arm64` / `package:macos:amd64` / `package:windows:amd64` / `package:cross`。

单架构打包约 3–5 分钟（含 `build:agent`）；`app all` 更久。

## 命令一览

| 命令 | 作用 |
|------|------|
| `./hadice.sh` / `menu` | 交互菜单（默认；不自动启动） |
| `./hadice.sh help` | 打印本说明 |
| `./hadice.sh hot` / `dev` / `start` | 热启动 `task dev` |
| `./hadice.sh app [target]` | 打包；target=`arm64`/`amd64`/`windows`/`all` |
| `./hadice.sh build [target]` | 仅编译 |
| `./hadice.sh open [arch]` | 打开 macOS `.app` |
| `./hadice.sh dist` | 列出产物 |

脚本会补齐 Homebrew / Go bin 的 PATH，并探测 `ANDROID_HOME`、NDK、`JAVA_HOME`。

## 常见问题

1. **缺 go / task / wails3**：按脚本报错里的 `brew` / `go install` 装即可。  
2. **agent 编译失败**：确认 NDK（如 25.x）与 `JAVA_HOME`；也可设 `ANDROID_NDK_HOME`。  
3. **Windows / all 失败**：在 macOS 上跨编通常要 Docker；先 `task setup:docker`。  
4. **改了前端但界面没变**：确认是 `./hadice.sh hot` 起的进程，不是双击安装包。  
5. **更多构建细节**：见根目录 `AGENTS.md`、`README.md`。
