import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  captureAppsEqual,
  toSavedCaptureApp,
  type SavedCaptureApp,
} from '@/lib/capture-selected-app'

interface CaptureSelectedAppState {
  /** connectKey → 该设备上次选中的抓包进程（无 PID） */
  byDevice: Record<string, SavedCaptureApp | null>
  setForDevice: (
    connectKey: string,
    app: {
      packageName?: string
      bundleName?: string
      processName?: string
      appName?: string
      name?: string
    } | null
  ) => void
  getForDevice: (connectKey: string) => SavedCaptureApp | null
}

export const useCaptureSelectedAppStore = create<CaptureSelectedAppState>()(
  persist(
    (set, get) => ({
      byDevice: {},

      setForDevice: (connectKey, app) => {
        const key = (connectKey || '').trim()
        if (!key) return
        const saved = toSavedCaptureApp(app)
        set((s) => {
          if (captureAppsEqual(s.byDevice[key] ?? null, saved)) return s
          return { byDevice: { ...s.byDevice, [key]: saved } }
        })
      },

      getForDevice: (connectKey) => {
        const key = (connectKey || '').trim()
        if (!key) return null
        return get().byDevice[key] ?? null
      },
    }),
    {
      name: 'hadice-capture-selected-app',
      partialize: (state) => ({ byDevice: state.byDevice }),
    }
  )
)
