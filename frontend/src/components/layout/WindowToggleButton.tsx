import React, { useEffect } from 'react'
import { SquareArrowOutUpRight, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import { captureEvent } from '@/lib/posthog'
import { getMenuItem } from '@/constants/menu'
import { usePanelStore } from '@/store/panelStore'
import { useDeviceStore } from '@/store/deviceStore'
import { usePageContext } from '@/contexts/PageContext'
import * as BackendApp from '../../../bindings/Hadice/backend/appservice'
import { EventsEmit, EventsOn } from '../../../wailsjs/runtime/runtime'
import {
  SHELL_FLUSH_EVENT,
  useShellSessionStore
} from '@/store/shellSessionStore'
import { SHELL_HANDOFF_EVENT } from '@/lib/shell-handoff'
import { isHdcAvailable } from '@/lib/hdc'
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

  const flushShellIfNeeded = async () => {
    const empty = useShellSessionStore.getState().toBackendState()
    if (menuId !== 'hdc-shell' || !isHdcAvailable()) return empty
    window.dispatchEvent(new Event(SHELL_FLUSH_EVENT))
    await new Promise<void>((resolve) => setTimeout(resolve, 80))
    const state = useShellSessionStore.getState().toBackendState()
    // 逐个写快照，避免整包 map 在绑定层丢失
    await Promise.all(
      Object.entries(state.snapshots).map(([id, snap]) =>
        snap ? window.hdc.setShellSnapshot(id, snap) : Promise.resolve()
      )
    )
    await window.hdc.setShellUIState(state)
    return state
  }

  const handleOpenInPanel = async () => {
    try {
      await flushShellIfNeeded()
      // 系统日志：先停主窗残留流，避免无监听时 hilog 事件打满队列导致独立窗空白
      if (menuId === 'system-logs') {
        await Promise.all([
          BackendApp.StopAllHilogStreams().catch(() => {}),
          BackendApp.StopAllLogcatStreams().catch(() => {}),
        ])
      }
      setPanelOpen(menuId, true)
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
      const deviceKey =
        useDeviceStore.getState().selectedDevice?.connectKey ?? ''
      await BackendApp.OpenPanelWindowWithDevice(
        menuId,
        menuItem?.label ?? menuId,
        deviceKey
      )
      captureEvent('window toggled standalone', { action: 'open', page: menuId })
    } catch (err) {
      setPanelOpen(menuId, false)
      console.error('[WindowToggleButton] OpenPanelWindow failed:', err)
    }
  }

  const handleClosePanel = async () => {
    try {
      const state = await flushShellIfNeeded()
      // 先广播给主窗内存，再关窗（主窗 Get 可能仍读到旧值）
      if (menuId === 'hdc-shell') {
        EventsEmit(SHELL_HANDOFF_EVENT, state)
        await new Promise<void>((resolve) => setTimeout(resolve, 30))
      }
      await BackendApp.ClosePanelWindow(menuId)
      EventsEmit('navigateToPage', menuId)
      setPanelOpen(menuId, false)
      window.setTimeout(() => {
        void refreshPanelState()
      }, 150)
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
