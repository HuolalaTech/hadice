import * as App from '../../../bindings/Hadice/backend/appservice'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import type {
  HdcResult,
  ProcessListResult,
  ProcessSortField,
  ProcessInfo,
  ProcessStats
} from '@/types/hdc'

export const processAPI = {
  getProcessList: async (connectKey: string, sortBy?: ProcessSortField, platform?: string): Promise<ProcessListResult> => {
    try {
      const result = await App.GetProcessListByPlatform(connectKey, sortBy || 'mem', platform || 'harmonyos')
      if (!result) {
        return { stats: { total: 0, running: 0, sleeping: 0, stopped: 0, zombie: 0 }, processes: [] }
      }
      return {
        stats: {
          total: result.stats?.total ?? 0,
          running: result.stats?.running ?? 0,
          sleeping: result.stats?.sleeping ?? 0,
          stopped: result.stats?.stopped ?? 0,
          zombie: result.stats?.zombie ?? 0
        },
        processes: (result.processes || []).map((p: any) => ({
          pid: p.pid ?? 0,
          user: p.user ?? '',
          priority: p.priority ?? 0,
          nice: p.nice ?? 0,
          virt: p.virt ?? '',
          res: p.res ?? '',
          shr: p.shr ?? '',
          state: p.state ?? '',
          cpuPercent: typeof p.cpuPercent === 'number' ? p.cpuPercent : 0,
          memPercent: typeof p.memPercent === 'number' ? p.memPercent : 0,
          time: p.time ?? '',
          command: p.command ?? ''
        }))
      }
    } catch (error) {
      console.error('[HDC API] getProcessList failed:', error)
      return { stats: { total: 0, running: 0, sleeping: 0, stopped: 0, zombie: 0 }, processes: [] }
    }
  },

  getProcessListAsync: (connectKey: string, sortBy?: ProcessSortField, platform?: string): void => {
    try {
      App.GetProcessListAsyncByPlatform(connectKey, sortBy || 'mem', platform || 'harmonyos')
    } catch (error) {
      console.error('[HDC API] getProcessListAsync failed:', error)
    }
  },

  onProcessListUpdate: (
    callback: (data: ProcessListResult) => void
  ): (() => void) => {
    const unsubscribeUpdated = EventsOn('process-list-updated', (data: any) => {
      try {
        const result: ProcessListResult = {
          stats: {
            total: data.stats?.total || 0,
            running: data.stats?.running || 0,
            sleeping: data.stats?.sleeping || 0,
            stopped: data.stats?.stopped || 0,
            zombie: data.stats?.zombie || 0
          },
          processes: (data?.processes || []).map((p: any) => ({
            pid: p.pid,
            user: p.user || '',
            priority: p.priority || 0,
            nice: p.nice || 0,
            virt: p.virt || '',
            res: p.res || '',
            shr: p.shr || '',
            state: p.state || '',
            cpuPercent: p.cpuPercent || 0,
            memPercent: p.memPercent || 0,
            time: p.time || '',
            command: p.command || ''
          }))
        }
        callback(result)
      } catch (error) {
        console.error('[HDC API] Failed to parse process list update:', error)
      }
    })

    const unsubscribeError = EventsOn('process-list-error', (data: any) => {
      console.error('[HDC API] Process list error:', data.error)
    })

    return () => {
      unsubscribeUpdated()
      unsubscribeError()
    }
  },

  killProcess: async (connectKey: string, pid: number, force?: boolean, platform?: string): Promise<HdcResult> => {
    try {
      const result = await App.KillProcessByPlatform(connectKey, pid, force || false, platform || 'harmonyos')
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] killProcess failed:', error)
      throw error
    }
  },

  forceStopApp: async (connectKey: string, packageName: string, platform?: string): Promise<HdcResult> => {
    try {
      const result = await App.ForceStopAppByPlatform(connectKey, packageName, platform || 'harmonyos')
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] forceStopApp failed:', error)
      throw error
    }
  },

  getProcessDetail: async (connectKey: string, pid: number, platform?: string): Promise<Record<string, string>> => {
    try {
      return await App.GetProcessDetailByPlatform(connectKey, pid, platform || 'harmonyos')
    } catch (error) {
      console.error('[HDC API] getProcessDetail failed:', error)
      throw error
    }
  }
}