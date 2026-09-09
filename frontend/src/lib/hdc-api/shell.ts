/**
 * Shell 终端相关 API
 */

import * as App from '../../../bindings/Hadice/backend/appservice'
import { EventsOn } from '../../../wailsjs/runtime/runtime'

/**
 * Shell 终端相关 API
 */
export const shellAPI = {
  startShell: async (shellId: string): Promise<boolean> => {
    try {
      return await App.StartShell(shellId)
    } catch (error) {
      console.error('[HDC API] startShell failed:', error)
      throw error
    }
  },

  writeToShell: async (shellId: string, data: string): Promise<{ success: boolean }> => {
    try {
      await App.WriteToShell(shellId, data)
      return { success: true }
    } catch (error) {
      console.error('[HDC API] writeToShell failed:', error)
      return { success: false }
    }
  },

  resizeShell: async (shellId: string, cols: number, rows: number): Promise<{ success: boolean }> => {
    try {
      await App.ResizeShell(shellId, cols, rows)
      return { success: true }
    } catch (error) {
      console.error('[HDC API] resizeShell failed:', error)
      return { success: false }
    }
  },

  stopShell: async (shellId: string): Promise<{ success: boolean }> => {
    try {
      await App.StopShell(shellId)
      return { success: true }
    } catch (error) {
      console.error('[HDC API] stopShell failed:', error)
      return { success: false }
    }
  },

  stopAllShells: async (): Promise<{ success: boolean }> => {
    try {
      await App.StopAllShells()
      return { success: true }
    } catch (error) {
      console.error('[HDC API] stopAllShells failed:', error)
      return { success: false }
    }
  },

  onShellStdout: (shellId: string, callback: (data: string) => void): (() => void) => {
    const eventName = `shell:stdout:${shellId}`
    return EventsOn(eventName, callback)
  },

  onShellStderr: (_shellId: string, _callback: (data: string) => void): (() => void) => {
    // PTY 将 stdout 和 stderr 合并，使用 stdout 事件
    console.log('[HDC API] onShellStderr - PTY merges stderr with stdout, use onShellStdout instead')
    return () => {}
  },

  onShellExit: (shellId: string, callback: (data: { code: number | null; signal: string | null }) => void): (() => void) => {
    const eventName = `shell:exit:${shellId}`
    return EventsOn(eventName, callback)
  },

  onShellError: (_shellId: string, _callback: (error: string) => void): (() => void) => {
    // 错误通过 exit 事件传递
    console.log('[HDC API] onShellError - Errors are passed through exit event')
    return () => {}
  }
}
