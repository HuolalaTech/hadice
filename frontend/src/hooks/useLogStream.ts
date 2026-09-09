import { useEffect, useState, useCallback, useRef } from 'react'
import type { LogEntry } from '@/types/hdc'
import { RingBuffer } from '@/lib/ring-buffer'
import { useFilterPipeline } from '@/hooks/useFilterPipeline'
import { useLogViewStore } from '@/store/logViewStore'
import { logStreamAPI, logcatAPI } from '@/lib/hdc-api/hilog'
import { isHdcAvailable } from '@/lib/hdc'
import type { FilterStats } from '@/workers/log-filter.worker'

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * 终端最小接口 — 避免直接导入 xterm.js。
 * 由外部页面通过 setTerminal() 注册 xterm.js Terminal 实例。
 */
interface TerminalHandle {
  write(data: string): void
  reset(): void
  scrollToBottom(): void
  buffer: {
    active: {
      length: number
    }
  }
}

export interface BackendFilterConfig {
  /** 后端日志级别过滤 (如 ['I', 'W', 'E']) */
  levels: string[]
  /** 后端 PID 过滤 */
  pids: string[]
}

export interface ClientFilterConfig {
  /** 关键字过滤 */
  keywordFilter: string
  /** 是否使用正则表达式 */
  useRegex: boolean
  /** Tag 过滤 (逗号分隔) */
  tagFilter: string
}

