import { useEffect, useState, useCallback, useRef } from 'react'
import type { LogEntry } from '@/types/hdc'
import { RingBuffer } from '@/lib/ring-buffer'
import { useFilterPipeline } from '@/hooks/useFilterPipeline'
import { useLogViewStore } from '@/store/logViewStore'
import { logStreamAPI, logcatAPI } from '@/lib/hdc-api/hilog'
import { isHdcAvailable } from '@/lib/hdc'
import {
  formatLogLineForTerminal,
  minLevelForBackend,
} from '@/lib/log-level-style'
import {
  entryPassesDisplayFilter,
  type LogDisplayFilter,
} from '@/lib/log-display-filter'
import type { FilterStats } from '@/workers/log-filter.worker'
import type { LogLevel } from '@/types/hdc'

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * 终端最小接口 — 避免直接导入 xterm.js。
 * 由外部页面通过 setTerminal() 注册 xterm.js Terminal 实例。
 */
interface TerminalHandle {
  write(data: string, callback?: () => void): void
  reset(): void
  scrollToBottom(): void
  buffer: {
    active: {
      length: number
    }
  }
}

export interface BackendFilterConfig {
  /** 后端 PID 过滤（变更会重启流） */
  pids: string[]
}

export interface ClientFilterConfig {
  /** 级别过滤（前端过滤，不重启流） */
  levels: string[]
  /** 关键字过滤 */
  keywordFilter: string
  /** 是否使用正则表达式 */
  useRegex: boolean
  /** Tag 过滤 (逗号分隔) */
  tagFilter: string
}

