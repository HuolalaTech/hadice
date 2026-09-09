/**
 * HDC API 统一导出
 * 将各个功能模块的 API 统一导出
 */

import { deviceAPI } from './device'
import { performanceAPI } from './performance'
import { processAPI } from './process'
import { screenshotAPI } from './screenshot'
import { screenRecordAPI } from './screen-record'
import { appAPI } from './app'
import { hilogAPI, logcatAPI, logStreamAPI } from './hilog'
import { fileTransferAPI } from './file-transfer'
import { shellAPI } from './shell'
import { screenMirrorAPI } from './screen-mirror'
import { networkCaptureAPI } from './network-capture'
import { logAPI } from './log'

/**
 * 统一的 HDC API 对象
 */
export const hdcAPI = {
  // 设备管理
  ...deviceAPI,
  
  // 性能监控
  ...performanceAPI,
  
  // 进程管理
  ...processAPI,
  
  // 截图
  ...screenshotAPI,
  
  // 录屏
  ...screenRecordAPI,
  
  // 应用管理
  ...appAPI,
  
  // 系统日志 (Hilog - 鸿蒙)
  ...hilogAPI,
  
  // 安卓日志 (Logcat)
  logcat: logcatAPI,
  
  // 统一日志流
  logStream: logStreamAPI,
  
  // 文件传输
  ...fileTransferAPI,
  
  // Shell 终端
  ...shellAPI,
  
  // 屏幕投屏
  screenMirror: screenMirrorAPI,
  
  // 网络抓包
  networkCapture: networkCaptureAPI,
  
  // 应用日志管理
  ...logAPI
}

export type HdcAPI = typeof hdcAPI