export interface UseLogStreamOptions {
  /** 设备连接 key */
  deviceKey: string | null
  /** 平台: harmonyos 或 android */
  platform: 'harmonyos' | 'android'
  /** 后端过滤器 — 变更会触发流重启 */
  backendFilters: BackendFilterConfig
  /** 客户端过滤器 — 变更仅触发 Worker 重过滤 */
  clientFilters: ClientFilterConfig
  /** Ring Buffer 容量，默认 100,000 */
  ringBufferCapacity?: number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TERMINAL_SCROLLBACK_MAX = 5000
const TERMINAL_CLEANUP_CHECK_INTERVAL = 200
const WORKER_FLUSH_INTERVAL_MS = 50
const CLIENT_FILTER_DEBOUNCE_MS = 150

/** 日志级别对应的 ANSI 颜色 */
const LEVEL_COLORS: Record<string, string> = {
  D: '\x1b[36m', // cyan
  I: '\x1b[32m', // green
  W: '\x1b[33m', // yellow
  E: '\x1b[31m', // red
  F: '\x1b[35m', // magenta
  V: '\x1b[37m', // white
}
const ANSI_RESET = '\x1b[0m'

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useLogStream(options: UseLogStreamOptions) {
  const {
    deviceKey,
    platform,
    backendFilters,
    clientFilters,
    ringBufferCapacity = 100_000,
  } = options

  // ── State ──────────────────────────────────────────────────────────────────
  const [isStreaming, setIsStreaming] = useState(false)
  const [isPausedState, setIsPausedState] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [totalReceived, setTotalReceived] = useState(0)

  // ── Refs ───────────────────────────────────────────────────────────────────
  const terminalRef = useRef<TerminalHandle | null>(null)
  const ringBufferRef = useRef(new RingBuffer<LogEntry>(ringBufferCapacity))
  const isMountedRef = useRef(true)
  const unsubscribesRef = useRef<Array<() => void>>([])
  const rAFIdRef = useRef<number | null>(null)
  const writeBufferRef = useRef<string[]>([])
  const writeCountRef = useRef(0)
  const workerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPausedRef = useRef(false)
  const clientDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isStartingRef = useRef(false)

  // ── Filter Pipeline ────────────────────────────────────────────────────────
  const { filteredEntries, stats, updateConfig, filterEntries } = useFilterPipeline()

  // ── LogViewStore ────────────────────────────────────────────────────────────
  const dedupEnabled = useLogViewStore((s) => s.dedupEnabled)
  const aggregationEnabled = useLogViewStore((s) => s.aggregationEnabled)
  const hilogRules = useLogViewStore((s) => s.hilogSuppressionRules)
  const logcatRules = useLogViewStore((s) => s.logcatSuppressionRules)
  const suppressionRules = platform === 'harmonyos' ? hilogRules : logcatRules

  // ── Terminal Registration ──────────────────────────────────────────────────

  const setTerminal = useCallback((terminal: TerminalHandle | null) => {
    terminalRef.current = terminal
  }, [])

  // ── rAF Terminal Write Batching ────────────────────────────────────────────

  const cancelRaf = useCallback(() => {
    if (rAFIdRef.current !== null) {
      cancelAnimationFrame(rAFIdRef.current)
      rAFIdRef.current = null
    }
  }, [])

  const scheduleRafWrite = useCallback(() => {
    if (rAFIdRef.current !== null) return // 已有待处理的 rAF
    rAFIdRef.current = requestAnimationFrame(() => {
      rAFIdRef.current = null
      const terminal = terminalRef.current
      if (!terminal || !isMountedRef.current) return
      if (writeBufferRef.current.length === 0) return

      const batch = writeBufferRef.current.join('')
      writeBufferRef.current = []
      try {
        terminal.write(batch)
      } catch {
        // 终端写入失败 (可能已被销毁)
        return
      }

      writeCountRef.current++

      // 每 200 次写入检查终端回滚缓冲区
      if (writeCountRef.current % TERMINAL_CLEANUP_CHECK_INTERVAL === 0) {
        try {
          if (terminal.buffer.active.length > TERMINAL_SCROLLBACK_MAX) {
            terminal.reset()
            terminal.write('\x1b[33m[系统] 已清理终端缓冲区以释放内存\x1b[0m\r\n')
            writeCountRef.current = 0
          }
        } catch {
          // buffer 访问可能失败
        }
      }

      if (autoScroll) {
        try {
          terminal.scrollToBottom()
        } catch {
          // scrollToBottom 可能失败
        }
      }
    })
  }, [autoScroll])

  // ── Worker Timer ───────────────────────────────────────────────────────────

  const cancelWorkerTimer = useCallback(() => {
    if (workerTimerRef.current !== null) {
      clearTimeout(workerTimerRef.current)
      workerTimerRef.current = null
    }
  }, [])

  /** 将 Ring Buffer 中全部条目发送给 Worker 进行过滤 */
  const flushToWorker = useCallback(() => {
    if (!isMountedRef.current) return
    const entries = ringBufferRef.current.getEntries()
    if (entries.length > 0) {
      filterEntries(entries)
    }
  }, [filterEntries])

  // ── Handle Entry ───────────────────────────────────────────────────────────

  const handleEntry = useCallback(
    (entry: LogEntry) => {
      if (!isMountedRef.current) return

      // 1. 写入 Ring Buffer
      ringBufferRef.current.push(entry)

      // 2. 递增总接收计数
      setTotalReceived((prev) => prev + 1)

      // 3. 如果暂停中，跳过终端输出和 Worker 处理
      if (isPausedRef.current) return

      // 4. 通过 rAF 批量写入终端
      const terminal = terminalRef.current
      if (terminal) {
        if (entry.raw) {
          writeBufferRef.current.push(entry.raw + '\r\n')
        } else {
          const color = LEVEL_COLORS[entry.level] || '\x1b[37m'
          let line = `${entry.time} ${color}[${entry.level}]${ANSI_RESET} ${entry.tag}`
          if (entry.pid) line += ` (${entry.pid})`
          if (entry.message) line += ` ${entry.message}`
          line += '\r\n'
          writeBufferRef.current.push(line)
        }
        scheduleRafWrite()
      }

      // 5. 调度 Worker 批量处理 (50ms 最小间隔)
      if (!workerTimerRef.current) {
        workerTimerRef.current = setTimeout(() => {
          workerTimerRef.current = null
          flushToWorker()
        }, WORKER_FLUSH_INTERVAL_MS)
      }
    },
    [scheduleRafWrite, flushToWorker]
  )

  // ── Unsubscribe ────────────────────────────────────────────────────────────

  const unsubscribeAll = useCallback(() => {
    unsubscribesRef.current.forEach((fn) => {
      try {
        fn()
      } catch {
        // 忽略取消订阅错误
      }
    })
    unsubscribesRef.current = []
  }, [])

  // ── Stop Stream ────────────────────────────────────────────────────────────

  const stopStream = useCallback(async () => {
    cancelRaf()
    cancelWorkerTimer()

    // 刷新终端写缓冲
    const terminal = terminalRef.current
    if (terminal && writeBufferRef.current.length > 0) {
      try {
        terminal.write(writeBufferRef.current.join(''))
      } catch {
        // 忽略
      }
      writeBufferRef.current = []
    }

    // 取消所有事件订阅
    unsubscribeAll()

    // 停止后端流
    if (deviceKey && isHdcAvailable()) {
      try {
        if (platform === 'harmonyos') {
          await logStreamAPI.stopLogStream(deviceKey, platform)
        } else {
          await logcatAPI.stopLogcatStream(deviceKey)
        }
      } catch (error) {
        console.warn('[useLogStream] Error stopping stream:', error)
      }
    }

    if (isMountedRef.current) {
      setIsStreaming(false)
    }
  }, [deviceKey, platform, cancelRaf, cancelWorkerTimer, unsubscribeAll])

  // ── Start Stream (Internal) ────────────────────────────────────────────────

  const startStream = useCallback(async () => {
    if (!deviceKey || !isHdcAvailable() || isStartingRef.current) return

    isStartingRef.current = true

    try {
      // 先停止已有流
      await stopStream()

      // 等待 300ms 确保后端清理完成
      await new Promise((resolve) => setTimeout(resolve, 300))

      if (!isMountedRef.current) {
        isStartingRef.current = false
        return
      }

      setIsStreaming(true)
      setIsPausedState(false)
      isPausedRef.current = false

      // 构建后端过滤器选项
      const streamOptions: Record<string, string> = {}
      if (backendFilters.levels.length > 0) {
        streamOptions.level = backendFilters.levels.join(',')
      }
      if (backendFilters.pids.length > 0) {
        streamOptions.pid = backendFilters.pids.join(',')
      }

      // 启动后端日志流
      if (platform === 'harmonyos') {
        const result = await logStreamAPI.startLogStream(deviceKey, platform, streamOptions)
        if (!result.success) {
          console.error('[useLogStream] Failed to start hilog stream')
          if (isMountedRef.current) setIsStreaming(false)
          isStartingRef.current = false
          return
        }

        // 订阅日志事件
        const logUnsubs = logStreamAPI.onLog((logEntry, logPlatform) => {
          if (logPlatform === platform && isMountedRef.current) {
            handleEntry(logEntry as LogEntry)
          }
        })
        unsubscribesRef.current.push(...logUnsubs)

        // 订阅错误事件
        const errUnsubs = logStreamAPI.onError((error, errPlatform) => {
          if (errPlatform === platform && isMountedRef.current) {
            console.error('[useLogStream] Stream error:', error)
            const term = terminalRef.current
            if (term) {
              try {
                term.write(`\x1b[31m[ERROR] ${error}\x1b[0m\r\n`)
              } catch { /* ignore */ }
            }
          }
        })
        unsubscribesRef.current.push(...errUnsubs)
      } else {
        // Android Logcat
        const result = await logcatAPI.startLogcatStream(deviceKey, streamOptions)
        if (!result.success) {
          console.error('[useLogStream] Failed to start logcat stream')
          if (isMountedRef.current) setIsStreaming(false)
          isStartingRef.current = false
          return
        }

        const unsubLog = logcatAPI.onLogcatLog((entry) => {
          if (isMountedRef.current) {
            handleEntry(entry as LogEntry)
          }
        })
        unsubscribesRef.current.push(unsubLog)

        const unsubErr = logcatAPI.onLogcatError((error) => {
          if (isMountedRef.current) {
            console.error('[useLogStream] Logcat error:', error)
            const term = terminalRef.current
            if (term) {
              try {
                term.write(`\x1b[31m[ERROR] ${error}\x1b[0m\r\n`)
              } catch { /* ignore */ }
            }
          }
        })
        unsubscribesRef.current.push(unsubErr)
      }
    } catch (error) {
      console.error('[useLogStream] Error starting stream:', error)
      if (isMountedRef.current) setIsStreaming(false)
    } finally {
      isStartingRef.current = false
    }
  }, [deviceKey, platform, backendFilters, handleEntry, stopStream])

  // ── Pause / Resume ─────────────────────────────────────────────────────────

  const pause = useCallback(() => {
    isPausedRef.current = true
    setIsPausedState(true)
    cancelRaf()
    cancelWorkerTimer()
    unsubscribeAll()

    // 停止后端流以节省资源
    if (deviceKey && isHdcAvailable()) {
      if (platform === 'harmonyos') {
        logStreamAPI.stopLogStream(deviceKey, platform).catch(() => {})
      } else {
        logcatAPI.stopLogcatStream(deviceKey).catch(() => {})
      }
    }

    setIsStreaming(false)
  }, [deviceKey, platform, cancelRaf, cancelWorkerTimer, unsubscribeAll])

  const resume = useCallback(() => {
    isPausedRef.current = false
    setIsPausedState(false)
    startStream()
  }, [startStream])

  // ── Clear Logs ─────────────────────────────────────────────────────────────

  const clearLogs = useCallback(() => {
    ringBufferRef.current.clear()
    setTotalReceived(0)
    writeCountRef.current = 0
    cancelRaf()
    cancelWorkerTimer()
    const terminal = terminalRef.current
    if (terminal) {
      try {
        terminal.reset()
      } catch { /* ignore */ }
    }
  }, [cancelRaf, cancelWorkerTimer])

  // ── Sync Noise Config to Worker ────────────────────────────────────────────

  useEffect(() => {
    updateConfig({
      dedupEnabled,
      aggregationEnabled,
      suppressionRules: suppressionRules.map((r) => ({
        id: r.id,
        tag: r.tag,
        level: r.level,
        enabled: r.enabled,
      })),
    })
  }, [dedupEnabled, aggregationEnabled, suppressionRules, updateConfig])

  // ── Client Filter Change → Worker Re-filter (150ms debounce) ───────────────

  useEffect(() => {
    // 清除之前的 debounce 定时器
    if (clientDebounceRef.current !== null) {
      clearTimeout(clientDebounceRef.current)
    }

    clientDebounceRef.current = setTimeout(() => {
      clientDebounceRef.current = null
      if (!isMountedRef.current) return

      updateConfig({
        keywordFilter: clientFilters.keywordFilter,
        useRegex: clientFilters.useRegex,
        tagFilter: clientFilters.tagFilter,
      })

      // 使用 Ring Buffer 全部条目进行重新过滤
      filterEntries(ringBufferRef.current.getEntries())
    }, CLIENT_FILTER_DEBOUNCE_MS)

    return () => {
      if (clientDebounceRef.current !== null) {
        clearTimeout(clientDebounceRef.current)
        clientDebounceRef.current = null
      }
    }
  }, [
    clientFilters.keywordFilter,
    clientFilters.useRegex,
    clientFilters.tagFilter,
    updateConfig,
    filterEntries,
  ])

  // ── Backend Filter Change → Stream Restart ────────────────────────────────

  const levelsKey = backendFilters.levels.join(',')
  const pidsKey = backendFilters.pids.join(',')

  const prevLevelsRef = useRef(levelsKey)
  const prevPidsRef = useRef(pidsKey)

  useEffect(() => {
    const levelsChanged = levelsKey !== prevLevelsRef.current
    const pidsChanged = pidsKey !== prevPidsRef.current

    prevLevelsRef.current = levelsKey
    prevPidsRef.current = pidsKey

    // 仅在活跃流且未暂停时重启
    if (!isStreaming || isPausedState) return
    if (!levelsChanged && !pidsChanged) return

    startStream()
  }, [levelsKey, pidsKey, isStreaming, isPausedState, startStream])

  // ── Cleanup on Unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false

      // 取消所有定时器
      cancelRaf()
      cancelWorkerTimer()
      if (clientDebounceRef.current !== null) {
        clearTimeout(clientDebounceRef.current)
        clientDebounceRef.current = null
      }

      // 取消所有事件订阅
      unsubscribeAll()

      // 停止后端流
      if (deviceKey && isHdcAvailable()) {
        if (platform === 'harmonyos') {
          logStreamAPI.stopLogStream(deviceKey, platform).catch(() => {})
        } else {
          logcatAPI.stopLogcatStream(deviceKey).catch(() => {})
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    /** 是否正在接收日志流 */
    isStreaming,
    /** 是否已暂停 */
    isPaused: isPausedState,
    /** 是否自动滚动到底部 */
    autoScroll,
    /** 设置是否自动滚动 */
    setAutoScroll,
    /** 总共接收的日志条目数 */
    totalReceived,
    /** Worker 过滤后的日志条目 (用于列表视图) */
    filteredEntries,
    /** Worker 过滤统计信息 */
    stats,
    /** 注册外部 xterm.js Terminal 实例 */
    setTerminal,
    /** 启动日志流 */
    startStream,
    /** 停止日志流 */
    stopStream,
    /** 暂停日志流 (停止后端) */
    pause,
    /** 恢复日志流 (重启后端) */
    resume,
    /** 清空所有日志和终端 */
    clearLogs,
  }
}
