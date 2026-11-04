import React, { useEffect, useRef, useState } from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn, NAV_HIGHLIGHT_CLS, NAV_HIGHLIGHT_EASE, NAV_HIGHLIGHT_MS } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { menuItems } from '@/constants/menu'
import { APP_LAYOUT_ENABLED } from '@/modules/appLayout/enabled'
import { usePanelStore } from '@/store/panelStore'
import { useDeviceStore } from '@/store/deviceStore'
import { EventsOn } from '../../../wailsjs/runtime/runtime'

interface SidebarProps {
  activeMenu: string
  onMenuChange: (menuId: string) => void
}

const STORAGE_KEY = 'hadice-sidebar-collapsed'
const EXPANDED_WIDTH = 160
const COLLAPSED_WIDTH = 56
/** 仅用于 width：快→慢，无过冲（过冲会反复 layout，易卡） */
const WIDTH_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const WIDTH_MS = 320

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 左侧导航栏组件
 * 仅展示未在独立窗口中打开的菜单项；已脱离主窗口的菜单不显示
 * 网络请求功能仅鸿蒙设备支持
 */
export function Sidebar({ activeMenu, onMenuChange }: SidebarProps): React.JSX.Element {
  const { panelOpenMap, refreshPanelState } = usePanelStore()
  const selectedDevice = useDeviceStore((s) => s.selectedDevice)
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [animating, setAnimating] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isHarmonyOS = selectedDevice?.platform === 'harmonyos'

  useEffect(() => {
    refreshPanelState()
    window.addEventListener('focus', refreshPanelState)
    const unlisten = EventsOn('navigateToPage', (menuId: string) => {
      // 先乐观关闭，避免 WindowClosing 时 IsPanelWindowOpen 仍为 true 把侧栏又藏回去
      usePanelStore.getState().setPanelOpen(menuId, false)
      window.setTimeout(() => {
        void refreshPanelState()
      }, 150)
    })
    return () => {
      window.removeEventListener('focus', refreshPanelState)
      if (typeof unlisten === 'function') unlisten()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [refreshPanelState])

  const harmonyOnlyMenuIds = ['network-capture']
  const androidOnlyMenuIds = ['android-network-capture']
  const visibleItems = menuItems.filter(
    (item) =>
      !(panelOpenMap[item.id] ?? false) &&
      (item.id !== 'app-layout' || APP_LAYOUT_ENABLED) &&
      (isHarmonyOS || !harmonyOnlyMenuIds.includes(item.id)) &&
      (!isHarmonyOS || !androidOnlyMenuIds.includes(item.id))
  )
  const activeIdx = visibleItems.findIndex((item) => item.id === activeMenu)

  function toggleCollapsed(): void {
    setAnimating(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setAnimating(false), WIDTH_MS + 40)

    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

  return (
    <aside
      className="relative border-r border-border bg-card/50 flex flex-col overflow-hidden shrink-0"
      style={{
        width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
        transition: `width ${WIDTH_MS}ms ${WIDTH_EASE}`,
        // ponytail: 动画期提示合成层；结束后清掉，避免常驻 will-change 占内存
        willChange: animating ? 'width' : 'auto',
        contain: 'layout style'
      }}
    >
      <TooltipProvider delayDuration={200}>
        <ScrollArea className="flex-1">
          <nav className={cn('relative py-3 space-y-1', collapsed ? 'px-2' : 'px-3')}>
            {/* 高亮块（与便捷工具同款）：py-3(12) 起步，项高 40 + space-y-1(4) 步进；当前项被过滤/脱离窗口时淡出 */}
            <div
              aria-hidden
              className={cn('pointer-events-none absolute h-10 rounded-lg', NAV_HIGHLIGHT_CLS)}
              style={{
                top: 0,
                left: collapsed ? 8 : 12,
                right: collapsed ? 8 : 12,
                opacity: activeIdx < 0 ? 0 : 1,
                transform: `translateY(${12 + Math.max(0, activeIdx) * 44}px)`,
                transition: `transform ${NAV_HIGHLIGHT_MS}ms ${NAV_HIGHLIGHT_EASE}, opacity 200ms ease, left ${WIDTH_MS}ms ${WIDTH_EASE}, right ${WIDTH_MS}ms ${WIDTH_EASE}`,
                willChange: 'transform'
              }}
            />
            {visibleItems.map((item) => {
              const Icon = item.icon
              const isActive = activeMenu === item.id
              const button = (
                <button
                  onClick={() => onMenuChange(item.id)}
                  className={cn(
                    'relative w-full flex items-center rounded-lg text-sm font-medium transition-colors duration-300',
                    collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
                    'hover:bg-accent/50',
                    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isActive ? 'text-primary' : 'text-muted-foreground'
                    )}
                  />
                  {/* 不动画 max-width：折叠靠侧栏 overflow 裁切 + 快速淡出，减轻 layout 抖动 */}
                  <span
                    className={cn(
                      'whitespace-nowrap overflow-hidden',
                      collapsed
                        ? 'w-0 opacity-0 pointer-events-none'
                        : 'opacity-100'
                    )}
                    style={{
                      transition: collapsed
                        ? `opacity 120ms ease-out`
                        : `opacity 180ms ease-out ${WIDTH_MS - 120}ms`
                    }}
                    aria-hidden={collapsed}
                  >
                    {item.label}
                  </span>
                </button>
              )

              if (!collapsed) {
                return <React.Fragment key={item.id}>{button}</React.Fragment>
              }

              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              )
            })}
          </nav>
        </ScrollArea>

        <div className={cn('border-t border-border p-2', collapsed && 'px-1.5')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'w-full h-8 text-muted-foreground hover:text-foreground',
                  collapsed ? 'px-0' : 'justify-between px-2'
                )}
                onClick={toggleCollapsed}
                title={collapsed ? '展开菜单' : '折叠菜单'}
              >
                {!collapsed && <span className="text-xs">折叠</span>}
                <span
                  className="inline-flex"
                  style={{
                    // 小幅回弹只做在图标上（transform，不触 layout）
                    transition: `transform ${WIDTH_MS}ms ${WIDTH_EASE}`,
                    transform: animating ? 'scale(1.12)' : 'scale(1)'
                  }}
                >
                  {collapsed ? (
                    <ChevronsRight className="h-4 w-4 mx-auto" />
                  ) : (
                    <ChevronsLeft className="h-4 w-4" />
                  )}
                </span>
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">展开菜单</TooltipContent>}
          </Tooltip>
        </div>
      </TooltipProvider>
    </aside>
  )
}
