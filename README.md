# Hadice

<p align="center">
  <img src="frontend/src/assets/icon.png" alt="Hadice" width="96" height="96" />
</p>

<p align="center">
  <strong>安卓 & 鸿蒙桌面端调试工具</strong>
</p>

<p align="center">
  <a href="./README.md">中文</a> ·
  <a href="./README_EN.md">English</a> ·
</p>

<p align="center">
  <!-- 可替换为 GitHub Release / Stars 等徽章 -->
  <!-- ![Release](https://img.shields.io/github/v/release/OWNER/hadice) -->
  <!-- ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue) -->
</p>

Hadice是由货拉拉出品的, 基于 [Wails v3](https://wails.io/) 的跨平台桌面应用，通过 USB / 无线调试连接 **HarmonyOS Next** 与 **Android** 设备，在电脑端完成性能监控、应用管理、文件互传、投屏录屏、网络抓包、AI 自动化等开发调试工作。

> **iOS 平台支持正在逐步实现中**，敬请期待。

---

## 界面预览

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/01-overview.png" alt="设备总览" />
      <br />
      <b>设备总览</b>
      <br />
      <sub>查看电池、CPU、内存、存储与系统信息</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/02-performance.png" alt="性能监控" />
      <br />
      <b>性能监控</b>
      <br />
      <sub>CPU / 内存 / 网络 / 帧率曲线，支持导出</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/03-process.png" alt="进程管理" />
      <br />
      <b>进程管理</b>
      <br />
      <sub>按 CPU / 内存排序，搜索并结束进程</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/04-apps.png" alt="应用管理" />
      <br />
      <b>应用管理</b>
      <br />
      <sub>启动、停止、卸载与清理应用数据</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/05-install.png" alt="应用安装" />
      <br />
      <b>应用安装</b>
      <br />
      <sub>拖拽或选择 APK / HAP 快速安装</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/06-mirror.png" alt="投屏截屏" />
      <br />
      <b>投屏截屏</b>
      <br />
      <sub>实时镜像、截图、录屏与历史管理</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/07-transfer.png" alt="文件传输" />
      <br />
      <b>文件传输</b>
      <br />
      <sub>设备与电脑双向互传，支持批量队列</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/08-logs.png" alt="系统日志" />
      <br />
      <b>系统日志</b>
      <br />
      <sub>hilog / logcat 实时查看、过滤与保存</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/09-capture.png" alt="网络抓包" />
      <br />
      <b>网络抓包</b>
      <br />
      <sub>鸿蒙 / 安卓抓包，详情预览、Mock 与导出</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/10-infos.png" alt="系统信息" />
      <br />
      <b>系统信息</b>
      <br />
      <sub>浏览并搜索设备系统属性</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/11-terms.png" alt="终端命令" />
      <br />
      <b>终端命令</b>
      <br />
      <sub>HDC / ADB Shell 与本地终端</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/12-ai-auto.png" alt="AI 自动化" />
      <br />
      <b>AI 自动化</b>
      <br />
      <sub>基于视觉与指令的设备自动化操作</sub>
    </td>
  </tr>
</table>

---

## 下载与安装
### macOS
1. 从 [GitHub Releases](../../releases) 下载对应平台的dmg安装包。
2. 安装应用
- 双击下载的 DMG 文件
- 将 Hadice.app 拖动到 Applications 文件夹
3. 由于没有签名, 首次打开前请在终端执行（**必要，否则提示「无法打开」或「已损坏」**）
- 打开终端（Terminal）
- 执行以下命令：
```
sudo xattr -dr com.apple.quarantine /Applications/Hadice.app
```
- 输入您的 Mac 登录密码后按回车
- 重新打开 Hadice

### Windows

1. 从 [GitHub Releases](../../releases) 下载exe安装包。
2. 按安装向导完成安装即可。若 SmartScreen 提示未知应用，选择「仍要运行」.

---

## 使用指南
1. 开启手机的开发者模式

   • 鸿蒙手机：进入"设置 > 关于本机 > 软件版本"，连续点击7次"软件版本"，返回"设置 > 系统 > 开发者选项"，启用"开发者选项"和"USB调试"

   • 安卓手机：进入"设置 > 关于手机"，连续点击"版本号"7次，返回"设置 > 开发者选项"，启用"USB调试"

2. USB连接

   将手机通过USB数据线连接到电脑
3. 刷新设备

   • 在程序右上角点击"刷新"图标

   • 在手机上点击"允许此电脑调试设备"

   • 如有连接问题，可点击"连接诊断"进行排查

## 功能指南

   - 每个菜单标题的右侧都有帮助按钮，点击可查看详细使用说明
<p align="left">
  <img src="docs/screenshots/help.png" alt="Hadice" height="96" />
</p>
   - 每个菜单都可以单独拆分为独立窗口显示, 方便并行使用
<p align="left">
  <img src="docs/screenshots/open-in-window.png" alt="Hadice" height="96" />
</p>

---

## 从源码开发与编译

### 环境要求

| 依赖                                | 说明                                                          |
|-----------------------------------|-------------------------------------------------------------|
| Go                                | 1.24+                                                       |
| Node.js                           | 建议 20+（含 npm）                                               |
| [Task](https://taskfile.dev/)     | 构建任务入口                                                      |
| [Wails v3 CLI](https://wails.io/) | `go install github.com/wailsapp/wails/v3/cmd/wails3@latest` |
| Android NDK  + JDK                | 编译安卓抓包 Agent 时需要（`task build` / `task dev` 会调用）, NDK 25.2.9519653       |

### 克隆与安装

```bash
git clone https://github.com/HuolalaTech/hadice.git
cd hadice

# 前端依赖
cd frontend && npm install && cd ..

# （可选）配置：分析 / 更新检查 / 文档链接等
cp .env.ci.example .env.ci
```

### 开发模式

```bash
task dev
```

### 构建与打包

| 命令 | 说明 |
|------|------|
| `task build:agent` | 仅编译 Android Agent（需 NDK + JDK） |
| `task build` | 构建当前平台应用 |
| `task build:macos:arm64` | macOS Apple Silicon |
| `task build:macos:amd64` | macOS Intel |
| `task build:windows:amd64` | Windows AMD64 |
| `task build:cross` | 跨平台全量构建 |
| `task package:macos:arm64` | 打包 macOS ARM64 DMG |
| `task package:cross` | 全平台打包 |
| `task gen:version` | 从 `build/config.yml` 生成 `backend/version.go` |
| `task gen:cienv` | 从 `.env.ci` 写入 `backend/cienv_generated.go`（**不**把 `.env.ci` 打进包） |
| `task clean` | 清理 `bin/` 与 agent 产物 |
| `task clean:dist` | 清理 `dist/` |

产物目录：`dist/{platform}-{arch}/`。

### 版本号

唯一来源：`build/config.yml` → `info.version`。修改后构建流程会同步到产物文件名与运行时版本。

```yaml
info:
  version: "2.3.0"
```


## 贡献

欢迎通过 Issue 与 Pull Request 参与贡献。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

安全相关问题请参阅 [SECURITY.md](./SECURITY.md)；使用支持见 [SUPPORT.md](./SUPPORT.md)。

---

## 开源许可

本项目由 **货拉拉** 出品，采用 [Apache License 2.0](./LICENSE) 开源。

Copyright © 2026 深圳依时货拉拉科技有限公司

随应用分发的第三方原生二进制归属与许可证见 [assets/NOTICE](./assets/NOTICE) 与根目录 [NOTICE](./NOTICE)。

## 作者 / 归属

- 出品方：货拉拉（[HuolalaTech/hadice](https://github.com/HuolalaTech/hadice)）
- 行为准则：[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

---

<p align="center">
  Made with ❤️ for Android & HarmonyOS developers
</p>
