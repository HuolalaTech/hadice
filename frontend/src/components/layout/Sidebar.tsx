import React, { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { menuItems } from '@/constants/menu'
import { usePanelStore } from '@/store/panelStore'
import { useDeviceStore } from '@/store/deviceStore'
import { EventsOn } from '../../../wailsjs/runtime/runtime'

interface SidebarProps {
  activeMenu: string
  onMenuChange: (menuId: string) => void
}

/**
 * 左侧导航栏组件
 * 仅展示未在独立窗口中打开的菜单项；已脱离主窗口的菜单不显示
 * 网络请求功能仅鸿蒙设备支持
 */
export function Sidebar({ activeMenu, onMenuChange }: SidebarProps): React.JSX.Element {
  const { panelOpenMap, refreshPanelState } = usePanelStore()
  const selectedDevice = useDeviceStore((s) => s.selectedDevice)

  // 过滤掉仅鸿蒙支持的菜单项（网络请求）
  const isHarmonyOS = selectedDevice?.platform === 'harmonyos'

  useEffect(() => {
    refreshPanelState()
    window.addEventListener('focus', refreshPanelState)
    const unlisten = EventsOn('navigateToPage', refreshPanelState)
    return () => {
      window.removeEventListener('focus', refreshPanelState)
      if (typeof unlisten === 'function') unlisten()
    }
  }, [refreshPanelState])

  // 仅鸿蒙支持的菜单ID
  const harmonyOnlyMenuIds = ['network-capture']
  // 仅安卓支持的菜单ID
  const androidOnlyMenuIds = ['android-network-capture']
  const visibleItems = menuItems.filter(
    (item) =>
      !(panelOpenMap[item.id] ?? false) &&
      // 非鸿蒙设备隐藏鸿蒙专属菜单
      (isHarmonyOS || !harmonyOnlyMenuIds.includes(item.id)) &&
      // 非安卓设备隐藏安卓专属菜单
      (!isHarmonyOS || !androidOnlyMenuIds.includes(item.id))
  )

  return (
    <aside className="w-[160px] border-r border-border bg-card/50 flex flex-col">
      <ScrollArea className="flex-1">
        <nav className="p-3 space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon
            const isActive = activeMenu === item.id
            return (
              <button
                key={item.id}
                onClick={() => onMenuChange(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                  'hover:bg-accent/50',
                  isActive
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}
                />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
      </ScrollArea>
    </aside>
  )
}
