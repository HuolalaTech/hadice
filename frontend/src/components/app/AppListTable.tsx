import React from 'react'
import {
  Package,
  MoreHorizontal,
  Play,
  Square,
  Database,
  Sparkles,
  Info,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { AppInfo, AppFilterType } from '@/types/hdc'
import type { HdcDevice } from '@/types/hdc'

/**
 * 应用列表表格组件
 */
export function AppListTable({
  apps,
  filter,
  searchTerm,
  selectedDevice,
  failedIcons,
  isLoading,
  onAppClick,
  onImageError,
  onStartApp,
  onStopApp,
  onActionClick
}: {
  apps: AppInfo[]
  filter: AppFilterType
  searchTerm: string
  selectedDevice: HdcDevice | null
  failedIcons: Set<string>
  isLoading: boolean
  onAppClick: (app: AppInfo) => void
  onImageError: (packageName: string) => void
  onStartApp: (app: AppInfo) => Promise<void>
  onStopApp: (app: AppInfo) => Promise<void>
  onActionClick: (app: AppInfo, action: 'clear' | 'clearCache' | 'uninstall' | 'detail', event?: React.MouseEvent) => void
}): React.JSX.Element {
  // 过滤应用（先应用筛选条件，再应用搜索）
  const filteredApps = React.useMemo(() => {
    try {
      // 先过滤掉无效的应用（版本号未解析的，通常是第一行无效数据）
      let validApps = apps.filter((app) => {
        // 过滤掉版本号未解析的应用（version 为空或为 "Unknown"，且 versionCode 为 0）
        // 但保留包名有效的应用（至少包名不为空）
        if (!app.packageName || app.packageName.trim() === '') {
          return false
        }
        // 如果版本号未解析，但包名看起来有效（包含点号），仍然保留
        // 这样可以避免过滤掉真正有效的应用
        // 只过滤掉明显无效的第一行（通常是表头或空行）
        if (app.version === 'Unknown' && app.versionCode === 0) {
          // 检查是否是有效的包名格式（包含点号）
          if (!app.packageName.includes('.')) {
            return false // 无效的包名格式
          }
          // 如果包名看起来有效，保留它（可能是系统应用或特殊应用）
        }
        return true
      })

      // 再应用筛选条件
      let filtered = validApps
      switch (filter) {
        case 'system':
          filtered = validApps.filter((app) => app.isSystemApp)
          break
        case 'thirdParty':
          filtered = validApps.filter((app) => !app.isSystemApp)
          break
        case 'running':
          filtered = validApps.filter((app) => app.isRunning)
          break
        case 'stopped':
          filtered = validApps.filter((app) => !app.isRunning)
          break
        default:
          filtered = validApps
      }

      // 再应用搜索条件
      if (!searchTerm || !searchTerm.trim()) return filtered

      const term = searchTerm.toLowerCase().trim()
      return filtered.filter((app) => {
        try {
          const appName = app.appName || ''
          const packageName = app.packageName || ''
          return (
            appName.toLowerCase().includes(term) ||
            packageName.toLowerCase().includes(term)
          )
        } catch (error) {
          console.error('[AppListTable] Error filtering app:', app, error)
          return false
        }
      })
    } catch (error) {
      console.error('[AppListTable] Error in filteredApps calculation:', error)
      return apps // 出错时返回原始列表
    }
  }, [apps, searchTerm, filter])

  if (isLoading && apps.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (filteredApps.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        {searchTerm ? '未找到匹配的应用' : '暂无应用'}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 固定表头 */}
      <div className="sticky top-0 z-10 bg-card border-b border-border shadow-sm">
        <div className="grid grid-cols-[60px_200px_1.5fr_180px] gap-4 h-12 px-4 items-center">
          <div className="text-left font-medium text-muted-foreground text-sm">图标</div>
          <div className="text-left font-medium text-muted-foreground text-sm">应用名称</div>
          <div className="text-left font-medium text-muted-foreground text-sm">包名</div>
          <div className="text-right font-medium text-muted-foreground text-sm">操作</div>
        </div>
      </div>

      {/* 可滚动内容区域 */}
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border/30">
          {filteredApps.map((app) => (
          <div
            key={app.packageName}
            className="grid grid-cols-[60px_200px_1.5fr_180px] gap-4 h-16 px-4 items-center hover:bg-secondary/30 transition-colors cursor-pointer"
            onClick={() => onAppClick(app)}
          >
            {/* 图标 */}
            <div className="flex items-center">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-secondary/50 flex items-center justify-center overflow-hidden">
                {app.icon && !failedIcons.has(app.packageName) ? (
                  <img
                    src={app.icon}
                    alt={app.appName}
                    className="w-full h-full rounded-lg object-cover"
                    onError={() => onImageError(app.packageName)}
                    loading="lazy"
                  />
                ) : (
                  <Package className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
            </div>

            {/* 应用名称 */}
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-sm truncate" title={app.appName}>
                {app.appName}
              </span>
              {app.isRunning && (
                <span className="text-xs text-green-500 flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  运行中
                </span>
              )}
            </div>

            {/* 包名 */}
            <div className="min-w-0">
              <span className="text-sm font-mono text-muted-foreground truncate block" title={app.packageName}>
                {app.packageName}
              </span>
            </div>

            {/* 操作 */}
            <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {app.isRunning ? (
                      <DropdownMenuItem
                        onClick={async (e) => {
                          e.stopPropagation()
                          await onStopApp(app)
                        }}
                      >
                        <Square className="h-4 w-4 mr-2" />
                        停止应用
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={async (e) => {
                          e.stopPropagation()
                          await onStartApp(app)
                        }}
                      >
                        <Play className="h-4 w-4 mr-2" />
                        启动应用
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={(e) => onActionClick(app, 'clear', e)}
                    >
                      <Database className="h-4 w-4 mr-2" />
                      清除数据
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => onActionClick(app, 'clearCache', e)}
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      清除缓存
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        onActionClick(app, 'detail', e)
                      }}
                    >
                      <Info className="h-4 w-4 mr-2" />
                      查看详情
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {!app.isSystemApp && (
                      <DropdownMenuItem
                        onClick={(e) => onActionClick(app, 'uninstall', e)}
                        className="text-red-500 focus:text-red-500"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        卸载应用
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

