import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LogLevel } from '@/types/hdc'

export type ViewMode = 'terminal' | 'list'

export interface SuppressionRule {
  id: string
  tag: string
  level?: LogLevel
  enabled: boolean
}

interface LogViewState {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  toggleViewMode: () => void

  hilogSuppressionRules: SuppressionRule[]
  logcatSuppressionRules: SuppressionRule[]
  addSuppressionRule: (platform: 'harmonyos' | 'android', rule: SuppressionRule) => void
  removeSuppressionRule: (platform: 'harmonyos' | 'android', ruleId: string) => void
  toggleSuppressionRule: (platform: 'harmonyos' | 'android', ruleId: string) => void

  dedupEnabled: boolean
  setDedupEnabled: (enabled: boolean) => void
  aggregationEnabled: boolean
  setAggregationEnabled: (enabled: boolean) => void
}

/**
 * 日志视图 Store
 * 管理日志显示模式、过滤规则和噪声抑制配置
 * 使用 localStorage 持久化用户偏好
 */
export const useLogViewStore = create<LogViewState>()(
  persist(
    (set) => ({
      viewMode: 'terminal',
      setViewMode: (mode) => set({ viewMode: mode }),
      toggleViewMode: () =>
        set((s) => ({ viewMode: s.viewMode === 'terminal' ? 'list' : 'terminal' })),

      hilogSuppressionRules: [],
      logcatSuppressionRules: [],
      addSuppressionRule: (platform, rule) =>
        set((s) =>
          platform === 'harmonyos'
            ? { hilogSuppressionRules: [...s.hilogSuppressionRules, rule] }
            : { logcatSuppressionRules: [...s.logcatSuppressionRules, rule] }
        ),
      removeSuppressionRule: (platform, ruleId) =>
        set((s) =>
          platform === 'harmonyos'
            ? {
                hilogSuppressionRules: s.hilogSuppressionRules.filter(
                  (r) => r.id !== ruleId
                ),
              }
            : {
                logcatSuppressionRules: s.logcatSuppressionRules.filter(
                  (r) => r.id !== ruleId
                ),
              }
        ),
      toggleSuppressionRule: (platform, ruleId) =>
        set((s) =>
          platform === 'harmonyos'
            ? {
                hilogSuppressionRules: s.hilogSuppressionRules.map((r) =>
                  r.id === ruleId ? { ...r, enabled: !r.enabled } : r
                ),
              }
            : {
                logcatSuppressionRules: s.logcatSuppressionRules.map((r) =>
                  r.id === ruleId ? { ...r, enabled: !r.enabled } : r
                ),
              }
        ),

      dedupEnabled: false,
      setDedupEnabled: (enabled) => set({ dedupEnabled: enabled }),
      aggregationEnabled: false,
      setAggregationEnabled: (enabled) => set({ aggregationEnabled: enabled }),
    }),
    {
      name: 'hadice-log-view',
      partialize: (state) => ({
        viewMode: state.viewMode,
        hilogSuppressionRules: state.hilogSuppressionRules,
        logcatSuppressionRules: state.logcatSuppressionRules,
        dedupEnabled: state.dedupEnabled,
        aggregationEnabled: state.aggregationEnabled,
      }),
    }
  )
)
