# AGENTS.md

Hadice：基于 **Wails v3** 的安卓 & 鸿蒙桌面调试工具（Go 后端 + React 前端）。

## 快速启动

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@latest

cd frontend && npm install && cd ..

# 可选：私密配置（分析 / 更新检查 / 文档链接）
cp .env.ci.example .env.ci

task dev   # 先 build:agent，再 Wails 热重载
```

或：`wails3 dev -config ./build/config.yml`

## 构建命令

| 命令 | 说明 |
|------|------|
| `task dev` | 开发模式（含 `build:agent`） |
| `task build:agent` | 编译 Android JVMTI Agent（需 NDK + JDK） |
| `task build` / `task build:*` | 构建应用（会先 `build:agent`） |
| `task build:macos:arm64` / `amd64` | macOS |
| `task build:windows:amd64` | Windows |
| `task build:cross` | 跨平台构建 |
| `task package:macos:arm64` / `package:cross` | 打包 DMG / 安装包 |
| `task gen:version` | 从 `build/config.yml` 生成 `backend/version.go` |
| `task gen:cienv` | 从 `.env.ci` 生成 `backend/cienv_generated.go`（**不**把文件打进包） |
| `task clean` / `task clean:dist` | 清理产物 |

产物：`dist/{platform}-{arch}/`。

## 版本

唯一来源：`build/config.yml` → `info.version`。勿手改 `backend/version.go`。

## 私密配置

`.env.ci` 仅本地 / CI 使用，**禁止**复制进应用包。构建依赖 `generate:cienv` 将字段写入 `backend/cienv_generated.go`；前端 `VITE_*` 由 Vite 在构建时注入。发布后勿提交非空的 `cienv_generated.go`。

## 目录结构

```text
├── main.go                 # embed frontend/dist，调用 backend.Run()
├── backend/                # Wails Service
│   ├── main.go             # 应用 / 窗口；LoadCIEnv + InitPosthog
│   ├── envci.go            # 加载本地 .env.ci + 应用构建期嵌入值
│   ├── cienv_generated.go  # generate:cienv 产物（开源默认为空）
│   ├── app.go              # AppService（前端可调方法入口）
│   ├── posthog.go          # 后端分析（无 key 则禁用）
│   ├── hdc/ · adb/         # 双平台命令封装
│   ├── device/             # 统一设备模型
│   ├── hiprofiler/ · android/  # 鸿蒙 / 安卓抓包
│   └── phoneAgent/         # AI 自动化
├── frontend/
│   ├── src/App.tsx · pages/ · components/ · store/ · lib/
│   ├── bindings/ · wailsjs/    # 生成物，勿手改
│   └── vite.config.ts          # 从根目录 .env.ci 注入 VITE_*
├── agent/                  # Android JVMTI Agent 源码
├── assets/{os}/{arch}/bin/ # hdc、adb、scrcpy、restool 等
├── assets/NOTICE           # 第三方原生二进制归属与许可证
├── NOTICE · LICENSE        # 项目归属与 Apache-2.0
├── SECURITY.md · CONTRIBUTING.md · CODE_OF_CONDUCT.md · SUPPORT.md
├── build/config.yml · darwin/ · windows/
├── docs/ · docs/screenshots/
├── .env.ci.example         # 私密配置模板
├── README.md · README_EN.md
└── AGENTS.md               # 本文件
```

## 前后端通信

- 框架：Wails v3
- 绑定：`wails3 generate bindings` → `frontend/bindings/`
- 前端调用：`frontend/bindings/Hadice/backend/appservice`
- 事件：`application.Get().Event.Emit(...)` ↔ `EventsOn`
- 别名：`@/` → `src/`，`@wails/` → `wailsjs/`

## 关键约定

### 双平台

`device.Platform` 区分 HarmonyOS（hdc）与 Android（adb）。公共 API 多用 `ByPlatform` 后缀。

### 原生工具

放在 `assets/{os}/{arch}/bin/`；构建时 `copy:assets` 打进包内。运行时由 `backend/hdc/path.go` 等定位。

### Android Agent

`libnetwork_agent.so` **不入库**，由 `task build:agent` 生成：

- `agent/include/helper_dex.h`
- `agent/build/{arm64-v8a,armeabi-v7a}/libnetwork_agent.so`

打包复制到 `Resources/agent/<abi>/`（Windows：`resources/agent/<abi>/`）。需 `ANDROID_NDK_HOME`（或 `ANDROID_HOME`）与 `JAVA_HOME`。

### 前端栈

React 19、Vite 7、Tailwind 4、Zustand、Radix/shadcn、Recharts、xterm.js。TS `strict: false`。

### 多窗口

`OpenPanelWindow` / `ClosePanelWindow`；`?page=xxx&standalone=1` 独立窗口布局。
