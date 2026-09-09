import React, { useEffect, useState, useCallback } from 'react'
import {
  Package,
  Search,
  RefreshCw,
  Filter
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { NoDeviceState } from '@/components/layout/NoDeviceState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useDeviceStore } from '@/store/deviceStore'
import { useAppCacheStore } from '@/store/appCacheStore'
import { AppDetailDialog } from '@/components/dialogs/AppDetailDialog'
import { toast } from 'sonner'
import { AppStatsCards } from '@/components/app/AppStatsCards'
import { AppListTable } from '@/components/app/AppListTable'
import { AppActionDialog } from '@/components/app/AppActionDialog'
import { useAppList } from '@/hooks/useAppList'
import { useAppActions } from '@/hooks/useAppActions'
import { captureEvent } from '@/lib/posthog'
import type { AppInfo, AppFilterType } from '@/types/hdc'

/**
 * 应用管理页面
 */
export function AppManagerPage(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [filter, setFilter] = useState<AppFilterType>('thirdParty') // 默认选中第三方应用

  // 操作弹窗状态
  const [actionDialogOpen, setActionDialogOpen] = useState(false)
  const [selectedApp, setSelectedApp] = useState<AppInfo | null>(null)
  const [actionType, setActionType] = useState<
    'start' | 'stop' | 'clear' | 'clearCache' | 'uninstall' | null
  >(null)

  // 应用详情弹窗状态
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [detailApp, setDetailApp] = useState<AppInfo | null>(null)

  // 使用自定义 hooks
  const { apps, stats, isLoading, failedIcons, fetchAppList, handleImageError } = useAppList(filter)
  const { isActioning, startApp, stopApp, executeAction } = useAppActions(async () => {
    await fetchAppList()
  })

  // 打开应用详情弹窗
  const handleOpenDetailDialog = useCallback(
    (app: AppInfo) => {
      captureEvent('app detail opened', { package_name: app.packageName })
      setDetailApp(app)
      setDetailDialogOpen(true)
    },
    []
  )

  // 监听来自其他页面的应用详情打开请求
  useEffect(() => {
    let isMounted = true
    
    const handleOpenAppDetail = async (event: CustomEvent<{ packageName: string }>) => {
      if (!isMounted) return
      
      const { packageName } = event.detail
      
      // 等待页面切换完成
      await new Promise((resolve) => setTimeout(resolve, 200))
      
      if (!isMounted) return
      
      // 从缓存中获取应用信息
      const { getAppByPackageName } = useAppCacheStore.getState()
      let app = getAppByPackageName(packageName)
      
      // 如果缓存中没有，尝试从当前列表查找
      if (!app) {
        const foundApp = apps.find((a) => a.packageName === packageName)
        if (foundApp) {
          handleOpenDetailDialog(foundApp)
        } else {
          // 如果还是找不到，刷新列表
          if (selectedDevice) {
            await fetchAppList()
            if (!isMounted) return
            
            // 再次尝试从缓存获取
            app = getAppByPackageName(packageName)
            if (!app) {
              const updatedFoundApp = apps.find((a) => a.packageName === packageName)
              if (updatedFoundApp) {
                handleOpenDetailDialog(updatedFoundApp)
              }
            } else {
              handleOpenDetailDialog(app)
            }
          }
        }
        return
      }
      
      if (app && isMounted) {
        handleOpenDetailDialog(app)
      } else if (!app) {
        console.warn(`[AppManager] App not found: ${packageName}`)
      }
    }

    window.addEventListener('open-app-detail', handleOpenAppDetail as unknown as EventListener)
    return () => {
      isMounted = false
      window.removeEventListener('open-app-detail', handleOpenAppDetail as unknown as EventListener)
    }
  }, [handleOpenDetailDialog, fetchAppList, selectedDevice?.connectKey, apps])

  // 打开操作弹窗
  const handleOpenActionDialog = useCallback((
    app: AppInfo,
    type: 'start' | 'stop' | 'clear' | 'clearCache' | 'uninstall',
    event?: React.MouseEvent
  ) => {
    // 阻止事件冒泡，避免触发详情弹窗
    if (event) {
      event.stopPropagation()
    }
    setSelectedApp(app)
    setActionType(type)
    setActionDialogOpen(true)
  }, [])

  // 处理操作确认
  const handleActionConfirm = useCallback(async () => {
    if (!selectedApp || !actionType) return

    const result = await executeAction(selectedApp, actionType)
    
    if (result?.success) {
      toast.success(
        actionType === 'start' ? '应用已启动' :
        actionType === 'stop' ? '应用已停止' :
        actionType === 'clear' ? '应用数据已清除' :
        actionType === 'clearCache' ? '应用缓存已清除' :
        '应用已卸载'
      )
      // 如果详情弹窗打开，刷新详情
      if (detailDialogOpen && detailApp?.packageName === selectedApp.packageName) {
        await handleOpenDetailDialog(selectedApp)
      }
    } else {
      toast.error(result?.error || '操作失败')
    }

    setActionDialogOpen(false)
    setSelectedApp(null)
    setActionType(null)
  }, [selectedApp, actionType, executeAction, detailDialogOpen, detailApp, handleOpenDetailDialog])


  // 处理应用操作（从表格菜单）
  const handleAppAction = useCallback(async (
    app: AppInfo,
    action: 'clear' | 'clearCache' | 'uninstall' | 'detail',
    event?: React.MouseEvent
  ) => {
    if (action === 'detail') {
      handleOpenDetailDialog(app)
      return
    }
    handleOpenActionDialog(app, action, event)
  }, [handleOpenDetailDialog, handleOpenActionDialog])

  // 未连接设备
  if (!selectedDevice) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Package className="h-6 w-6 text-primary" />
            应用管理
            <WindowToggleButton />
            <HelpToggleButton />
          </h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <NoDeviceState />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full flex flex-col">
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Package className="h-6 w-6 text-primary" />
          应用管理
          <WindowToggleButton />
            <HelpToggleButton />
        </h1>
      </div>

      {/* 搜索和筛选区 */}
      <div className="mb-4 flex items-center gap-4 flex-shrink-0">
        {/* 搜索框 */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索应用名称或包名..."
            value={searchTerm || ''}
            onChange={(e) => {
              try {
                const value = e.target.value || ''
                setSearchTerm(value)
              } catch (error) {
                console.error('[AppManager] Error updating search term:', error)
                setSearchTerm('')
              }
            }}
            className="pl-9"
          />
        </div>

        {/* 筛选下拉 */}
        <Select value={filter} onValueChange={(v) => {
          captureEvent('app filter changed', { filter: v })
          setFilter(v as AppFilterType)
        }}>
          <SelectTrigger className="w-[153.6px] h-9">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="system">系统应用</SelectItem>
            <SelectItem value="thirdParty">第三方应用</SelectItem>
            <SelectItem value="running">运行中</SelectItem>
            <SelectItem value="stopped">已停止</SelectItem>
          </SelectContent>
        </Select>

        {/* 刷新按钮 */}
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAppList}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          刷新
        </Button>

        {/* 统计卡片 */}
        <AppStatsCards stats={stats} filter={filter} onFilterChange={setFilter} />
      </div>

      {/* 应用列表 */}
      <Card className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          <AppListTable
            apps={apps}
            filter={filter}
            searchTerm={searchTerm}
            selectedDevice={selectedDevice}
            failedIcons={failedIcons}
            isLoading={isLoading}
            onAppClick={handleOpenDetailDialog}
            onImageError={handleImageError}
            onStartApp={startApp}
            onStopApp={stopApp}
            onActionClick={handleAppAction}
          />
        </CardContent>
      </Card>

      {/* 底部信息 */}
      <div className="mt-2 text-xs text-muted-foreground flex items-center gap-4 flex-shrink-0">
        <span className="font-mono">
          显示 {apps.length} 应用
        </span>
        {searchTerm && (
          <span>
            搜索: &quot;{searchTerm}&quot;
            <Button
              variant="link"
              size="sm"
              onClick={() => setSearchTerm('')}
              className="ml-2 h-auto p-0"
            >
              清除
            </Button>
          </span>
        )}
      </div>

      {/* 操作确认弹窗 */}
      <AppActionDialog
        open={actionDialogOpen}
        onOpenChange={setActionDialogOpen}
        app={selectedApp}
        actionType={actionType}
        isActioning={isActioning}
        onConfirm={handleActionConfirm}
      />

      {/* 应用详情弹窗 */}
      <AppDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        app={detailApp}
        selectedDevice={selectedDevice}
        showActions={true}
        onAction={(action) => {
          if (detailApp) {
            handleOpenActionDialog(detailApp, action)
          }
        }}
        onRefresh={fetchAppList}
        onImageError={handleImageError}
        failedIcons={failedIcons}
      />

    </div>
  )
}
