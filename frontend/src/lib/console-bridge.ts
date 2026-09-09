/**
 * Console 日志桥接
 * 将前端的 console 日志转发到 Go 后端，以便在终端中查看
 */

import { LogPrint, LogDebug, LogInfo, LogWarning, LogError } from '../../wailsjs/runtime/runtime'

// 保存原始的 console 方法
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
  trace: console.trace
}

/**
 * 格式化参数为字符串
 */
function formatArgs(args: any[]): string {
  return args.map(arg => {
    if (arg === null) {
      return 'null'
    }
    if (arg === undefined) {
      return 'undefined'
    }
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2)
      } catch {
        return String(arg)
      }
    }
    return String(arg)
  }).join(' ')
}

/**
 * 初始化 Console 日志桥接
 */
export function initConsoleBridge(): void {
  // 重定向 console.log/info -> LogInfo
  console.log = (...args: any[]) => {
    const message = formatArgs(args)
    try {
      LogInfo(`[Frontend] ${message}`)
    } catch {
      // 如果 Wails runtime 不可用，使用原始 console
      originalConsole.log(...args)
    }
    // 同时保留原始输出（浏览器控制台）
    originalConsole.log(...args)
  }

  console.info = (...args: any[]) => {
    const message = formatArgs(args)
    try {
      LogInfo(`[Frontend] ${message}`)
    } catch {
      originalConsole.info(...args)
    }
    originalConsole.info(...args)
  }

  // 重定向 console.warn -> LogWarning
  console.warn = (...args: any[]) => {
    const message = formatArgs(args)
    try {
      LogWarning(`[Frontend] ${message}`)
    } catch {
      originalConsole.warn(...args)
    }
    originalConsole.warn(...args)
  }

  // 重定向 console.error -> LogError
  console.error = (...args: any[]) => {
    const message = formatArgs(args)
    try {
      LogError(`[Frontend] ${message}`)
    } catch {
      originalConsole.error(...args)
    }
    originalConsole.error(...args)
  }

  // 重定向 console.debug -> LogDebug
  console.debug = (...args: any[]) => {
    const message = formatArgs(args)
    try {
      LogDebug(`[Frontend] ${message}`)
    } catch {
      originalConsole.debug(...args)
    }
    originalConsole.debug(...args)
  }

  // console.trace 保持原样，但也会发送到后端
  console.trace = (...args: any[]) => {
    const message = formatArgs(args)
    try {
      LogDebug(`[Frontend] TRACE: ${message}`)
    } catch {
      originalConsole.trace(...args)
    }
    originalConsole.trace(...args)
  }
}

