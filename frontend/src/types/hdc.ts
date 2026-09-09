/**
 * 设备平台类型
 */
export type Platform = 'harmonyos' | 'android'

/**
 * 统一设备信息接口
 */
export interface Device {
  connectKey: string
  connectionType: string
  status: string
  deviceName?: string
  productName?: string
  model?: string
  displayName?: string
  platform: Platform | string
}

/**
 * HDC 设备信息接口（保持向后兼容）
 */
export interface HdcDevice {
  connectKey: string
  connectionType: string
  status: string
  deviceName?: string
  productName?: string
  model?: string
  displayName?: string
  platform?: Platform | string
}

/**
 * HDC 命令执行结果
 */
export interface HdcResult {
  success: boolean
  output: string
  error?: string
}

/**
 * 设备详细信息
 */
export interface DeviceDetailInfo {
  productName: string
  model: string
  brand: string
  manufacturer: string
  deviceType: string
  serialNumber: string
  osName: string
  osVersion: string
  apiVersion: string
  softwareVersion: string
  ohosFullName: string
  securityPatch: string
  kernelVersion: string
  cpuAbi: string
  hardwareVersion: string
}

/**
 * 电池信息
 */
export interface BatteryInfo {
  capacity: number
  temperature: number
  voltage: number
  chargingStatus: 'charging' | 'discharging' | 'full' | 'not_charging' | 'unknown'
  pluggedType: 'none' | 'ac' | 'usb' | 'wireless' | 'unknown'
  technology: string
  health: 'good' | 'overheat' | 'dead' | 'over_voltage' | 'cold' | 'unknown'
}

/**
 * 内存信息
 */
export interface MemoryInfo {
  total: number
  free: number
  available: number
  cached: number
  usedPercent: number
}

/**
 * 存储信息
 */
export interface StorageInfo {
  total: string
  used: string
  available: string
  usedPercent: number
  mountPoint: string
}

/**
 * CPU 使用信息
 */
export interface CpuUsageInfo {
  usagePercent: number
  user: number
  system: number
  idle: number
}

/**
 * 进程 CPU 使用率（来自 hidumper --cpuusage）
 */
export interface ProcessCpuEntry {
  pid: number
  totalUsage: number
  userSpace: number
  kernelSpace: number
  name: string
}

/**
 * 网络信息
 */
export interface NetworkInfo {
  interface: string
  ipAddress: string
  macAddress: string
  netmask: string
}

/**
 * 系统运行信息
 */
export interface SystemRuntime {
  uptime: string
  loadAverage: string
  currentTime: string
}

/**
 * 系统属性
 */
export interface SystemProperties {
  [key: string]: string
}

/**
 * 详细 CPU 信息
 */
export interface CpuDetailInfo {
  total: number
  user: number
  kernel: number
  idle: number
  iowait: number
  irq: number
  softirq: number
  loadAverage: {
    one: number
    five: number
    fifteen: number
  }
  cores: {
    core: number
    currentFreq: number
    maxFreq: number
  }[]
}

/**
 * 详细内存信息
 */
export interface MemoryDetailInfo {
  total: number
  used: number
  free: number
  available: number
  cached: number
  buffers: number
  swapTotal: number
  swapUsed: number
  swapFree: number
  usedPercent: number
}

/**
 * 网络流量信息
 */
export interface NetworkTrafficInfo {
  interface: string
  rxBytes: number
  txBytes: number
  rxPackets: number
  txPackets: number
}

/**
 * 图形性能信息
 */
export interface GraphicsInfo {
  gpuVendor: string
  gpuRenderer: string
  gpuVersion: string
  surfaceMemory: number
  fpsCount: {
    fps60: number
    fps90: number
    fps120: number
  }
  currentFps: number
}

/**
 * 进程信息
 */
export interface ProcessInfo {
  pid: number
  user: string
  priority: number
  nice: number
  virt: string
  res: string
  shr: string
  state: string
  cpuPercent: number
  memPercent: number
  time: string
  command: string
}

/**
 * 进程统计
 */
export interface ProcessStats {
  total: number
  running: number
  sleeping: number
  stopped: number
  zombie: number
}

/**
 * 进程列表结果
 */
