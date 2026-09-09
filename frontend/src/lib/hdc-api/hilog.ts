/**
 * 系统日志相关 API
 * 支持鸿蒙 Hilog 和安卓 Logcat
 */

import * as App from '../../../bindings/Hadice/backend/appservice'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import type {
  LogEntry,
  HilogOptions
} from '@/types/hdc'

export type LogcatLogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F'

export interface LogcatOptions {
  level?: LogcatLogLevel
  tag?: string
  pid?: string | number
  regex?: string
  format?: string
}

export interface LogcatEntry {
  timestamp: number
  time: string
  pid: number
  tid: number
  level: LogcatLogLevel
  tag: string
  message: string
  raw: string
}

export const hilogAPI = {
  startHilogStream: async (connectKey: string, options?: HilogOptions): Promise<{ success: boolean }> => {
    try {
      const optionsMap: any = {}
      if (options) {
        if (options.level) optionsMap.level = options.level
        if (options.tag) optionsMap.tag = options.tag
        if (options.domain) optionsMap.domain = options.domain
        if (options.pid) {
          optionsMap.pid = typeof options.pid === 'number' ? String(options.pid) : options.pid
        }
        if (options.regex) optionsMap.regex = options.regex
      }
      const result = await App.StartHilogStream(connectKey, optionsMap)
      return { success: result.success }
    } catch (error: any) {
      console.error('[HDC API] startHilogStream failed:', error)
      return { success: false }
    }
  },

  executeHdcCommand: async (connectKey: string, shellCommand: string): Promise<{ success: boolean; output?: string; error?: string }> => {
    try {
      const result = await App.ExecuteHdcCommand(connectKey, shellCommand)
      return result as { success: boolean; output?: string; error?: string }
    } catch (error: any) {
      console.error('[HDC API] executeHdcCommand failed:', error)
      return { success: false, error: error.message }
    }
  },

  stopHilogStream: async (connectKey: string): Promise<{ success: boolean }> => {
    try {
      const result = await App.StopHilogStream(connectKey)
      return { success: result.success }
    } catch (error: any) {
      console.error('[HDC API] stopHilogStream failed:', error)
      return { success: false }
    }
  },

  stopAllHilogStreams: async (): Promise<{ success: boolean }> => {
    try {
      const result = await App.StopAllHilogStreams()
      return { success: result.success }
    } catch (error: any) {
      console.error('[HDC API] stopAllHilogStreams failed:', error)
      return { success: false }
    }
  },

  onHilogLog: (callback: (log: LogEntry) => void): (() => void) => {
    const unsubscribe = EventsOn('hilog:log', (data: any) => {
      if (data && data.entry) {
        callback(data.entry as LogEntry)
      }
    })
    return unsubscribe
  },

  onHilogError: (callback: (error: string) => void): (() => void) => {
    const unsubscribe = EventsOn('hilog:error', (data: any) => {
      if (data && data.error) {
        callback(data.error as string)
      }
    })
    return unsubscribe
  },

  saveLogsToFile: async (logText: string, fileName: string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    try {
      const result = await App.SaveLogsToFile(logText, fileName || `hilog_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
      return {
        success: result.success as boolean,
        filePath: result.filePath as string | undefined,
        error: result.error as string | undefined
      }
    } catch (error: any) {
      console.error('[HDC API] saveLogsToFile failed:', error)
      return { success: false, error: error.message }
    }
  }
}

export const logcatAPI = {
  startLogcatStream: async (deviceId: string, options?: LogcatOptions): Promise<{ success: boolean }> => {
    try {
      const optionsMap: any = {}
      if (options) {
        if (options.level) optionsMap.level = options.level
        if (options.tag) optionsMap.tag = options.tag
        if (options.pid) {
          optionsMap.pid = typeof options.pid === 'number' ? String(options.pid) : options.pid
        }
        if (options.regex) optionsMap.regex = options.regex
        if (options.format) optionsMap.format = options.format
      }
      const result = await App.StartLogcatStream(deviceId, optionsMap)
      return { success: result.success }
    } catch (error: any) {
      console.error('[ADB API] startLogcatStream failed:', error)
      return { success: false }
    }
  },

  stopLogcatStream: async (deviceId: string): Promise<{ success: boolean }> => {
    try {
      const result = await App.StopLogcatStream(deviceId)
      return { success: result.success }
    } catch (error: any) {
      console.error('[ADB API] stopLogcatStream failed:', error)
      return { success: false }
    }
  },

  stopAllLogcatStreams: async (): Promise<{ success: boolean }> => {
    try {
      const result = await App.StopAllLogcatStreams()
      return { success: result.success }
    } catch (error: any) {
      console.error('[ADB API] stopAllLogcatStreams failed:', error)
      return { success: false }
    }
  },

  onLogcatLog: (callback: (log: LogcatEntry) => void): (() => void) => {
    const unsubscribe = EventsOn('logcat:log', (data: any) => {
      if (data && data.entry) {
        callback(data.entry as LogcatEntry)
      }
    })
    return unsubscribe
  },

  onLogcatError: (callback: (error: string) => void): (() => void) => {
    const unsubscribe = EventsOn('logcat:error', (data: any) => {
      if (data && data.error) {
        callback(data.error as string)
      }
    })
    return unsubscribe
  }
}

export const logStreamAPI = {
  startLogStream: async (connectKey: string, platform: string, options?: HilogOptions | LogcatOptions): Promise<{ success: boolean; platform?: string }> => {
    try {
      const optionsMap: any = {}
      if (options) {
        if (options.level) optionsMap.level = options.level
        if (options.tag) optionsMap.tag = options.tag
        if (options.pid) {
          optionsMap.pid = typeof options.pid === 'number' ? String(options.pid) : options.pid
        }
        if (options.regex) optionsMap.regex = options.regex
      }
      const result = await App.StartLogStream(connectKey, platform, optionsMap)
      return { 
        success: result.success as boolean,
        platform: result.platform as string | undefined
      }
    } catch (error: any) {
      console.error('[Log API] startLogStream failed:', error)
      return { success: false }
    }
  },

  stopLogStream: async (connectKey: string, platform: string): Promise<{ success: boolean }> => {
    try {
      const result = await App.StopLogStream(connectKey, platform)
      return { success: result.success as boolean }
    } catch (error: any) {
      console.error('[Log API] stopLogStream failed:', error)
      return { success: false }
    }
  },

  onLog: (callback: (log: LogEntry | LogcatEntry, platform: string) => void): (() => void)[] => {
    const unsubHilog = EventsOn('hilog:log', (data: any) => {
      if (data && data.entry) {
        callback(data.entry as LogEntry, 'harmonyos')
      }
    })
    const unsubLogcat = EventsOn('logcat:log', (data: any) => {
      if (data && data.entry) {
        callback(data.entry as LogcatEntry, 'android')
      }
    })
    return [unsubHilog, unsubLogcat]
  },

  onError: (callback: (error: string, platform: string) => void): (() => void)[] => {
    const unsubHilog = EventsOn('hilog:error', (data: any) => {
      if (data && data.error) {
        callback(data.error as string, 'harmonyos')
      }
    })
    const unsubLogcat = EventsOn('logcat:error', (data: any) => {
      if (data && data.error) {
        callback(data.error as string, 'android')
      }
    })
    return [unsubHilog, unsubLogcat]
  }
}