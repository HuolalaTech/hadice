import React, { createContext, useContext } from 'react'

interface PageContextValue {
  menuId: string
  standalone: boolean
  /** 主窗口下切回该页面时的回调 */
  onNavigateTo?: (menuId: string) => void
}

const PageContext = createContext<PageContextValue | null>(null)

export const PageProvider = PageContext.Provider

export function usePageContext(): PageContextValue | null {
  return useContext(PageContext)
}