export interface ProcessListResult {
  stats: ProcessStats
  processes: ProcessInfo[]
}

/**
 * 进程排序字段
 */
export type ProcessSortField = 'pid' | 'cpu' | 'mem' | 'time'

/**
 * 应用筛选类型
 */
export type AppFilterType = 'all' | 'system' | 'thirdParty' | 'running' | 'stopped'

/**
 * 应用信息
 */
export interface AppInfo {
  packageName: string
  appName: string
  version: string
  versionCode: number
  size: number
  installTime: number
  isSystemApp: boolean
  isEnabled: boolean
  isRunning: boolean
  icon?: string
}

/**
 * 应用统计信息
 */
export interface AppStats {
  total: number
  system: number
  thirdParty: number
  running: number
}

/**
 * 应用列表结果
 */
export interface AppListResult {
  stats: AppStats
  apps: AppInfo[]
}

/**
 * 应用快捷方式信息
 */
export interface AppShortcutInfo {
  id: string
  label: string
  labelId: number
  icon: string
  iconId: number
  bundleName: string
  moduleName: string
  isEnables: boolean
  isHomeShortcut: boolean
  isStatic: boolean
  intents: Array<{
    targetBundle: string
    targetClass: string
    targetModule: string
    parameters?: Record<string, any>
  }>
}

/**
 * 应用完整详情
 */
export interface AppFullDetail {
  packageName: string
  versionName: string
  versionCode: number
  installTime: number
  updateTime: number
  firstInstallTime: number
  isSystemApp: boolean
  isEnabled: boolean
  isPreInstallApp: boolean
  isNativeApp: boolean
  vendor: string
  targetVersion: number
  minSdkVersion: number
  uid: number
  gid: number
  codePath: string
  permissions: Array<{
    name: string
    reason?: string
    usedScene?: {
      abilities?: string[]
      when?: string
    }
  }>
  abilities: Array<{
    name: string
    label?: string
    description?: string
    launchType?: string
    supportWindowMode?: string[]
    skills?: Array<{
      actions?: string[]
      entities?: string[]
      uris?: Array<{
        scheme?: string
        host?: string
        path?: string
      }>
    }>
  }>
}

/**
 * 任务信息
 */
export interface MissionInfo {
  missionId: number
  missionName: string
  lockedState: number
  missionAffinity: string
  abilityRecords: Array<{
    abilityRecordId: number
    appName: string
    mainName: string
    bundleName: string
    abilityType: string
    state: string
    startTime: number
    appState: string
    ready: number
    windowAttached: number
    launcher: number
    isKeepAlive: boolean
  }>
}

/**
 * 运行中的应用记录
 */
export interface AppRunningRecord {
  recordId: number
  processName: string
  pid: number
  uid: number
  state: string
  uiExtensionProviders?: Array<{
    pid: number
  }>
  rootCallers?: Array<{
    pid: number
  }>
}

/**
 * 日志级别
 */
export type LogLevel = 'D' | 'I' | 'W' | 'E' | 'F' | 'ALL'

/**
 * 日志条目
 */
export interface LogEntry {
  /** 时间戳（毫秒） */
  timestamp: number
  /** 时间字符串 */
  time: string
  /** PID */
  pid: number
  /** TID */
  tid: number
  /** 级别 */
  level: LogLevel
  /** Tag */
  tag: string
  /** 消息 */
  message: string
  /** 原始日志行 */
  raw: string
}

/**
 * 日志流选项
 */
export interface HilogOptions {
  /** 日志级别过滤 */
  level?: LogLevel
  /** Tag 过滤 (支持多个tag，逗号分隔) */
  tag?: string
  /** Domain 过滤 */
  domain?: string
  /** PID 过滤 (支持多个pid，逗号分隔) */
  pid?: string | number
  /** 正则表达式过滤 */
  regex?: string
}

/**
 * 文件/目录项信息
 */
export interface FileItem {
  /** 名称 */
  name: string
  /** 完整路径 */
  path: string
  /** 是否为目录 */
  isDirectory: boolean
  /** 文件大小（字节），目录为 0 */
  size: number
  /** 修改时间（毫秒时间戳） */
  modifiedTime: number
  /** 权限字符串（如 "drwxr-xr-x"） */
  permissions?: string
}

