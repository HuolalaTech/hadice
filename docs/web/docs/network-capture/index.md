# 网络抓包（鸿蒙）

![鸿蒙网络抓包界面](/screenshots/09-capture.png)

## 功能介绍

鸿蒙抓包支持两种模式：**Sophon 模式**（基于 @hll/Sophon 库的 HTTP 抓包，实时展示并支持 Mock）与 **HiProfiler 模式**（基于 HarmonyOS 系统级 HiProfiler，无需在 APP 中集成额外库）。两种模式适用于不同的集成与调试场景，可在页面内直接切换。

## 前提条件

- 已连接鸿蒙设备并授权调试
- **Sophon 模式**：目标 APP 需集成 @hll/Sophon 库，并在 APP 内开启 Sophon 悬浮窗的 HTTP 流量转发开关
- **HiProfiler 模式**：目标 APP 是使用调试证书签名的应用，且正在运行（进程存活）

## 模式对比

| 对比项 | Sophon 模式 | HiProfiler 模式 |
| --- | --- | --- |
| 前置条件 | APP 需集成 @hll/Sophon 库 | APP 是使用调试证书签名的应用 |
| 实时展示 | ✓ | 响应完成后由系统批量上报，尾批可能延迟 |
| Mock 支持 | ✓ | ✗ |
| 数据来源 | APP 层 Axios Hook | 系统层 Hook |
| 适用场景 | APP 网络库是 Axios / 需要 Mock 功能 | 未使用 Axios / 不想引入 Sophon 库 / 无 Mock 需求 |
| 额外操作 | 需在 APP 中开启 Sophon 悬浮窗的 HTTP 流量转发 | 无需额外操作 |

## 界面布局

- **标题栏**：模式切换下拉、进程选择（HiProfiler）、Mock（Sophon）、开始 / 停止抓包、导出
- **请求列表**：搜索 / 过滤、请求详情
- **底部状态栏**：进程名、PID、等待进程重启、端口转发与心跳健康度

## 界面与按钮说明

### 模式切换

工具栏下拉框可在「Sophon模式」与「HiProfiler模式」之间切换。HiProfiler 抓包进行中时不可切换模式。

### HiProfiler 模式

1. 在进程选择器中选择目标应用（仅显示可调试且正在运行的应用）
2. 点击「开始抓包」，首次启动可能需要等待几秒（系统会重启 `hiprofilerd` 服务）
3. 操作鸿蒙 APP 触发网络请求，请求会显示在列表中
4. 目标进程退出后按钮变为「停止等待」，系统自动等待新 PID 并恢复抓包

### Sophon 模式

1. 点击「开始抓包」，等待提示「TCP 服务器已启动」
2. 在目标鸿蒙 APP 中开启 Sophon 悬浮窗的 HTTP 流量转发开关
3. 操作 APP 触发请求，请求实时显示在列表中
4. 点击「停止抓包」结束采集

### Mock 配置（仅 Sophon）

- 点击「Mock」按钮打开配置弹窗，添加拦截规则
- 规则可配置请求 URL 匹配（支持正则表达式）与自定义响应
- 需要勾选「启用此规则」才会生效
- 请求列表右键请求也可快捷创建 Mock 规则

### 请求列表

- 搜索框支持按关键词过滤，可切换正则模式与过滤模式
- 支持自动滚动，新请求自动可见
- 点击请求查看请求 / 响应详情
- 在 Sophon 模式下，请求行支持 Mock 快捷操作

### 导出

「导出」按钮导出选中的网络请求（支持单条或批量），导出弹窗可配置导出内容，导出成功后可打开所在目录。

### 底部状态栏

显示当前进程名与 PID、等待进程重启状态、端口转发（本地端口 6100 → 设备端口 35201）与心跳健康度（绿/黄/红），用于判断抓包链路是否正常。

## 使用场景

- 调试 APP 网络请求，确认接口参数与响应
- 未引入 Sophon 库时，用 HiProfiler 做系统级抓包
- 用 Sophon + Mock 模拟接口返回，脱离后端联调

## FAQ

<details>
<summary>HiProfiler 模式为什么看不到目标应用？</summary>

HiProfiler 模式只显示 debug 签名且正在运行的应用。请确认：

- 应用使用 debug 证书签名
- 应用正在运行中（进程存活）
</details>

<details>
<summary>Sophon 模式抓不到请求？</summary>

请依次检查：

- 目标 APP 是否已集成 Sophon 库
- Sophon 悬浮窗中 HTTP 流量转发是否已开启
- 电脑端是否已点击「开始抓包」并显示服务器已启动
</details>

<details>
<summary>HiProfiler 模式首次开始抓包失败？</summary>

首次启动时需要重启设备上的 hiprofilerd 服务，可能需要等待几秒。如果持续失败，请断开设备重连后再试。
</details>

<details>
<summary>Mock 规则不生效？</summary>

Mock 功能仅 Sophon 模式支持。请确认：

- 已切换到 Sophon 模式
- 规则已勾选「启用此规则」
- URL 匹配规则正确（可使用正则表达式）
- 抓包功能处于开启状态
</details>
