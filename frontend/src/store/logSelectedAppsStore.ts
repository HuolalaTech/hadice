import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SavedLogApp } from '@/lib/log-selected-apps'
import { toSavedLogApps } from '@/lib/log-selected-apps'

interface LogSelectedAppsState {
  /** connectKey → 该设备上次选中的应用（无 PID） */
  byDevice: Record<string, SavedLogApp[]>
  setForDevice: (
    connectKey: string,
    apps: Array<{ packageName: string; appName: string; pid?: number }>
  ) => void
  getForDevice: (connectKey: string) => SavedLogApp[]
}

export const useLogSelectedAppsStore = create<LogSelectedAppsState>()(
  persist(
    (set, get) => ({
      byDevice: {},

      setForDevice: (connectKey, apps) => {
        const key = (connectKey || '').trim()
        if (!key) return
        const saved = toSavedLogApps(apps)
        set((s) => {
          const prev = s.byDevice[key]
          // 避免无意义写入触发 persist
          if (
            prev &&
            prev.length === saved.length &&
            prev.every(
              (p, i) =>
                p.packageName === saved[i].packageName &&
                p.appName === saved[i].appName
            )
          ) {
            return s
          }
          return { byDevice: { ...s.byDevice, [key]: saved } }
        })
      },

      getForDevice: (connectKey) => {
        const key = (connectKey || '').trim()
        if (!key) return []
        return get().byDevice[key] ?? []
      },
    }),
    {
      name: 'hadice-log-selected-apps',
      partialize: (state) => ({ byDevice: state.byDevice }),
    }
  )
)
