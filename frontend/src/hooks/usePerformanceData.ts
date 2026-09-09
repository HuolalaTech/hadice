import { useEffect, useState, useRef, useCallback } from 'react'
import { useDeviceStore } from '@/store/deviceStore'
import { logError, logInfo, logDebug } from '@/lib/logger'
import { isAndroidDevice } from '@/lib/hdc'
import type {
  CpuDetailInfo,
  MemoryDetailInfo,
  NetworkTrafficInfo,
  BatteryInfo,
  StorageInfo,
  GraphicsInfo,
  CpuFreqInfo,
  ProcessMemoryDetail,
  FaultLogEntry,
  ProcessIOInfo,
  IpcStatInfo
} from '@/types/hdc'

import { isHdcAvailable } from '@/lib/hdc'
import { processAPI } from '@/lib/hdc-api/process'

/**
 * 进程级性能数据历史记录
 */
export interface ProcessPerformanceEntry {
  time: string
  timestamp: number
  processes: Record<number, {
    command: string
    cpuPercent: number
    cpuUser: number
    cpuKernel: number
    memPercent: number
    memMB: number
  }>
}

/**
 * 进程颜色色板（最多支持 10 个进程）
 */
export const PROCESS_COLORS = [
  '#f97316', '#22c55e', '#3b82f6', '#ef4444', '#a855f7',
  '#14b8a6', '#f59e0b', '#ec4899', '#6366f1', '#84cc16'
]

/**
 * 性能数据历史记录
 */
export interface PerformanceHistory {
  time: string
  timestamp: number
  cpuTotal: number
  cpuUser: number
  cpuKernel: number
  memUsed: number
  memTotal: number
  memPercent: number
  swapUsed: number
  batteryCapacity: number
  batteryTemperature: number
  networkRx: number
  networkTx: number
  fps: number
}

/**
 * CPU 频率历史记录
 */
export interface CpuFreqHistory {
  time: string
  timestamp: number
  bigCore: number   // MHz 大核均值
  midCore: number   // MHz 中核均值
  littleCore: number // MHz 小核均值
}

/**
 * 进程内存分类历史记录
 */
export interface ProcessMemoryHistory {
  time: string
  timestamp: number
  categories: Record<string, number> // name -> pssTotal MB
  totalPss: number // MB
}

/**
 * 进程 IO 历史记录
 */
export interface ProcessIOHistory {
  time: string
  timestamp: number
  readRate: number    // bytes/s
  writeRate: number   // bytes/s
  readTotal: number   // bytes 累计
  writeTotal: number  // bytes 累计
}

/**
 * IPC 历史记录
 */
export interface IpcHistory {
  time: string
  timestamp: number
  callCount: number   // 增量调用次数
  avgTimeCost: number // 平均耗时 μs
}

/**
 * 内存分类颜色色板
 */
export const MEMORY_CATEGORY_COLORS: Record<string, string> = {
  'native heap': '#f97316',
  'ark ts heap': '#06b6d4',
  '.so': '#3b82f6',
  '.hap': '#a855f7',
  'Graph': '#22c55e',
  'GL': '#8b5cf6',
  'AnonPage other': '#f59e0b',
  'FilePage other': '#6b7280',
  'stack': '#ec4899',
  '.ttf': '#14b8a6',
  '.db': '#6366f1',
  'dev': '#84cc16',
  // Android memory categories
  'Java Heap': '#06b6d4',
  'Dalvik Heap': '#0891b2',
  'Native Heap': '#f97316',
  'Dalvik Other': '#a855f7',
  'Code': '#3b82f6',
  'Graphics': '#22c55e',
  'Private Other': '#f59e0b',
  'System': '#6b7280',
  'Ashmem': '#ef4444',
  'EGL mtrack': '#8b5cf6',
  'GL mtrack': '#6366f1',
  'Unknown': '#84cc16'
}

/**
 * 性能数据 Hook
 */
