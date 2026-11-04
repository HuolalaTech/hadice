import { create } from 'zustand'

export interface ShellTab {
  id: string
  title: string
}

interface ShellSessionState {
  tabs: ShellTab[]
  activeTabId: string
  tabSeq: number
  snapshots: Record<string, string>
  hydrated: boolean
  addTab: () => string
  closeTab: (tabId: string) => void
  setActiveTabId: (tabId: string) => void
  ensureDefaultTab: () => void
  setSnapshot: (tabId: string, snapshot: string) => void
  clearSnapshot: (tabId: string) => void
  applyBackendState: (state: {
    tabs?: ShellTab[]
    activeTabId?: string
    tabSeq?: number
    snapshots?: Record<string, string>
  }) => void
  toBackendState: () => {
    tabs: ShellTab[]
    activeTabId: string
    tabSeq: number
    snapshots: Record<string, string>
  }
}

function createShellId(): string {
  return `local-shell-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 终端会话 UI 状态（tabs + xterm 快照）。
 * ponytail: 不落 localStorage——Wails 主窗/独立窗 WebView 不共享；真相在后端 Get/SetShellUIState。
 */
export const useShellSessionStore = create<ShellSessionState>()((set, get) => ({
  tabs: [],
  activeTabId: '',
  tabSeq: 0,
  snapshots: {},
  hydrated: false,

  ensureDefaultTab: () => {
    const { tabs } = get()
    if (tabs.length > 0) return
    const id = createShellId()
    set({
      tabs: [{ id, title: '终端 1' }],
      activeTabId: id,
      tabSeq: 1
    })
  },

  addTab: () => {
    const seq = get().tabSeq + 1
    const id = createShellId()
    const title = `终端 ${seq}`
    set((state) => ({
      tabs: [...state.tabs, { id, title }],
      activeTabId: id,
      tabSeq: seq
    }))
    return id
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get()
    if (tabs.length <= 1) return
    const idx = tabs.findIndex((t) => t.id === tabId)
    const next = tabs.filter((t) => t.id !== tabId)
    let nextActive = activeTabId
    if (activeTabId === tabId) {
      nextActive = next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? ''
    }
    set((state) => {
      const snapshots = { ...state.snapshots }
      delete snapshots[tabId]
      return { tabs: next, activeTabId: nextActive, snapshots }
    })
  },

  setActiveTabId: (tabId) => set({ activeTabId: tabId }),

  setSnapshot: (tabId, snapshot) =>
    set((state) => ({
      snapshots: { ...state.snapshots, [tabId]: snapshot }
    })),

  clearSnapshot: (tabId) =>
    set((state) => {
      const snapshots = { ...state.snapshots }
      delete snapshots[tabId]
      return { snapshots }
    }),

  applyBackendState: (state) => {
    set({
      tabs: state.tabs ?? [],
      activeTabId: state.activeTabId ?? '',
      tabSeq: state.tabSeq ?? 0,
      snapshots: state.snapshots ?? {},
      hydrated: true
    })
  },

  toBackendState: () => {
    const { tabs, activeTabId, tabSeq, snapshots } = get()
    return { tabs, activeTabId, tabSeq, snapshots }
  }
}))

/** 通知当前窗口内所有 ShellSessionPane 立刻序列化画面 */
export const SHELL_FLUSH_EVENT = 'hadice-shell-flush'
