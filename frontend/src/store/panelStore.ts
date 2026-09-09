import { create } from 'zustand'
import { menuItems } from '@/constants/menu'
import * as BackendApp from '../../bindings/Hadice/backend/appservice'

interface PanelState {
  /** 各菜单的独立窗口是否已打开 */
  panelOpenMap: Record<string, boolean>
  /** 刷新面板状态 */
  refreshPanelState: () => Promise<void>
  /** 标记某菜单的独立窗口已打开 */
  setPanelOpen: (menuId: string, open: boolean) => void
  /** 获取未在独立窗口中的菜单 ID 列表 */
  getVisibleMenuIds: () => string[]
  /** 获取第一个可见的菜单 ID（用于脱离后切换） */
  getFirstVisibleMenuId: (excludeMenuId?: string) => string
}

async function fetchPanelOpenState(): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    menuItems.map(async (item) => [item.id, await BackendApp.IsPanelWindowOpen(item.id)] as const)
  )
  return Object.fromEntries(entries)
}

export const usePanelStore = create<PanelState>((set, get) => ({
  panelOpenMap: {},

  refreshPanelState: async () => {
    const map = await fetchPanelOpenState()
    set({ panelOpenMap: map })
  },

  setPanelOpen: (menuId, open) => {
    set((s) => ({
      panelOpenMap: { ...s.panelOpenMap, [menuId]: open }
    }))
  },

  getVisibleMenuIds: () => {
    const { panelOpenMap } = get()
    return menuItems.filter((item) => !(panelOpenMap[item.id] ?? false)).map((item) => item.id)
  },

  getFirstVisibleMenuId: (excludeMenuId) => {
    const visible = get().getVisibleMenuIds()
    const filtered = excludeMenuId ? visible.filter((id) => id !== excludeMenuId) : visible
    return filtered[0] ?? menuItems[0].id
  }
}))
