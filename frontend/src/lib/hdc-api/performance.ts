/**
 * 性能监控相关 API
 */

import * as App from '../../../bindings/Hadice/backend/appservice'
import type {
  CpuDetailInfo,
  MemoryDetailInfo,
  NetworkTrafficInfo,
  GraphicsInfo,
  CpuFreqInfo,
  ProcessMemoryDetail,
  FaultLogEntry,
  ProcessIOInfo,
  IpcStatInfo,
  ProcessCpuEntry
} from '@/types/hdc'

/**
 * 性能监控相关 API
 */
export const performanceAPI = {
  getCpuDetailInfo: async (connectKey: string): Promise<CpuDetailInfo> => {
    try {
      const info = await App.GetCpuDetailInfo(connectKey)
      return {
        total: info.total,
        user: info.user,
        kernel: info.kernel,
        idle: info.idle,
        iowait: info.iowait,
        irq: info.irq,
        softirq: 0, // 暂时设为 0，后端未实现
        loadAverage: {
          one: info.loadAverage?.one || 0,
          five: info.loadAverage?.five || 0,
          fifteen: info.loadAverage?.fifteen || 0
        },
        cores: [] // 暂时设为空数组，后端未实现
      }
    } catch (error) {
      console.error('[HDC API] getCpuDetailInfo failed:', error)
      throw error
    }
  },

  getProcessCpuUsage: async (connectKey: string, pid: number): Promise<ProcessCpuEntry[]> => {
    try {
      const entries = await App.GetProcessCpuUsage(connectKey, pid)
      return (entries || []).map((e) => ({
        pid: e.pid,
        totalUsage: e.totalUsage,
        userSpace: e.userSpace,
        kernelSpace: e.kernelSpace,
        name: e.name
      }))
    } catch (error) {
      console.error('[HDC API] getProcessCpuUsage failed:', error)
      throw error
    }
  },

  getMemoryDetailInfo: async (connectKey: string): Promise<MemoryDetailInfo> => {
    try {
      const info = await App.GetMemoryDetailInfo(connectKey)
      return {
        total: info.total,
        used: info.used,
        free: info.free,
        available: info.available,
        cached: info.cached,
        buffers: info.buffers,
        swapTotal: info.swapTotal,
        swapUsed: info.swapUsed,
        swapFree: info.swapFree,
        usedPercent: info.usedPercent
      }
    } catch (error) {
      console.error('[HDC API] getMemoryDetailInfo failed:', error)
      throw error
    }
  },

  getNetworkTrafficInfo: async (connectKey: string): Promise<NetworkTrafficInfo[]> => {
    try {
      const networks = await App.GetNetworkTrafficInfo(connectKey)
      return networks.map(n => ({
        interface: n.interface,
        rxBytes: n.rxBytes,
        txBytes: n.txBytes,
        rxPackets: n.rxPackets,
        txPackets: n.txPackets
      }))
    } catch (error) {
      console.error('[HDC API] getNetworkTrafficInfo failed:', error)
      throw error
    }
  },

  getGraphicsInfo: async (connectKey: string): Promise<GraphicsInfo> => {
    try {
      const info = await App.GetGraphicsInfo(connectKey)
      return {
        gpuVendor: info.gpuVendor,
        gpuRenderer: info.gpuRenderer,
        gpuVersion: info.gpuVersion,
        surfaceMemory: info.surfaceMemory,
        fpsCount: {
          fps60: info.fpsCount?.fps60 || 0,
          fps90: info.fpsCount?.fps90 || 0,
          fps120: info.fpsCount?.fps120 || 0
        },
        currentFps: 0
      }
    } catch (error) {
      console.error('[HDC API] getGraphicsInfo failed:', error)
      throw error
    }
  },

  getGraphicsInfoWithPid: async (connectKey: string, pid: number): Promise<GraphicsInfo> => {
    try {
      const info = await App.GetGraphicsInfoWithPid(connectKey, pid)
      return {
        gpuVendor: info.gpuVendor,
        gpuRenderer: info.gpuRenderer,
        gpuVersion: info.gpuVersion,
        surfaceMemory: info.surfaceMemory,
        fpsCount: {
          fps60: info.fpsCount?.fps60 || 0,
          fps90: info.fpsCount?.fps90 || 0,
          fps120: info.fpsCount?.fps120 || 0
        },
        currentFps: 0
      }
    } catch (error) {
      console.error('[HDC API] getGraphicsInfoWithPid failed:', error)
      throw error
    }
  },

  getUptimeInfo: async (connectKey: string): Promise<{ uptime: string; uptimeDays: number; loadAverage: string }> => {
    try {
      const info = await App.GetUptimeInfo(connectKey)
      return {
        uptime: info.uptime as string || 'Unknown',
        uptimeDays: info.uptimeDays as number || 0,
        loadAverage: info.loadAverage as string || '0, 0, 0'
      }
    } catch (error) {
      console.error('[HDC API] getUptimeInfo failed:', error)
      throw error
    }
  },

  getCpuFreqInfo: async (connectKey: string): Promise<CpuFreqInfo> => {
    try {
      const info = await App.GetCpuFreqInfo(connectKey)
      return {
        cores: (info.cores || []).map((c: { core: number; currentFreq: number; maxFreq: number }) => ({
          core: c.core,
          currentFreq: c.currentFreq,
          maxFreq: c.maxFreq
        }))
      }
    } catch (error) {
      console.error('[HDC API] getCpuFreqInfo failed:', error)
      throw error
    }
  },

  getProcessMemoryDetail: async (connectKey: string, pid: number): Promise<ProcessMemoryDetail> => {
    try {
      const info = await App.GetProcessMemoryDetail(connectKey, pid)
      return {
        categories: (info.categories || []).map((c: { name: string; pssTotal: number }) => ({
          name: c.name,
          pssTotal: c.pssTotal
        })),
        totalPss: info.totalPss || 0,
        swapUsed: info.swapUsed || 0,
        heapSize: info.heapSize || 0,
        heapAlloc: info.heapAlloc || 0,
        dma: info.dma || 0,
        ashmem: info.ashmem || 0
      }
    } catch (error) {
      console.error('[HDC API] getProcessMemoryDetail failed:', error)
      throw error
    }
  },

  getFaultLogList: async (connectKey: string, processName: string, n: number): Promise<FaultLogEntry[]> => {
    try {
      const entries = await App.GetFaultLogList(connectKey, processName, n)
      return (entries || []).map((e: { time: string; foreground: boolean; reason: string; recordId: string; processName: string }) => ({
        time: e.time,
        foreground: e.foreground,
        reason: e.reason,
        recordId: e.recordId,
        processName: e.processName
      }))
    } catch (error) {
      console.error('[HDC API] getFaultLogList failed:', error)
      throw error
    }
  },

  getFaultLogDetail: async (connectKey: string, recordId: string): Promise<string> => {
    try {
      return await App.GetFaultLogDetail(connectKey, recordId) || ''
    } catch (error) {
      console.error('[HDC API] getFaultLogDetail failed:', error)
      throw error
    }
  },

  getProcessIOInfo: async (connectKey: string, pid: number): Promise<ProcessIOInfo> => {
    try {
      const info = await App.GetProcessIOInfo(connectKey, pid)
      return {
        rchar: info.rchar || 0,
        wchar: info.wchar || 0,
        syscr: info.syscr || 0,
        syscw: info.syscw || 0,
        readBytes: info.readBytes || 0,
        writeBytes: info.writeBytes || 0,
        cancelledWriteBytes: info.cancelledWriteBytes || 0
      }
    } catch (error) {
      console.error('[HDC API] getProcessIOInfo failed:', error)
      throw error
    }
  },

  startIpcStat: async (connectKey: string, pid: number): Promise<void> => {
    try {
      await App.StartIpcStat(connectKey, pid)
    } catch (error) {
      console.error('[HDC API] startIpcStat failed:', error)
      throw error
    }
  },

  getIpcStat: async (connectKey: string, pid: number): Promise<IpcStatInfo> => {
    try {
      const info = await App.GetIpcStat(connectKey, pid)
      return {
        totalCount: info.totalCount || 0,
        totalTimeCost: info.totalTimeCost || 0,
        interfaces: (info.interfaces || []).map((i: { callingPid: number; descriptorCode: string; count: number; maxTime: number; minTime: number; avgTime: number }) => ({
          callingPid: i.callingPid,
          descriptorCode: i.descriptorCode,
          count: i.count,
          maxTime: i.maxTime,
          minTime: i.minTime,
          avgTime: i.avgTime
        }))
      }
    } catch (error) {
      console.error('[HDC API] getIpcStat failed:', error)
      throw error
    }
  },

  stopIpcStat: async (connectKey: string, pid: number): Promise<void> => {
    try {
      await App.StopIpcStat(connectKey, pid)
    } catch (error) {
      console.error('[HDC API] stopIpcStat failed:', error)
      throw error
    }
  },

  saveTextFile: async (filename: string, content: string): Promise<string> => {
    try {
      return await App.SaveTextFile(filename, content)
    } catch (error) {
      console.error('[HDC API] saveTextFile failed:', error)
      throw error
    }
  }
}
