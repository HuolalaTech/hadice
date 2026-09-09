/**
 * 真实的 HDC API 实现 - 使用 Wails 后端
 * 
 * 此文件已重构为模块化结构，实际实现在 frontend/src/lib/hdc-api/ 目录下
 * 此文件保持向后兼容，重新导出所有 API
 */

// 从模块化结构中导入
export { hdcAPI, type HdcAPI } from './hdc-api/index'

// 为了保持向后兼容，重新导出类型
export type {
  HdcDevice,
  HdcResult,
  DeviceDetailInfo,
  BatteryInfo,
  MemoryInfo,
  StorageInfo,
  CpuUsageInfo,
  NetworkInfo,
  SystemRuntime,
  SystemProperties,
  CpuDetailInfo,
  MemoryDetailInfo,
  NetworkTrafficInfo,
  GraphicsInfo,
  ProcessListResult,
  ProcessSortField,
  AppListResult,
  AppFilterType,
  AppShortcutInfo,
  MissionInfo,
  AppRunningRecord,
  LogEntry,
  HilogOptions,
  DirectoryListResult,
  ScreenshotResult,
  ScreenshotHistoryItem,
  ScreenMirrorStatus,
  DisplaySize,
  PortForwardStatus,
  NetworkRequest,
  CaptureStatus,
  ConnectionTestResult
} from '@/types/hdc'

// 向后兼容说明：
// 此文件现在只是一个重新导出，实际代码已拆分到以下模块中：
// - device.ts: 设备管理相关
// - performance.ts: 性能监控相关
// - process.ts: 进程管理相关
// - screenshot.ts: 截图相关
// - screen-record.ts: 录屏相关
// - app.ts: 应用管理相关
// - hilog.ts: 系统日志相关
// - file-transfer.ts: 文件传输相关
// - shell.ts: Shell终端相关
// - screen-mirror.ts: 屏幕投屏相关
// - network-capture.ts: 网络抓包相关
// - log.ts: 应用日志管理相关