export function usePerformanceData(
  refreshInterval: number,
  isPaused: boolean,
  maxHistory: number = 60,
  selectedPids: number[] = [],
  onProcessKilled?: () => void
) {
  const { selectedDevice } = useDeviceStore()
  const isAndroid = isAndroidDevice(selectedDevice?.platform)

  // 当前数据
  const [cpuInfo, setCpuInfo] = useState<CpuDetailInfo | null>(null)
  const [memoryInfo, setMemoryInfo] = useState<MemoryDetailInfo | null>(null)
  const [batteryInfo, setBatteryInfo] = useState<BatteryInfo | null>(null)
  const [networkTraffic, setNetworkTraffic] = useState<NetworkTrafficInfo[]>([])
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
  const [graphicsInfo, setGraphicsInfo] = useState<GraphicsInfo | null>(null)
  const [uptime, setUptime] = useState({ uptime: '', uptimeDays: 0, loadAverage: '' })
  const [history, setHistory] = useState<PerformanceHistory[]>([])

  // 进程级数据
  const [processHistory, setProcessHistory] = useState<ProcessPerformanceEntry[]>([])
  const processHistoryRef = useRef<ProcessPerformanceEntry[]>([])
  const selectedPidsRef = useRef<number[]>(selectedPids)
  selectedPidsRef.current = selectedPids

  // 上一次网络数据和FPS数据（用于计算速率）
  const prevNetworkRef = useRef<{
    data: Array<{ interface: string; rxBytes: number; txBytes: number }>
    timestamp: number
  } | null>(null)
  const prevFpsRef = useRef<{ total: number; timestamp: number } | null>(null)
  const [networkSpeed, setNetworkSpeed] = useState({ rx: 0, tx: 0 })
  const [currentFps, setCurrentFps] = useState(0)

  // 使用 useRef 存储历史记录，避免频繁创建新数组
  const historyRef = useRef<PerformanceHistory[]>([])
  const componentMountedRef = useRef(true)
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null)
  const renderCountRef = useRef<number>(0)
  const lastMemoryCheckRef = useRef<number>(0)

  // 新增数据状态
  const [cpuFreqInfo, setCpuFreqInfo] = useState<CpuFreqInfo | null>(null)
  const [cpuFreqHistory, setCpuFreqHistory] = useState<CpuFreqHistory[]>([])
  const cpuFreqHistoryRef = useRef<CpuFreqHistory[]>([])

  const [faultLogs, setFaultLogs] = useState<FaultLogEntry[]>([])
  const lastFaultLogFetchRef = useRef<number>(0)

  const [processMemoryDetail, setProcessMemoryDetail] = useState<ProcessMemoryDetail | null>(null)
  const [processMemoryHistory, setProcessMemoryHistory] = useState<ProcessMemoryHistory[]>([])
  const processMemoryHistoryRef = useRef<ProcessMemoryHistory[]>([])

  const [processIOInfo, setProcessIOInfo] = useState<ProcessIOInfo | null>(null)
  const [processIOHistory, setProcessIOHistory] = useState<ProcessIOHistory[]>([])
  const processIOHistoryRef = useRef<ProcessIOHistory[]>([])
  const prevIORef = useRef<{ readBytes: number; writeBytes: number; timestamp: number } | null>(null)

  const [ipcStatInfo, setIpcStatInfo] = useState<IpcStatInfo | null>(null)
  const [ipcHistory, setIpcHistory] = useState<IpcHistory[]>([])
  const ipcHistoryRef = useRef<IpcHistory[]>([])
  const ipcStatStartedRef = useRef<number>(0) // 正在采集 IPC 的 PID
  const prevIpcRef = useRef<{ totalCount: number; timestamp: number } | null>(null)

  // 获取内存使用情况（如果可用）
  const getMemoryInfo = useCallback(() => {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const mem = (performance as any).memory
      return {
        used: Math.round(mem.usedJSHeapSize / 1048576), // MB
        total: Math.round(mem.totalJSHeapSize / 1048576), // MB
        limit: Math.round(mem.jsHeapSizeLimit / 1048576) // MB
      }
    }
    return null
  }, [])

  // 记录内存信息（带上下文）- 使用 ref 避免依赖链
  const logMemoryInfoRef = useRef<((context: string, extra?: Record<string, any>) => void) | null>(null)
  logMemoryInfoRef.current = (context: string, extra?: Record<string, any>) => {
    const memInfo = getMemoryInfo()
    const info: Record<string, any> = {
      context,
      renderCount: renderCountRef.current,
      historyLength: historyRef.current.length,
      hasInterval: intervalIdRef.current !== null,
      ...extra
    }
    if (memInfo) {
      info.memory = memInfo
    }
    logDebug('内存状态', info)
  }

  // 设备切换时重置历史记录
  useEffect(() => {
    logInfo('设备切换，重置历史记录', {
      deviceKey: selectedDevice?.connectKey,
      historyLength: historyRef.current.length
    })
    if (logMemoryInfoRef.current) {
      logMemoryInfoRef.current('设备切换前')
    }
    historyRef.current = []
    setHistory([])
    processHistoryRef.current = []
    setProcessHistory([])
    cpuFreqHistoryRef.current = []
    setCpuFreqHistory([])
    processMemoryHistoryRef.current = []
    setProcessMemoryHistory([])
    processIOHistoryRef.current = []
    setProcessIOHistory([])
    ipcHistoryRef.current = []
    setIpcHistory([])
    prevNetworkRef.current = null
    prevFpsRef.current = null
    prevIORef.current = null
    prevIpcRef.current = null
    ipcStatStartedRef.current = 0
    if (logMemoryInfoRef.current) {
      logMemoryInfoRef.current('设备切换后')
    }
  }, [selectedDevice?.connectKey])

  // selectedPids 从非空变为空时清空进程历史
  useEffect(() => {
    if (selectedPids.length === 0 && processHistoryRef.current.length > 0) {
      processHistoryRef.current = []
      setProcessHistory([])
    }
  }, [selectedPids.length])

  // 组件卸载时清理资源
  useEffect(() => {
    componentMountedRef.current = true
    renderCountRef.current = 0
    logInfo('组件挂载')
    if (logMemoryInfoRef.current) {
      logMemoryInfoRef.current('组件挂载时')
    }

    return () => {
      logInfo('组件卸载，清理资源', {
        totalRenders: renderCountRef.current
      })
      if (logMemoryInfoRef.current) {
        logMemoryInfoRef.current('组件卸载前')
      }

      componentMountedRef.current = false

      // 清理数据获取定时器
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current)
        intervalIdRef.current = null
      }

      // 清理 ref 引用，帮助垃圾回收
      prevNetworkRef.current = null
      prevFpsRef.current = null
      historyRef.current = []

      if (logMemoryInfoRef.current) {
        logMemoryInfoRef.current('组件卸载后（已清理）')
      }
    }
  }, [])

  // 定时刷新
  useEffect(() => {
    if (!selectedDevice || isPaused) {
      return
    }

    let isCancelled = false

    // 获取性能数据的函数
    const fetchPerformanceData = async () => {
      if (!selectedDevice || !isHdcAvailable() || isPaused || isCancelled) {
        return
      }

      const connectKey = selectedDevice.connectKey

      // 时间戳（提前计算，供后续使用）
      const now = Date.now()
      const timeStr = new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })

      try {
        // 并行获取所有数据
        const firstPid = selectedPidsRef.current.length > 0 ? selectedPidsRef.current[0] : 0
        const graphicsPromise = isAndroid && firstPid > 0
          ? window.hdc.getGraphicsInfoWithPid(connectKey, firstPid)
          : window.hdc.getGraphicsInfo(connectKey)
        const [cpu, memory, battery, network, storage, graphics, uptimeData, cpuFreq] = await Promise.all([
          window.hdc.getCpuDetailInfo(connectKey),
          window.hdc.getMemoryDetailInfo(connectKey),
          window.hdc.getBatteryInfo(connectKey),
          window.hdc.getNetworkTrafficInfo(connectKey),
          window.hdc.getStorageInfo(connectKey),
          graphicsPromise,
          window.hdc.getUptimeInfo(connectKey),
          window.hdc.getCpuFreqInfo(connectKey)
        ])

        if (isCancelled) {
          return
        }

        setCpuInfo(cpu)
        setMemoryInfo(memory)
        setBatteryInfo(battery)
        setNetworkTraffic(network)
        setStorageInfo(storage)
        setGraphicsInfo(graphics)
        setUptime(uptimeData)

        // 处理 CPU 频率数据
        if (!isCancelled && cpuFreq && cpuFreq.cores && cpuFreq.cores.length > 0) {
          setCpuFreqInfo(cpuFreq)
          // 按 3 组聚合: 大核(cpu10+), 中核(cpu4-9), 小核(cpu0-3)
          let bigSum = 0, bigCount = 0, midSum = 0, midCount = 0, littleSum = 0, littleCount = 0
          for (const core of cpuFreq.cores) {
            if (core.core >= 10) { bigSum += core.currentFreq; bigCount++ }
            else if (core.core >= 4) { midSum += core.currentFreq; midCount++ }
            else { littleSum += core.currentFreq; littleCount++ }
          }
          const freqEntry: CpuFreqHistory = {
            time: timeStr,
            timestamp: now,
            bigCore: bigCount > 0 ? Math.round(bigSum / bigCount / 1000) : 0,
            midCore: midCount > 0 ? Math.round(midSum / midCount / 1000) : 0,
            littleCore: littleCount > 0 ? Math.round(littleSum / littleCount / 1000) : 0
          }
          if (cpuFreqHistoryRef.current.length >= maxHistory) cpuFreqHistoryRef.current.shift()
          cpuFreqHistoryRef.current.push(freqEntry)
          setCpuFreqHistory([...cpuFreqHistoryRef.current])
        }

        // 获取崩溃日志（每 30 秒刷新一次）
        if (!isCancelled && now - lastFaultLogFetchRef.current > 30000) {
          lastFaultLogFetchRef.current = now
          const processName = selectedPidsRef.current.length > 0
            ? '' // 暂时不按进程过滤，后续可从进程列表获取进程名
            : ''
          window.hdc.getFaultLogList(connectKey, processName, 30).then(logs => {
            if (!isCancelled) setFaultLogs(logs)
          }).catch(() => {})
        }

        // 进程级新增数据
        const currentPids = selectedPidsRef.current
        if (currentPids.length > 0) {
          const firstPid = currentPids[0]

          // 进程内存详情
          try {
            const memDetail = await window.hdc.getProcessMemoryDetail(connectKey, firstPid)
            if (!isCancelled && memDetail) {
              setProcessMemoryDetail(memDetail)
              const catMB: Record<string, number> = {}
              for (const cat of memDetail.categories) {
                catMB[cat.name] = Math.round(cat.pssTotal / 1024 * 10) / 10
              }
              const memHistoryEntry: ProcessMemoryHistory = {
                time: timeStr, timestamp: now, categories: catMB,
                totalPss: Math.round(memDetail.totalPss / 1024)
              }
              if (processMemoryHistoryRef.current.length >= maxHistory) processMemoryHistoryRef.current.shift()
              processMemoryHistoryRef.current.push(memHistoryEntry)
              setProcessMemoryHistory([...processMemoryHistoryRef.current])
            }
          } catch (err) { logDebug('获取进程内存详情失败', err) }

          // 进程 IO
          try {
            const ioInfo = await window.hdc.getProcessIOInfo(connectKey, firstPid)
            if (!isCancelled && ioInfo) {
              setProcessIOInfo(ioInfo)
              let readRate = 0, writeRate = 0
              if (prevIORef.current) {
                const dt = (now - prevIORef.current.timestamp) / 1000
                if (dt > 0) {
                  readRate = Math.max(0, (ioInfo.readBytes - prevIORef.current.readBytes) / dt)
                  writeRate = Math.max(0, (ioInfo.writeBytes - prevIORef.current.writeBytes) / dt)
                }
              }
              prevIORef.current = { readBytes: ioInfo.readBytes, writeBytes: ioInfo.writeBytes, timestamp: now }
              const ioEntry: ProcessIOHistory = {
                time: timeStr, timestamp: now, readRate, writeRate,
                readTotal: ioInfo.readBytes, writeTotal: ioInfo.writeBytes
              }
              if (processIOHistoryRef.current.length >= maxHistory) processIOHistoryRef.current.shift()
              processIOHistoryRef.current.push(ioEntry)
              setProcessIOHistory([...processIOHistoryRef.current])
            }
          } catch (err) { logDebug('获取进程IO失败', err) }

          // IPC 统计（仅鸿蒙，安卓无对应功能）
          if (!isAndroid) {
            try {
              // 如果 IPC 采集未开始或 PID 变了，重新开始
              if (ipcStatStartedRef.current !== firstPid) {
                if (ipcStatStartedRef.current > 0) {
                  try { await window.hdc.stopIpcStat(connectKey, ipcStatStartedRef.current) } catch {}
                }
                await window.hdc.startIpcStat(connectKey, firstPid)
                ipcStatStartedRef.current = firstPid
                prevIpcRef.current = null
              }
              const ipcStat = await window.hdc.getIpcStat(connectKey, firstPid)
              if (!isCancelled && ipcStat) {
                setIpcStatInfo(ipcStat)
                let callCountDelta = 0
                if (prevIpcRef.current) {
                  callCountDelta = Math.max(0, ipcStat.totalCount - prevIpcRef.current.totalCount)
                }
                prevIpcRef.current = { totalCount: ipcStat.totalCount, timestamp: now }
                const ipcEntry: IpcHistory = {
                  time: timeStr, timestamp: now,
                  callCount: callCountDelta,
                  avgTimeCost: ipcStat.totalCount > 0 ? Math.round(ipcStat.totalTimeCost / ipcStat.totalCount) : 0
                }
                if (ipcHistoryRef.current.length >= maxHistory) ipcHistoryRef.current.shift()
                ipcHistoryRef.current.push(ipcEntry)
                setIpcHistory([...ipcHistoryRef.current])
              }
            } catch (err) { logDebug('获取IPC统计失败', err) }
          }
        } else {
          // 未选中进程时，清理进程级数据
          if (ipcStatStartedRef.current > 0) {
            try { await window.hdc.stopIpcStat(connectKey, ipcStatStartedRef.current) } catch {}
            ipcStatStartedRef.current = 0
            prevIpcRef.current = null
          }
        }

        // 计算网络速率
        let rxSpeed = 0
        let txSpeed = 0

        if (prevNetworkRef.current && network.length > 0) {
          const timeDiff = (now - prevNetworkRef.current.timestamp) / 1000
          if (timeDiff > 0) {
            let totalRxDiff = 0
            let totalTxDiff = 0

            for (const net of network) {
              const prev = prevNetworkRef.current.data.find((p) => p.interface === net.interface)
              if (prev) {
                totalRxDiff += net.rxBytes - prev.rxBytes
                totalTxDiff += net.txBytes - prev.txBytes
              }
            }

            rxSpeed = Math.max(0, totalRxDiff / timeDiff)
            txSpeed = Math.max(0, totalTxDiff / timeDiff)
            if (!isCancelled) {
              setNetworkSpeed({ rx: rxSpeed, tx: txSpeed })
            }
          }
        }
        // 优化：只存储必要的数据，减少内存占用
        prevNetworkRef.current = {
          data: network.map((n) => ({
            interface: n.interface,
            rxBytes: n.rxBytes,
            txBytes: n.txBytes
          })),
          timestamp: now
        }

        // 计算当前 FPS（基于总帧数差值）
        let fps = 0
        const totalFrames =
          (graphics.fpsCount.fps60 || 0) +
          (graphics.fpsCount.fps90 || 0) +
          (graphics.fpsCount.fps120 || 0)

        if (prevFpsRef.current) {
          const timeDiff = (now - prevFpsRef.current.timestamp) / 1000
          if (timeDiff > 0) {
            const frameDiff = totalFrames - prevFpsRef.current.total
            fps = Math.max(0, Math.round(frameDiff / timeDiff))
          }
        }
        prevFpsRef.current = { total: totalFrames, timestamp: now }
        if (!isCancelled) {
          setCurrentFps(fps)
        }

        // 添加历史记录
        const newEntry: PerformanceHistory = {
          time: timeStr,
          timestamp: now,
          cpuTotal: cpu.total,
          cpuUser: cpu.user,
          cpuKernel: cpu.kernel,
          memUsed: memory.used,
          memTotal: memory.total,
          memPercent: memory.usedPercent,
          swapUsed: memory.swapUsed,
          batteryCapacity: battery.capacity,
          batteryTemperature: battery.temperature,
          networkRx: rxSpeed,
          networkTx: txSpeed,
          fps: fps
        }

        // 优化：直接操作 ref，然后创建新数组更新状态，避免多次 slice 操作
        if (!isCancelled) {
          const beforeLength = historyRef.current.length

          // 如果已达到最大长度，先移除第一个元素再添加，避免数组无限增长
          if (historyRef.current.length >= maxHistory) {
            historyRef.current.shift()
          }
          historyRef.current.push(newEntry)

          // 创建新数组引用，触发 React 更新
          setHistory([...historyRef.current])

          // 获取进程级 CPU 数据（使用 hidumper --cpuusage）+ 进程存活检测
          const currentPids = selectedPidsRef.current
          if (currentPids.length > 0) {
            try {
              const cpuEntries = await window.hdc.getProcessCpuUsage(connectKey, 0)
              if (!isCancelled && cpuEntries) {
                // 检测进程是否存活
                const alivePids = new Set(cpuEntries.map((e: { pid: number }) => e.pid))
                const deadPids = currentPids.filter(pid => !alivePids.has(pid))

                if (deadPids.length > 0) {
                  // 进程已死亡：写入零数据并触发暂停
                  const lastProcessEntry = processHistoryRef.current[processHistoryRef.current.length - 1]
                  const zeroProcessData: Record<number, { command: string; cpuPercent: number; cpuUser: number; cpuKernel: number; memPercent: number; memMB: number }> = {}
                  for (const pid of currentPids) {
                    const lastData = lastProcessEntry?.processes[pid]
                    zeroProcessData[pid] = { command: lastData?.command || `PID:${pid}`, cpuPercent: 0, cpuUser: 0, cpuKernel: 0, memPercent: 0, memMB: 0 }
                  }
                  if (processHistoryRef.current.length >= maxHistory) processHistoryRef.current.shift()
                  processHistoryRef.current.push({ time: timeStr, timestamp: now, processes: zeroProcessData })
                  setProcessHistory([...processHistoryRef.current])

                  // 内存零数据
                  if (processMemoryHistoryRef.current.length > 0) {
                    if (processMemoryHistoryRef.current.length >= maxHistory) processMemoryHistoryRef.current.shift()
                    processMemoryHistoryRef.current.push({ time: timeStr, timestamp: now, categories: {}, totalPss: 0 })
                    setProcessMemoryHistory([...processMemoryHistoryRef.current])
                  }

                  // IO 零数据
                  if (processIOHistoryRef.current.length > 0) {
                    if (processIOHistoryRef.current.length >= maxHistory) processIOHistoryRef.current.shift()
                    processIOHistoryRef.current.push({ time: timeStr, timestamp: now, readRate: 0, writeRate: 0, readTotal: 0, writeTotal: 0 })
                    setProcessIOHistory([...processIOHistoryRef.current])
                  }

                  // IPC 零数据
                  if (ipcHistoryRef.current.length > 0) {
                    if (ipcHistoryRef.current.length >= maxHistory) ipcHistoryRef.current.shift()
                    ipcHistoryRef.current.push({ time: timeStr, timestamp: now, callCount: 0, avgTimeCost: 0 })
                    setIpcHistory([...ipcHistoryRef.current])
                  }

                  // 停止 IPC 采集
                  if (ipcStatStartedRef.current > 0) {
                    try { await window.hdc.stopIpcStat(connectKey, ipcStatStartedRef.current) } catch {}
                    ipcStatStartedRef.current = 0
                  }

                  logInfo('检测到进程已死亡，自动暂停监控', { deadPids })
                  onProcessKilled?.()
                  return
                }

                // 进程存活，正常写入数据
                const processData: Record<number, { command: string; cpuPercent: number; cpuUser: number; cpuKernel: number; memPercent: number; memMB: number }> = {}
                for (const pid of currentPids) {
                  const entry = cpuEntries.find((e: { pid: number; totalUsage: number; userSpace: number; kernelSpace: number; name: string }) => e.pid === pid)
                  if (entry) {
                    processData[pid] = {
                      command: entry.name,
                      cpuPercent: Math.round(entry.totalUsage * 10) / 10,
                      cpuUser: Math.round(entry.userSpace * 10) / 10,
                      cpuKernel: Math.round(entry.kernelSpace * 10) / 10,
                      memPercent: 0,
                      memMB: 0
                    }
                  } else {
                    const lastEntry = processHistoryRef.current[processHistoryRef.current.length - 1]
                    const lastData = lastEntry?.processes[pid]
                    processData[pid] = lastData || { command: `PID:${pid}`, cpuPercent: 0, cpuUser: 0, cpuKernel: 0, memPercent: 0, memMB: 0 }
                  }
                }

                const processEntry: ProcessPerformanceEntry = {
                  time: timeStr,
                  timestamp: now,
                  processes: processData
                }

                if (processHistoryRef.current.length >= maxHistory) {
                  processHistoryRef.current.shift()
                }
                processHistoryRef.current.push(processEntry)
                setProcessHistory([...processHistoryRef.current])
              }
            } catch (err) {
              logDebug('获取进程CPU数据失败', err)
            }
          }

          // 每10次更新或达到上限时记录内存信息
          if (
            historyRef.current.length % 10 === 0 ||
            now - lastMemoryCheckRef.current > 30000
          ) {
            if (logMemoryInfoRef.current) {
              logMemoryInfoRef.current('历史记录更新', {
                beforeLength,
                afterLength: historyRef.current.length,
                isMaxReached: historyRef.current.length >= maxHistory
              })
            }
            lastMemoryCheckRef.current = now
          }
        }
      } catch (error) {
        if (!isCancelled) {
          logError('Failed to fetch data', error)
        }
      }
    }

    // 立即获取一次
    fetchPerformanceData()

    // 清理之前的定时器（如果存在）
    if (intervalIdRef.current) {
      logInfo('清理旧的定时器', { oldIntervalId: intervalIdRef.current })
      if (logMemoryInfoRef.current) {
        logMemoryInfoRef.current('清理旧定时器前')
      }
      clearInterval(intervalIdRef.current)
      intervalIdRef.current = null
      if (logMemoryInfoRef.current) {
        logMemoryInfoRef.current('清理旧定时器后')
      }
    }

    const interval = setInterval(() => {
      fetchPerformanceData()
    }, refreshInterval)
    intervalIdRef.current = interval

    logInfo('创建定时器', {
      intervalId: interval,
      interval: refreshInterval,
      deviceKey: selectedDevice.connectKey
    })
    if (logMemoryInfoRef.current) {
      logMemoryInfoRef.current('创建定时器后')
    }

    return () => {
      isCancelled = true
      if (logMemoryInfoRef.current) {
        logMemoryInfoRef.current('定时器清理前')
      }
      if (intervalIdRef.current === interval) {
        clearInterval(interval)
        intervalIdRef.current = null
        logInfo('定时器已清理', {
          intervalId: interval
        })
        if (logMemoryInfoRef.current) {
          logMemoryInfoRef.current('定时器清理后')
        }
      } else {
        // 警告：定时器 ID 不匹配，可能已泄漏
        if (logMemoryInfoRef.current) {
          logMemoryInfoRef.current('定时器泄漏警告')
        }
      }
    }
  }, [selectedDevice, refreshInterval, isPaused, maxHistory])

  return {
    cpuInfo,
    memoryInfo,
    batteryInfo,
    networkTraffic,
    storageInfo,
    graphicsInfo,
    uptime,
    history,
    networkSpeed,
    currentFps,
    processHistory,
    cpuFreqInfo,
    cpuFreqHistory,
    faultLogs,
    processMemoryDetail,
    processMemoryHistory,
    processIOInfo,
    processIOHistory,
    ipcStatInfo,
    ipcHistory
  }
}

