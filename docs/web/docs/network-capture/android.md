# 安卓抓包

![安卓网络抓包界面](/screenshots/09-capture.png)

## 功能介绍

安卓抓包通过 JVMTI Agent 与 WebView CDP 并行采集 OkHTTP、Cronet、GNet 和 WebView 请求，实时展示请求与响应，并支持 Replace Mock（让匹配的请求直接返回配置的响应，不访问真实服务器）。仅支持 debuggable 应用。

## 前提条件

- 设备需通过 USB 连接并启用调试授权
- 目标应用必须是 debuggable（`android:debuggable="true"`）
- 支持的网络栈：OkHTTP3、org.chromium.net Cronet、gnet.android:gnet-cronet 3.0.3、启用了调试能力的 Android WebView
- WebView 通过 Chromium DevTools Protocol 采集，响应体最多保留前 1 MiB；Mock 仅处理 Replace 规则
- Mock 能力依赖当前抓包 Agent 连接状态，停止抓包或 APP 进程退出后需要重新开始抓包

## 界面布局

- **标题栏**：进程选择、Mock、开始 / 停止抓包、清空请求、导出
- **请求列表**：搜索过滤、请求 / 响应详情
- **底部状态栏**：进程名 / 包名、等待进程重启状态

## 界面与按钮说明

### 开始抓包

1. 通过 USB 连接 Android 设备，并确认设备已授权调试
2. 在进程选择框中选择目标 debuggable 应用
3. 点击「开始抓包」，Hadice 会自动推送并附加 JVMTI Agent
4. 操作目标 APP 触发网络请求，请求会实时显示在列表中
5. 如果目标 APP 已经启动但抓不到请求，可杀掉 APP 后重新开始抓包

### 停止抓包

抓包进行中点击「停止抓包」结束采集。目标进程退出后按钮变为「停止等待」，等待进程重启后自动恢复。

### 使用 Mock

Mock 用于让匹配的请求不访问真实服务器，直接返回你配置的状态码、响应头和响应体。WebView 仅支持 Replace 模式，命中规则后由 CDP 直接返回配置响应。

配置方式：

- **方式一**：点击工具栏的「Mock」按钮，手动新增规则
- **方式二**：在请求列表中右键目标请求，选择「mock该请求」

编辑规则时，确认 URL 匹配规则能匹配完整请求 URL，可在「测试URL」中验证匹配结果。勾选左侧规则启用框后点击「保存配置」，抓包中保存会立即同步到 Android Agent 与 WebView CDP 会话。

### 请求列表

- 支持按关键词过滤搜索
- 点击请求查看请求 / 响应详情（HTTPS 请求可查看明文，响应体最多保留前 1 MiB）
- 支持清空请求列表，方便开启新一轮观察
- 支持导出网络请求（单条或批量）

### 底部状态栏

显示当前进程名 / 包名，以及「等待进程重启」等抓包状态。

## 使用场景

- 检查 APP 网络请求的参数、响应与耗时
- 用 Mock 模拟异常返回（超时、错误码、特定响应体）做异常分支测试
- WebView 页面请求调试（Replace 模式直接返回配置响应）

## FAQ

<details>
<summary>为什么抓不到请求？</summary>

请确认：

- 目标应用是 debuggable 的
- 请求经过 OkHTTP、Cronet、GNet 或 Android WebView
- 设备已通过 USB 连接并授权调试
- 已选择正确的目标进程
- APP 在开始抓包后重新触发了网络请求
</details>

<details>
<summary>支持 HTTPS 抓包吗？</summary>

支持。OkHTTP、Cronet、GNet 在应用层采集，WebView 通过 CDP 采集，都可以查看 HTTPS 的明文请求和响应；响应体最多保留前 1 MiB。
</details>

<details>
<summary>Mock 规则不生效？</summary>

请确认：

- 已勾选对应规则左侧的启用框
- 已点击「保存配置」
- 抓包处于开启状态，且 Android Agent 已连接
- URL 匹配规则能匹配完整请求 URL，可使用「测试URL」验证
- WebView 规则使用的是 Replace 模式
- 修改规则后如果 APP 进程已重启，需要重新开始抓包并等待配置推送
</details>