/**
 * 目录列表结果
 */
export interface DirectoryListResult {
  success: boolean
  items?: FileItem[]
  error?: string
}

/**
 * 文件传输任务状态
 */
export type TransferStatus = 'pending' | 'transferring' | 'completed' | 'failed' | 'paused' | 'cancelled'

/**
 * 文件传输任务
 */
export interface TransferTask {
  id: string
  sourcePath: string
  targetPath: string
  direction: 'push' | 'pull'
  name: string
  isDirectory: boolean
  totalSize: number
  transferredSize: number
  progress: number
  status: TransferStatus
  error?: string
  createdAt: number
}

/**
 * 截图结果信息
 */
export interface ScreenshotInfo {
  /** 本地文件路径 */
  localPath: string
  /** 文件名 */
  fileName: string
  /** 截图时间戳 */
  timestamp: number
  /** 图片宽度 */
  width: number
  /** 图片高度 */
  height: number
  /** 文件大小（字节） */
  size: number
}

/**
 * 截图历史记录项
 */
export interface ScreenshotHistoryItem {
  /** 本地文件路径 */
  localPath: string
  /** 文件名 */
  fileName: string
  /** 截图时间戳 */
  timestamp: number
  /** 文件大小（字节） */
  size: number
}

/**
 * 截图操作结果
 */
export interface ScreenshotResult {
  success: boolean
  data?: ScreenshotInfo
  error?: string
}

/**
 * 投屏状态
 */
export interface ScreenMirrorStatus {
  isStreaming: boolean
  deviceSn: string
}

/**
 * 屏幕尺寸
 */
export interface DisplaySize {
  width: number
  height: number
}

/**
 * 端口转发状态
 */
export interface PortForwardStatus {
  configured: boolean
  localPort: number
  devicePort: number
  status: 'normal' | 'error' | 'not_configured'
  error?: string
}

/**
 * HTTP Extra信息
 */
export interface HttpExtra {
  id: number
  uid: string
  reqTime: number
  respTime: number
  captureSource?: 'OkHTTP' | 'Cronet' | 'GNet' | 'WebView'
  mocked?: boolean
  mockRuleId?: string
  mockRuleName?: string
}

/**
 * 网络请求数据
 */
export interface NetworkRequest {
  id: string
  timestamp: number
  method: string
  url: string
  fullUrl?: string
  statusCode?: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  rawData?: string
  direction: 'request' | 'response' | 'boundary'
  extra?: HttpExtra
  // URL Query Parameters (来自 data.request.params)
  requestParams?: Record<string, unknown>
  // 请求基础 URL (来自 data.request.baseURL)
  baseURL?: string
  // 会话边界标记相关字段
  isSessionBoundary?: boolean
  boundaryType?: string
  clientId?: string
  boundaryMessage?: string
}

/**
 * 抓包状态
 */
export interface CaptureStatus {
  isCapturing: boolean
  requestCount: number
  portForward: PortForwardStatus
}

export type HiProfilerCaptureState =
  | 'idle'
  | 'starting'
  | 'capturing'
  | 'stopping'
  | 'waiting'
  | 'restarting'
  | 'exited'
  | 'error'

export interface HiProfilerCaptureStatus {
  state: HiProfilerCaptureState
  isCapturing: boolean
  deviceId?: string
  pid?: number
  bundleName?: string
  processName?: string
  localPort?: number
  reason?: string
}

/**
 * 连接测试结果
 */
export interface ConnectionTestResult {
  success: boolean
  latency?: number
  error?: string
}

/**
 * 心跳状态
 */
export type HeartbeatStatus = 'healthy' | 'warning' | 'timeout'

/**
 * 客户端心跳信息
 */
export interface ClientHeartbeatInfo {
  deviceId: string
  isConnected: boolean
  timeSinceHeartbeat: number // 距离上次心跳的毫秒数
  heartbeatStatus: HeartbeatStatus
}

/**
 * 会话状态（包含心跳信息）
 */
export interface SessionStatus {
  localPort: number
  devicePort: number
  isRunning: boolean
  requestCount: number
  portForward: PortForwardStatus
  connectedCount: number
  clientCount: number
  heartbeatInfo: ClientHeartbeatInfo[]
}

