import { create } from 'zustand'

interface NavigationState {
  /** 当前活动菜单 */
  activeMenu: string
  /** 设置活动菜单 */
  setActiveMenu: (menuId: string) => void
  /** 跳转到应用管理页面并打开应用详情 */
  navigateToAppDetail: (packageName: string) => void
}

/**
 * 导航状态 Store
 * 用于页面间导航和状态管理
 */
export const useNavigationStore = create<NavigationState>((set) => ({
  activeMenu: 'device-overview',

  setActiveMenu: (menuId) => {
    set({ activeMenu: menuId })
  },

  navigateToAppDetail: (packageName) => {
    // 切换到应用管理页面
    set({ activeMenu: 'app-manager' })
    // 触发应用详情打开事件（通过自定义事件）
    window.dispatchEvent(
      new CustomEvent('open-app-detail', {
        detail: { packageName }
      })
    )
  }
}))

