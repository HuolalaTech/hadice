/**
 * Renderer 进程日志工具
 * 统一日志格式，便于排查问题
 */

const LOG_PREFIX = '[PerformanceMonitor]'

/**
 * 格式化日志消息
 */
function formatMessage(level: string, message: string, ...args: any[]): string {
  const timestamp = new Date().toISOString()
  const formattedArgs = args.length > 0 
    ? ' ' + args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        }
        return String(arg)
      }).join(' ')
    : ''
  
  return `${timestamp} ${LOG_PREFIX} [${level}] ${message}${formattedArgs}`
}

/**
 * 错误日志
 */
export function logError(message: string, ...args: any[]): void {
  console.error(formatMessage('ERROR', message, ...args))
}

/**
 * 警告日志
 */
export function logWarn(message: string, ...args: any[]): void {
  console.warn(formatMessage('WARN', message, ...args))
}

/**
 * 信息日志
 */
export function logInfo(message: string, ...args: any[]): void {
  console.info(formatMessage('INFO', message, ...args))
}

/**
 * 调试日志（用于详细排查）
 */
export function logDebug(message: string, ...args: any[]): void {
  // 可以通过 localStorage 控制是否输出调试日志
  const debugEnabled = typeof localStorage !== 'undefined' 
    ? localStorage.getItem('PERF_MONITOR_DEBUG') === 'true'
    : true // 默认启用，便于排查内存泄漏
  if (debugEnabled) {
    console.debug(formatMessage('DEBUG', message, ...args))
  }
}