/**
 * 抓包状态（扩展版，包含会话详情）
 */
export interface CaptureStatusDetail {
  isCapturing: boolean
  requestCount: number
  portForward: PortForwardStatus
  sessions?: SessionStatus[]
}

/**
 * Mock 响应模式
 */
export type MockResponseMode = 'replace' | 'override'

/**
 * Mock 替换规则（覆盖模式使用）
 */
export interface MockReplaceRule {
  id: string
  pattern: string // 查找正则表达式
  replacement: string // 替换内容
}

/**
 * Mock 匹配条件（预留扩展）
 */
export interface MockMatchCondition {
  urlPattern: string // URL正则表达式（必需）
  urlRegex?: boolean // URL匹配是否按正则处理，默认 true 兼容旧规则
  method?: string // HTTP方法（预留）
  queryParams?: Record<string, string> // Query参数（预留）
  headers?: Record<string, string> // Header匹配（预留）
  bodyPattern?: string // Body匹配（预留）
}

/**
 * Mock 响应配置
 */
export interface MockResponseConfig {
  // 替换模式配置
  statusCode?: number
  headers?: Record<string, string>
  body?: string
  
  // 覆盖模式配置
  replaceRules?: MockReplaceRule[]
}

/**
 * Mock 规则
 */
export interface MockRule {
  id: string
  name: string // 规则名称，自动生成（规则1, 规则2...）
  enabled: boolean // 规则是否启用
  matchCondition: MockMatchCondition
  responseMode: MockResponseMode // 响应模式
  responseConfig: MockResponseConfig
}

/**
 * Mock 配置
 */
export interface MockConfig {
  enabled: boolean // Mock功能总开关（当至少有一个规则启用时自动为true）
  rules: MockRule[] // Mock规则列表
}

/**
 * Android 应用信息
 */
export interface AndroidApp {
  packageName: string
  processName: string
  pid: number
  name: string
  debuggable: boolean
}

/**
 * HarmonyOS 可调试应用信息 (HiProfiler)
 */
export interface HarmonyDebuggableApp {
  bundleName: string
  appName: string
  processName: string
  pid: number
}

/**
 * Android 设备信息
 */
export interface AndroidDevice {
  deviceId: string
  model: string
  brand: string
  androidVersion: string
  apiLevel: number
  isDebuggable: boolean
}

/**
 * Android 抓包状态
 */
export interface AndroidCaptureStatus {
  isCapturing: boolean
  waitingForRestart?: boolean
  packageName: string
  processName?: string
  pid?: number
  localPort?: number
  connectedCount?: number
}

/**
 * CPU 频率核心信息
 */
export interface CpuFreqCore {
  core: number
  currentFreq: number // kHz
  maxFreq: number     // kHz
}

/**
 * CPU 频率信息
 */
export interface CpuFreqInfo {
  cores: CpuFreqCore[]
}

/**
 * 进程内存分类
 */
export interface ProcessMemoryCategory {
  name: string     // native heap, ark ts heap, .so ...
  pssTotal: number // kB
}

/**
 * 进程内存详情
 */
export interface ProcessMemoryDetail {
  categories: ProcessMemoryCategory[]
  totalPss: number  // kB
  swapUsed: number  // kB
  heapSize: number  // kB
  heapAlloc: number // kB
  dma: number       // kB
  ashmem: number    // kB
}

/**
 * 故障日志条目
 */
export interface FaultLogEntry {
  time: string
  foreground: boolean
  reason: string
  recordId: string
  processName: string
}

/**
 * 进程 IO 信息
 */
export interface ProcessIOInfo {
  rchar: number
  wchar: number
  syscr: number
  syscw: number
  readBytes: number
  writeBytes: number
  cancelledWriteBytes: number
}

/**
 * IPC 接口统计
 */
export interface IpcInterface {
  callingPid: number
  descriptorCode: string
  count: number
  maxTime: number
  minTime: number
  avgTime: number
}

/**
 * IPC 统计信息
 */
export interface IpcStatInfo {
  totalCount: number
  totalTimeCost: number
  interfaces: IpcInterface[]
}
