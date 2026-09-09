import React, { useEffect } from 'react'
import { SquareArrowOutUpRight, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import { captureEvent } from '@/lib/posthog'
import { getMenuItem } from '@/constants/menu'
import { usePanelStore } from '@/store/panelStore'
import { usePageContext } from '@/contexts/PageContext'
import * as BackendApp from '../../../bindings/Hadice/backend/appservice'
import { EventsEmit, EventsOn } from '../../../wailsjs/runtime/runtime'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'

/**
 * 窗口切换按钮：仅展示 icon，悬浮显示「在独立窗口打开」或「在主窗口显示」
 * 嵌入各页面标题栏，位于菜单名与右侧操作按钮之间
 */
export function WindowToggleButton(): React.JSX.Element | null {
  const ctx = usePageContext()
  if (!ctx) return null

  const { menuId, standalone, onNavigateTo } = ctx
  const { panelOpenMap, setPanelOpen, refreshPanelState } = usePanelStore()
  const menuItem = getMenuItem(menuId)
  const isPanelOpen = panelOpenMap[menuId] ?? false

  useEffect(() => {
    if (standalone) return
    refreshPanelState()
  }, [menuId, standalone, refreshPanelState])

  useEffect(() => {
    if (standalone) return
    const unlisten = EventsOn('navigateToPage', (closedMenuId: string) => {
      if (closedMenuId === menuId) setPanelOpen(menuId, false)
      refreshPanelState()
    })
    return () => {
      if (typeof unlisten === 'function') unlisten()
    }
  }, [menuId, standalone, setPanelOpen, refreshPanelState])

  const handleOpenInPanel = async () => {
    try {
      await BackendApp.OpenPanelWindow(menuId, menuItem?.label ?? menuId)
      setPanelOpen(menuId, true)
      captureEvent('window toggled standalone', { action: 'open', page: menuId })
    } catch (err) {
      console.error('[WindowToggleButton] OpenPanelWindow failed:', err)
    }
  }

  const handleClosePanel = async () => {
    try {
      EventsEmit('navigateToPage', menuId)
      await BackendApp.ClosePanelWindow(menuId)
      setPanelOpen(menuId, false)
      refreshPanelState()
      onNavigateTo?.(menuId)
      captureEvent('window toggled standalone', { action: 'close', page: menuId })
    } catch (err) {
      console.error('[WindowToggleButton] ClosePanelWindow failed:', err)
    }
  }

  const showBackToMain = standalone || isPanelOpen

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={showBackToMain ? handleClosePanel : handleOpenInPanel}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              showBackToMain
                ? 'text-primary hover:bg-primary/10'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {showBackToMain ? (
              <LayoutGrid className="h-4 w-4" />
            ) : (
              <SquareArrowOutUpRight className="h-4 w-4" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {showBackToMain ? '在主窗口显示' : '在独立窗口打开'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