/** 终端回放上限（与列表对齐时取尾部，避免 10 万行卡死） */
const TERMINAL_REPLAY_MAX = 5000
/** 切设备/重开流后：只入 ring、不写终端，过后再限量回放（抗 hilog 历史回灌） */
const STARTUP_INGEST_ONLY_MS = 1200

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
  /**
   * 卸载时是否停止后端 hilog/logcat。
   * 独立窗交接时必须为 false，否则主窗异步 stop 会杀掉独立窗刚拉起的流。
   * 默认 true。
   */
  stopBackendOnUnmount?: boolean
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TERMINAL_SCROLLBACK_MAX = 5000
const TERMINAL_CLEANUP_CHECK_INTERVAL = 200
const WORKER_FLUSH_INTERVAL_MS = 50
const CLIENT_FILTER_DEBOUNCE_MS = 150

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useLogStream(options: UseLogStreamOptions) {
  const {
    deviceKey,
    platform,
    backendFilters,
    clientFilters,
    ringBufferCapacity = 100_000,
    stopBackendOnUnmount = true,
  } = options

  // ponytail: 卸载清理读 ref，避免开独立窗瞬间 props 已变但 effect [] 仍闭包旧值
  const stopBackendOnUnmountRef = useRef(stopBackendOnUnmount)
  stopBackendOnUnmountRef.current = stopBackendOnUnmount
  const deviceKeyRef = useRef(deviceKey)
  deviceKeyRef.current = deviceKey
  const platformRef = useRef(platform)
  platformRef.current = platform

  // ── State ──────────────────────────────────────────────────────────────────
  const [isStreaming, setIsStreaming] = useState(false)
  const [isPausedState, setIsPausedState] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const autoScrollRef = useRef(autoScroll)
  autoScrollRef.current = autoScroll
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
  const pendingStartRef = useRef(false)
  /** 每次 startStream 递增；异步中途被新一轮取代则放弃 */
  const startGenerationRef = useRef(0)
  /** 本 hook 当前拉起的后端流（切设备时必须停旧 key，不能只停新 key） */
  const activeStreamRef = useRef<{ key: string; platform: string } | null>(null)
  /** > now 时只入 ring，不写终端（抗 hilog 历史回灌） */
  const ingestOnlyUntilRef = useRef(0)
  const startupReplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const displayFilterRef = useRef<LogDisplayFilter>({})
  const filteredEntriesRef = useRef<LogEntry[]>([])

  // ── Filter Pipeline ────────────────────────────────────────────────────────
  const { filteredEntries, stats, updateConfig, filterEntries, clearFiltered } =
    useFilterPipeline()
  filteredEntriesRef.current = filteredEntries
  const backendFiltersRef = useRef(backendFilters)
  backendFiltersRef.current = backendFilters

  // ── LogViewStore ────────────────────────────────────────────────────────────
  const dedupEnabled = useLogViewStore((s) => s.dedupEnabled)
  const aggregationEnabled = useLogViewStore((s) => s.aggregationEnabled)
  const hilogRules = useLogViewStore((s) => s.hilogSuppressionRules)
  const logcatRules = useLogViewStore((s) => s.logcatSuppressionRules)
  const suppressionRules = platform === 'harmonyos' ? hilogRules : logcatRules

  displayFilterRef.current = {
    levels: clientFilters.levels ?? [],
    tagFilter: clientFilters.tagFilter,
    keywordFilter: clientFilters.keywordFilter,
    useRegex: clientFilters.useRegex,
    suppressionRules,
  }

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
      // ponytail: xterm.write 异步；scrollToBottom 必须放 callback，否则滚的是旧 buffer
      try {
        terminal.write(batch, () => {
          if (!isMountedRef.current) return
          writeCountRef.current++
          if (writeCountRef.current % TERMINAL_CLEANUP_CHECK_INTERVAL === 0) {
            try {
              if (terminal.buffer.active.length > TERMINAL_SCROLLBACK_MAX) {
                terminal.reset()
                terminal.write(
                  '\x1b[33m[系统] 已清理终端缓冲区以释放内存\x1b[0m\r\n'
                )
                writeCountRef.current = 0
              }
            } catch {
              // buffer 访问可能失败
            }
          }
          if (autoScrollRef.current) {
            try {
              terminal.scrollToBottom()
            } catch {
              // scrollToBottom 可能失败
            }
          }
        })
      } catch {
        // 终端写入失败 (可能已被销毁)
      }
    })
  }, [])

  /**
   * 终端与列表对齐回放。
   * preferListSnapshot：切回终端时用 Worker 快照（与列表所见一致，含去重）。
   * 否则按显示过滤扫 ring（过滤变更时 Worker 尚未返回，避免回放旧快照）。
   */
  const replayTerminalAligned = useCallback(
    (preferListSnapshot = false) => {
      const terminal = terminalRef.current
      if (!terminal) return
      try {
        terminal.reset()
      } catch { /* ignore */ }
      writeBufferRef.current = []

      const matched = preferListSnapshot
        ? filteredEntriesRef.current
        : ringBufferRef.current
            .getEntries()
            .filter((e) =>
              entryPassesDisplayFilter(e, displayFilterRef.current)
            )
      const tail =
        matched.length > TERMINAL_REPLAY_MAX
          ? matched.slice(-TERMINAL_REPLAY_MAX)
          : matched
      if (tail.length === 0) return
      writeBufferRef.current.push(
        ...tail.map((e) => formatLogLineForTerminal(e))
      )
      scheduleRafWrite()
    },
    [scheduleRafWrite]
  )

  const setTerminal = useCallback(
    (terminal: TerminalHandle | null) => {
      terminalRef.current = terminal
      // 列表→终端：xterm 重建后立刻按列表快照回放，避免条数对不上
      if (terminal) {
        requestAnimationFrame(() => {
          if (terminalRef.current === terminal) replayTerminalAligned(true)
        })
      }
    },
    [replayTerminalAligned]
  )

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

      // 1. 写入 Ring Buffer（保留全量，切级别可回放）
      ringBufferRef.current.push(entry)

      // 2. 递增总接收计数
      setTotalReceived((prev) => prev + 1)

      // 3. 如果暂停中，跳过终端输出和 Worker 处理
      if (isPausedRef.current) return

      // 4. 启动爆发期：只入缓冲，不写终端（随后限量回放）
      const ingestOnly = Date.now() < ingestOnlyUntilRef.current

      // 5. 终端与列表同一套显示过滤（级别/Tag/关键字/抑制）
      if (!ingestOnly) {
        const terminal = terminalRef.current
        if (
          terminal &&
          entryPassesDisplayFilter(entry, displayFilterRef.current)
        ) {
          writeBufferRef.current.push(formatLogLineForTerminal(entry))
          scheduleRafWrite()
        }
      }

      // 6. 调度 Worker 批量处理 (50ms 最小间隔)
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

  const stopBackendStream = useCallback(
    async (key: string, plat: string) => {
      if (!key || !isHdcAvailable()) return
      try {
        if (plat === 'harmonyos') {
          await logStreamAPI.stopLogStream(key, plat)
        } else {
          await logcatAPI.stopLogcatStream(key)
        }
      } catch (error) {
        console.warn('[useLogStream] Error stopping stream:', error)
      }
    },
    []
  )

  const stopStream = useCallback(async () => {
    cancelRaf()
    cancelWorkerTimer()
    if (startupReplayTimerRef.current !== null) {
      clearTimeout(startupReplayTimerRef.current)
      startupReplayTimerRef.current = null
    }
    ingestOnlyUntilRef.current = 0

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

    // 停「本 hook 拉起的」流；切设备时 key 已变，必须用 activeStreamRef
    const active = activeStreamRef.current
    activeStreamRef.current = null
    if (active) {
      await stopBackendStream(active.key, active.platform)
    } else {
      const key = deviceKeyRef.current
      const plat = platformRef.current
      if (key) await stopBackendStream(key, plat)
    }

    if (isMountedRef.current) {
      setIsStreaming(false)
    }
  }, [cancelRaf, cancelWorkerTimer, unsubscribeAll, stopBackendStream])

  // ── Clear Logs ─────────────────────────────────────────────────────────────

  const clearLogs = useCallback(() => {
    ringBufferRef.current.clear()
    filteredEntriesRef.current = []
    clearFiltered()
    setTotalReceived(0)
    writeCountRef.current = 0
    writeBufferRef.current = []
    cancelRaf()
    cancelWorkerTimer()
    const terminal = terminalRef.current
    if (terminal) {
      try {
        terminal.reset()
      } catch { /* ignore */ }
    }
  }, [cancelRaf, cancelWorkerTimer, clearFiltered])

  // ── Start Stream (Internal) ────────────────────────────────────────────────

  const startStreamRef = useRef<() => Promise<void>>(async () => {})

  const startStream = useCallback(async () => {
    // 始终读 ref：pending 重入时闭包可能仍是上一台设备
    if (!deviceKeyRef.current || !isHdcAvailable()) return

    // 上一轮还在 stop/delay 时：记一笔，等 finally 用最新 startStreamRef 再开
    if (isStartingRef.current) {
      pendingStartRef.current = true
      startGenerationRef.current++
      return
    }

    const myGen = ++startGenerationRef.current
    isStartingRef.current = true
    pendingStartRef.current = false

    try {
      // 先停旧流并退订（含上一台设备的 activeStreamRef）
      await stopStream()
      clearLogs()
      await new Promise((resolve) => setTimeout(resolve, 300))

      if (myGen !== startGenerationRef.current || !isMountedRef.current) return

      const key = deviceKeyRef.current
      const plat = platformRef.current
      if (!key) return

      setIsStreaming(true)
      setIsPausedState(false)
      isPausedRef.current = false

      // 启动爆发期只入缓冲；后端用最低级别砍掉无关级别的历史回灌
      ingestOnlyUntilRef.current = Date.now() + STARTUP_INGEST_ONLY_MS
      const streamOptions: Record<string, string> = {}
      // 读 ref：切设备/pending 重入时闭包里的 backendFilters 可能仍是上一台的 PID
      const pids = backendFiltersRef.current.pids
      if (pids.length > 0) {
        streamOptions.pid = pids.join(',')
      }
      const minLv = minLevelForBackend(displayFilterRef.current.levels)
      if (minLv) streamOptions.level = minLv

      const acceptKey = (eventKey?: string) =>
        !eventKey || eventKey === deviceKeyRef.current

      // ponytail: 必须先 EventsOn 再 Start——独立窗若先开流，事件洪水会堵满
      // Wails 每窗 64 深队列，hilog 管道背压后表现为「进程在跑、界面空白」。
      if (plat === 'harmonyos') {
        const logUnsubs = logStreamAPI.onLog((logEntry, logPlatform, eventKey) => {
          if (
            logPlatform === 'harmonyos' &&
            acceptKey(eventKey) &&
            isMountedRef.current
          ) {
            handleEntry(logEntry as LogEntry)
          }
        })
        unsubscribesRef.current.push(...logUnsubs)
        const errUnsubs = logStreamAPI.onError((error, errPlatform, eventKey) => {
          if (
            errPlatform === 'harmonyos' &&
            acceptKey(eventKey) &&
            isMountedRef.current
          ) {
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

        const result = await logStreamAPI.startLogStream(key, plat, streamOptions)
        if (myGen !== startGenerationRef.current) {
          await stopBackendStream(key, plat)
          unsubscribeAll()
          return
        }
        if (!result.success) {
          console.error('[useLogStream] Failed to start hilog stream')
          unsubscribeAll()
          if (isMountedRef.current) setIsStreaming(false)
          return
        }
      } else {
        const logUnsubs = logStreamAPI.onLog((logEntry, logPlatform, eventKey) => {
          if (
            logPlatform === 'android' &&
            acceptKey(eventKey) &&
            isMountedRef.current
          ) {
            handleEntry(logEntry as LogEntry)
          }
        })
        unsubscribesRef.current.push(...logUnsubs)
        const errUnsubs = logStreamAPI.onError((error, errPlatform, eventKey) => {
          if (
            errPlatform === 'android' &&
            acceptKey(eventKey) &&
            isMountedRef.current
          ) {
            console.error('[useLogStream] Logcat error:', error)
            const term = terminalRef.current
            if (term) {
              try {
                term.write(`\x1b[31m[ERROR] ${error}\x1b[0m\r\n`)
              } catch { /* ignore */ }
            }
          }
        })
        unsubscribesRef.current.push(...errUnsubs)

        const result = await logcatAPI.startLogcatStream(key, streamOptions)
        if (myGen !== startGenerationRef.current) {
          await stopBackendStream(key, plat)
          unsubscribeAll()
          return
        }
        if (!result.success) {
          console.error('[useLogStream] Failed to start logcat stream')
          unsubscribeAll()
          if (isMountedRef.current) setIsStreaming(false)
          return
        }
      }

      activeStreamRef.current = { key, platform: plat }

      const term = terminalRef.current
      if (term) {
        try {
          const label = plat === 'harmonyos' ? 'Hilog' : 'Logcat'
          term.write(`\x1b[32m[系统] ${label} 已连接 ${key}\x1b[0m\r\n`)
        } catch { /* ignore */ }
      }

      if (startupReplayTimerRef.current !== null) {
        clearTimeout(startupReplayTimerRef.current)
      }
      startupReplayTimerRef.current = setTimeout(() => {
        startupReplayTimerRef.current = null
        if (myGen !== startGenerationRef.current || !isMountedRef.current) return
        ingestOnlyUntilRef.current = 0
        replayTerminalAligned()
      }, STARTUP_INGEST_ONLY_MS)
    } catch (error) {
      console.error('[useLogStream] Error starting stream:', error)
      if (isMountedRef.current) setIsStreaming(false)
    } finally {
      isStartingRef.current = false
      if (pendingStartRef.current && isMountedRef.current) {
        pendingStartRef.current = false
        void startStreamRef.current()
      }
    }
  }, [
    handleEntry,
    stopStream,
    stopBackendStream,
    clearLogs,
    unsubscribeAll,
    replayTerminalAligned,
  ])

  startStreamRef.current = startStream

  // ── Pause / Resume ─────────────────────────────────────────────────────────

  const pause = useCallback(() => {
    isPausedRef.current = true
    setIsPausedState(true)
    cancelRaf()
    cancelWorkerTimer()
    unsubscribeAll()

    const active = activeStreamRef.current
    activeStreamRef.current = null
    if (active) {
      void stopBackendStream(active.key, active.platform)
    }

    setIsStreaming(false)
  }, [cancelRaf, cancelWorkerTimer, unsubscribeAll, stopBackendStream])

  const resume = useCallback(() => {
    isPausedRef.current = false
    setIsPausedState(false)
    startStream()
  }, [startStream])

  // ── Sync Noise Config to Worker + 终端对齐回放 ─────────────────────────────

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
    filterEntries(ringBufferRef.current.getEntries())
    replayTerminalAligned(false)
  }, [
    dedupEnabled,
    aggregationEnabled,
    suppressionRules,
    updateConfig,
    filterEntries,
    replayTerminalAligned,
  ])

  // ── Client Filter Change → Worker 重过滤 + 终端对齐回放（不重启流）──────────

  const levelsKey = (clientFilters.levels ?? []).join(',')

  useEffect(() => {
    if (clientDebounceRef.current !== null) {
      clearTimeout(clientDebounceRef.current)
    }

    clientDebounceRef.current = setTimeout(() => {
      clientDebounceRef.current = null
      if (!isMountedRef.current) return

      updateConfig({
        levelFilter: (clientFilters.levels ?? []) as LogLevel[],
        keywordFilter: clientFilters.keywordFilter,
        useRegex: clientFilters.useRegex,
        tagFilter: clientFilters.tagFilter,
      })

      filterEntries(ringBufferRef.current.getEntries())
      // Worker 异步；终端先按显示过滤回放，与列表最终结果基本一致
      replayTerminalAligned()
    }, CLIENT_FILTER_DEBOUNCE_MS)

    return () => {
      if (clientDebounceRef.current !== null) {
        clearTimeout(clientDebounceRef.current)
        clientDebounceRef.current = null
      }
    }
  }, [
    levelsKey,
    clientFilters.keywordFilter,
    clientFilters.useRegex,
    clientFilters.tagFilter,
    clientFilters.levels,
    updateConfig,
    filterEntries,
    replayTerminalAligned,
  ])

  // ── Backend PID 变更 → 清屏并重启流 ─────────────────────────────────────────

  const pidsKey = backendFilters.pids.join(',')
  const prevPidsRef = useRef(pidsKey)

  useEffect(() => {
    const pidsChanged = pidsKey !== prevPidsRef.current
    prevPidsRef.current = pidsKey

    if (!isStreaming || isPausedState) return
    if (!pidsChanged) return

    startStream()
  }, [pidsKey, isStreaming, isPausedState, startStream])

  // ── Cleanup on Unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      startGenerationRef.current++

      // 取消所有定时器
      cancelRaf()
      cancelWorkerTimer()
      if (clientDebounceRef.current !== null) {
        clearTimeout(clientDebounceRef.current)
        clientDebounceRef.current = null
      }
      if (startupReplayTimerRef.current !== null) {
        clearTimeout(startupReplayTimerRef.current)
        startupReplayTimerRef.current = null
      }

      // 取消所有事件订阅
      unsubscribeAll()

      // 独立窗交接：主窗卸页不得 Stop，否则异步 stop 会杀独立窗新流
      if (!stopBackendOnUnmountRef.current) return
      const active = activeStreamRef.current
      activeStreamRef.current = null
      if (active && isHdcAvailable()) {
        if (active.platform === 'harmonyos') {
          logStreamAPI.stopLogStream(active.key, active.platform).catch(() => {})
        } else {
          logcatAPI.stopLogcatStream(active.key).catch(() => {})
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
