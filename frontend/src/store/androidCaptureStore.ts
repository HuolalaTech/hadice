import { create } from 'zustand'
import type { AndroidApp, AndroidCaptureStatus } from '@/types/hdc'

const idleCaptureStatus: AndroidCaptureStatus = {
  isCapturing: false,
  packageName: '',
  processName: ''
}

interface AndroidCaptureSession {
  selectedApp: AndroidApp | null
  captureStatus: AndroidCaptureStatus
}

type StateUpdater<T> = T | ((current: T) => T)

interface AndroidCaptureStore {
  sessions: Map<string, AndroidCaptureSession>
  initializeSession: (deviceId: string) => void
  setSelectedApp: (deviceId: string, app: StateUpdater<AndroidApp | null>) => void
  setCaptureStatus: (deviceId: string, status: StateUpdater<AndroidCaptureStatus>) => void
}

function resolveState<T>(value: StateUpdater<T>, current: T): T {
  return typeof value === 'function'
    ? (value as (current: T) => T)(current)
    : value
}

/**
 * Android 抓包页特有的会话状态。
 *
 * 菜单导航会卸载页面组件，但 Android 抓包服务仍在后台运行；因此按设备
 * 保存当前进程和状态，回到页面时不会把按钮和进程选择框重置为初始值。
 */
export const useAndroidCaptureStore = create<AndroidCaptureStore>((set, get) => ({
  sessions: new Map(),

  initializeSession: (deviceId) => {
    if (get().sessions.has(deviceId)) return

    const sessions = new Map(get().sessions)
    sessions.set(deviceId, {
      selectedApp: null,
      captureStatus: { ...idleCaptureStatus }
    })
    set({ sessions })
  },

  setSelectedApp: (deviceId, app) => {
    const current = get().sessions.get(deviceId) || {
      selectedApp: null,
      captureStatus: { ...idleCaptureStatus }
    }
    const sessions = new Map(get().sessions)
    sessions.set(deviceId, {
      ...current,
      selectedApp: resolveState(app, current.selectedApp)
    })
    set({ sessions })
  },

  setCaptureStatus: (deviceId, status) => {
    const current = get().sessions.get(deviceId) || {
      selectedApp: null,
      captureStatus: { ...idleCaptureStatus }
    }
    const sessions = new Map(get().sessions)
    sessions.set(deviceId, {
      ...current,
      captureStatus: resolveState(status, current.captureStatus)
    })
    set({ sessions })
  }
}))

export const useAndroidCaptureSession = (deviceId: string | null): AndroidCaptureSession | null => {
  return useAndroidCaptureStore((state) => {
    if (!deviceId) return null
    return state.sessions.get(deviceId) || null
  })
}
