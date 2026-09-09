import React, { useMemo, useCallback, useState, useEffect } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppCacheStore } from '@/store/appCacheStore'
import { useProcessCacheStore } from '@/store/processCacheStore'
import type { AppInfo } from '@/types/hdc'
import { cn } from '@/lib/utils'

interface AppMultiSelectProps {
  /** 选中的应用包名列表 */
  selectedPackageNames: string[]
  /** 选中应用改变时的回调 */
  onSelectedAppsChange: (apps: Array<{ packageName: string; appName: string; pid?: number }>) => void
  /** 最多选择的应用数量 */
  maxCount?: number
  /** 占位符文本 */
  placeholder?: string
  /** 自定义className */
  className?: string
  /** 自定义应用列表（可选，默认从 store 获取） */
  apps?: Array<{ packageName: string; appName: string; pid?: number }>
}

/**
 * 应用多选器组件
 * 支持从应用管理Store中获取应用列表，使用 hdc shell pidof 命令获取对应的PID
 */
export const AppMultiSelect: React.FC<AppMultiSelectProps> = ({
  selectedPackageNames,
  onSelectedAppsChange,
  maxCount = 5,
  placeholder = '选择应用...',
  className,
  apps: customApps
}) => {
  const { appsArray } = useAppCacheStore()
  const [isOpen, setIsOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [selectedApps, setSelectedApps] = useState<Map<string, AppInfo>>(new Map())
  const [pidCache, setPidCache] = useState<Map<string, number | undefined>>(new Map())

  // 使用自定义应用列表或默认从 store 获取
  const displayApps = useMemo(() => {
    if (customApps && customApps.length > 0) {
      return customApps.map(app => ({
        packageName: app.packageName,
        appName: app.appName || app.packageName,
        version: '',
        versionCode: 0,
        size: 0,
        installTime: 0,
        isSystemApp: false,
        isEnabled: true,
        isRunning: app.pid !== undefined && app.pid > 0,
        pid: app.pid
      })) as AppInfo[]
    }
    return appsArray
  }, [customApps, appsArray])

  // 初始化已选择的应用
  useEffect(() => {
    const selected = new Map<string, AppInfo>()
    selectedPackageNames.forEach((packageName) => {
      const app = displayApps.find((a) => a.packageName === packageName)
      if (app) {
        selected.set(packageName, app)
      }
    })
    setSelectedApps(selected)
  }, [selectedPackageNames, displayApps])

  // 过滤应用列表
  const filteredApps = useMemo(() => {
    if (!searchText.trim()) {
      return displayApps
    }

    const lowerSearchText = searchText.toLowerCase()
    return displayApps.filter(
      (app) =>
        app.appName.toLowerCase().includes(lowerSearchText) ||
        app.packageName.toLowerCase().includes(lowerSearchText)
    )
  }, [displayApps, searchText])

  // 使用 hdc shell pidof 获取PID
  const getAppPid = useCallback(async (packageName: string): Promise<number | undefined> => {
    try {
      console.log('[AppMultiSelect] Getting PID for package:', packageName)

      // 检查缓存
      if (pidCache.has(packageName)) {
        const cachedPid = pidCache.get(packageName)
        console.log('[AppMultiSelect] Using cached PID for', packageName, ':', cachedPid)
        return cachedPid
      }

      // 如果自定义应用列表中有 pid，直接使用
      if (customApps) {
        const customApp = customApps.find(a => a.packageName === packageName)
        if (customApp?.pid) {
          console.log('[AppMultiSelect] Using PID from custom apps for', packageName, ':', customApp.pid)
          setPidCache(prev => new Map(prev).set(packageName, customApp.pid))
          return customApp.pid
        }
      }

      // 调用后端 ExecuteHdcCommand
      if (typeof window !== 'undefined' && window.hdc) {
        try {
          const result = await window.hdc.executeHdcCommand('', `pidof ${packageName}`)
          
          if (result.success && result.output && result.output.trim()) {
            const pid = parseInt(result.output.trim(), 10)
            if (!isNaN(pid) && pid > 0) {
              console.log('[AppMultiSelect] Found PID for', packageName, ':', pid)
              // 更新缓存
              setPidCache(prev => new Map(prev).set(packageName, pid))
              return pid
            }
          }
        } catch (error) {
          console.warn('[AppMultiSelect] executeHdcCommand not available, trying shell API')
        }
      }

      console.warn('[AppMultiSelect] No PID found for', packageName)
      // 缓存未找到的结果
      setPidCache(prev => new Map(prev).set(packageName, undefined))
      return undefined
    } catch (error) {
      console.error('[AppMultiSelect] Error getting PID for', packageName, ':', error)
      return undefined
    }
  }, [pidCache, customApps])

  // 获取简化显示名称（只显示最后两段）
  const getDisplayName = useCallback((packageName: string): string => {
    const parts = packageName.split('.')
    if (parts.length <= 2) {
      return packageName
    }
    // 显示最后两段，前面加 ..
    return '..' + parts.slice(-2).join('.')
  }, [])

  // 处理应用选择
  const handleAppToggle = useCallback(
    async (app: AppInfo, checked: boolean) => {
      const newSelected = new Map(selectedApps)

      if (checked) {
        // 检查是否超过最大数量
        if (newSelected.size >= maxCount) {
          return
        }
        newSelected.set(app.packageName, app)
      } else {
        newSelected.delete(app.packageName)
      }

      setSelectedApps(newSelected)

      // 异步获取PID并转换为需要的格式
      const selectedList = await Promise.all(
        Array.from(newSelected.values()).map(async (app) => ({
          packageName: app.packageName,
          appName: app.appName,
          pid: await getAppPid(app.packageName)
        }))
      )

      onSelectedAppsChange(selectedList)
    },
    [selectedApps, maxCount, onSelectedAppsChange, getAppPid]
  )

  // 移除已选择的应用
  const handleRemoveApp = useCallback(
    async (packageName: string) => {
      const newSelected = new Map(selectedApps)
      newSelected.delete(packageName)
      setSelectedApps(newSelected)

      const selectedList = await Promise.all(
        Array.from(newSelected.values()).map(async (app) => ({
          packageName: app.packageName,
          appName: app.appName,
          pid: await getAppPid(app.packageName)
        }))
      )

      onSelectedAppsChange(selectedList)
    },
    [selectedApps, onSelectedAppsChange, getAppPid]
  )

  return (
    <div className={cn('relative w-full', className)}>
      {/* 触发按钮 */}
      <Button
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full justify-between h-9 px-3"
      >
        <span className={cn(selectedApps.size === 0 && "text-muted-foreground")}>
          {selectedApps.size === 0 ? placeholder : `${selectedApps.size}个应用`}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 opacity-50 transition-transform', isOpen && 'rotate-180')}
        />
      </Button>

      {/* 下拉菜单 */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-background border border-input rounded-md shadow-md z-50 min-w-[500px] max-w-[700px]">
          {/* 搜索框 */}
          <div className="p-2 border-b">
            <Input
              placeholder="搜索应用名..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="h-8 text-sm"
              autoFocus
            />
          </div>

          {/* 应用列表 */}
          <ScrollArea className="h-64">
            <div className="p-1">
              {filteredApps.length === 0 ? (
                <div className="p-2 text-sm text-muted-foreground text-center">
                  未找到应用
                </div>
              ) : (
                filteredApps.map((app) => (
                  <div
                    key={app.packageName}
                    className="flex items-center gap-2 p-2 hover:bg-accent rounded-sm cursor-pointer"
                    onClick={() =>
                      handleAppToggle(app, !selectedApps.has(app.packageName))
                    }
                  >
                    <Checkbox
                      checked={selectedApps.has(app.packageName)}
                      onCheckedChange={(checked) =>
                        handleAppToggle(app, checked === true)
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {app.appName}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {app.packageName}
                      </div>
                    </div>
                    {selectedApps.size >= maxCount && !selectedApps.has(app.packageName) && (
                      <div className="text-xs text-muted-foreground">已满</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          {/* 提示信息 */}
          <div className="p-2 border-t text-xs text-muted-foreground">
            已选 {selectedApps.size}/{maxCount}
          </div>
        </div>
      )}

      {/* 点击外部关闭下拉菜单 */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  )
}
