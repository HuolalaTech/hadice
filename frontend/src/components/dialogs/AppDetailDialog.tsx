import React, { useEffect, useState, useCallback } from 'react'
import {
  Package,
  RefreshCw,
  Play,
  Square,
  Database,
  Sparkles,
  Trash2
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type {
  AppInfo,
  AppShortcutInfo,
  MissionInfo,
  AppRunningRecord,
  AppFullDetail
} from '@/types/hdc'
import type { HdcDevice } from '@/types/hdc'
import { isHdcAvailable } from '@/lib/hdc'
import { formatFileSize, formatDateTime } from '@/lib/format'

interface AppDetailDialogProps {
  /** 弹窗是否打开 */
  open: boolean
  /** 弹窗打开/关闭状态变化回调 */
  onOpenChange: (open: boolean) => void
  /** 应用信息 */
  app: AppInfo | null
  /** 选中的设备 */
  selectedDevice: HdcDevice | null
  /** 是否显示操作按钮（启动/停止/清除数据等） */
  showActions?: boolean
  /** 操作回调（用于应用管理页面的操作） */
  onAction?: (action: 'start' | 'stop' | 'clear' | 'clearCache' | 'uninstall') => void
  /** 刷新回调（用于应用管理页面刷新列表） */
  onRefresh?: () => void
  /** 图片加载失败的回调 */
  onImageError?: (packageName: string) => void
  /** 失败的图标集合 */
  failedIcons?: Set<string>
}

/**
 * 应用详情弹窗组件
 * 用于显示应用的详细信息，包括基本信息、运行状态、快捷方式、能力信息等
 */
export function AppDetailDialog({
  open,
  onOpenChange,
  app,
  selectedDevice,
  showActions = false,
  onAction,
  onRefresh,
  onImageError,
  failedIcons = new Set()
}: AppDetailDialogProps): React.JSX.Element | null {
  const [detailLoading, setDetailLoading] = useState(false)
  const [shortcuts, setShortcuts] = useState<AppShortcutInfo[]>([])
  const [missions, setMissions] = useState<MissionInfo[]>([])
  const [runningRecord, setRunningRecord] = useState<AppRunningRecord | null>(null)
  const [permissions, setPermissions] = useState<Array<{ name: string; reason?: string; usedScene?: { abilities?: string[]; when?: string } }>>([])
  const [abilities, setAbilities] = useState<Array<{ name: string; label?: string; description?: string; launchType?: string; supportWindowMode?: string[]; skills?: any[] }>>([])
  const [activeTab, setActiveTab] = useState('basic')
  const [appDetail, setAppDetail] = useState<AppFullDetail | null>(null)
  const [resolvedAppName, setResolvedAppName] = useState<string>('')

  /**
   * 加载应用详情数据
   */
  const loadAppDetails = useCallback(async () => {
    if (!selectedDevice || !app || !isHdcAvailable()) return

    setDetailLoading(true)
    setShortcuts([])
    setMissions([])
    setRunningRecord(null)
    setPermissions([])
    setAbilities([])
    setAppDetail(null)
    setResolvedAppName('')
    setActiveTab('basic')

    try {
      // 并行加载详细信息
      const [shortcutsResult, missionsResult, runningResult, fullDetailResult] = await Promise.all([
        window.hdc.getAppShortcuts(selectedDevice.connectKey, app.packageName),
        window.hdc.getMissionList(selectedDevice.connectKey),
        window.hdc.getAppRunningRecords(selectedDevice.connectKey),
        window.hdc.getAppFullDetail(selectedDevice.connectKey, app.packageName)
      ])

      if (shortcutsResult.success && shortcutsResult.shortcuts) {
        setShortcuts(shortcutsResult.shortcuts)
      }

      if (missionsResult.success && missionsResult.missions) {
        // 筛选出当前应用的任务
        const appMissions = missionsResult.missions.filter(
          (m) => m.abilityRecords.some((ar) => ar.bundleName === app.packageName)
        )
        setMissions(appMissions)
      }

      if (runningResult.success && runningResult.records) {
        // 查找当前应用的运行记录
        const record = runningResult.records.find((r) => r.processName === app.packageName)
        if (record) {
          setRunningRecord(record)
        }
      }

      if (fullDetailResult.success) {
        // 如果详情返回了应用名，使用详情中的应用名
        if (fullDetailResult.appName) {
          setResolvedAppName(fullDetailResult.appName)
        }
        setAppDetail({
          packageName: fullDetailResult.packageName || app.packageName,
          versionName: fullDetailResult.versionName || '',
          versionCode: fullDetailResult.versionCode || 0,
          installTime: fullDetailResult.installTime || 0,
          updateTime: fullDetailResult.updateTime || 0,
          firstInstallTime: fullDetailResult.firstInstallTime || 0,
          isSystemApp: fullDetailResult.isSystemApp || false,
          isEnabled: fullDetailResult.isEnabled || false,
          isPreInstallApp: fullDetailResult.isPreInstallApp || false,
          isNativeApp: fullDetailResult.isNativeApp || false,
          vendor: fullDetailResult.vendor || '',
          targetVersion: fullDetailResult.targetVersion || 0,
          minSdkVersion: fullDetailResult.minSdkVersion || 0,
          uid: fullDetailResult.uid || 0,
          gid: fullDetailResult.gid || 0,
          codePath: fullDetailResult.codePath || '',
          permissions: fullDetailResult.permissions || [],
          abilities: fullDetailResult.abilities || []
        })
        if (fullDetailResult.permissions) {
          setPermissions(fullDetailResult.permissions)
        }
        if (fullDetailResult.abilities) {
          setAbilities(fullDetailResult.abilities)
        }
      }
    } catch (error) {
      console.error('[AppDetailDialog] Failed to load app details:', error)
    } finally {
      setDetailLoading(false)
    }
  }, [selectedDevice, app, isHdcAvailable])

  // 当弹窗打开且应用信息存在时，加载详情数据
  useEffect(() => {
    if (open && app) {
      loadAppDetails()
    }
  }, [open, app, loadAppDetails])

  if (!app) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[1620px] h-[672px] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-secondary/50 flex items-center justify-center overflow-hidden">
              {app.icon && !failedIcons.has(app.packageName) ? (
                <img
                  src={app.icon}
                  alt={app.appName}
                  className="w-full h-full rounded-lg object-cover"
                  onError={() => onImageError?.(app.packageName)}
                />
              ) : (
                <Package className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xl font-bold break-words">{resolvedAppName || app.appName}</div>
              <div className="text-sm text-muted-foreground font-mono break-all">
                {app.packageName}
              </div>
              {app.isRunning && (
                <div className="text-xs text-green-500 flex items-center gap-1 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  运行中
                </div>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
          <TabsList className={`grid w-full ${selectedDevice?.platform === 'android' ? 'grid-cols-3' : 'grid-cols-4'}`}>
            <TabsTrigger value="basic">基本信息</TabsTrigger>
            {selectedDevice?.platform !== 'android' && (
              <TabsTrigger value="shortcuts">快捷方式</TabsTrigger>
            )}
            <TabsTrigger value="permissions">权限列表</TabsTrigger>
            <TabsTrigger value="abilities">
              {selectedDevice?.platform === 'android' ? '活动信息' : '能力信息'}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4">
            {/* 基本信息 */}
            <TabsContent value="basic" className="space-y-4">
              <div className="bg-secondary/30 rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <span className="text-sm text-muted-foreground">应用名称</span>
                    <div className="font-semibold mt-1">{resolvedAppName || app.appName}</div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">包名</span>
                    <div className="font-mono text-sm mt-1 break-all">{app.packageName}</div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">版本</span>
                    <div className="font-mono text-sm mt-1">
                      {appDetail?.versionName || app.version || 'Unknown'}
                      {appDetail?.versionCode ? ` (${appDetail.versionCode})` : ''}
                    </div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">安装时间</span>
                    <div className="text-sm mt-1">
                      {appDetail?.installTime
                        ? formatDateTime(appDetail.installTime)
                        : app.installTime
                          ? formatDateTime(app.installTime)
                          : 'Unknown'}
                    </div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">更新时间</span>
                    <div className="text-sm mt-1">
                      {appDetail?.updateTime
                        ? formatDateTime(appDetail.updateTime)
                        : 'Unknown'}
                    </div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">系统应用</span>
                    <div className="text-sm mt-1">
                      {(appDetail?.isSystemApp ?? app.isSystemApp) ? (
                        <span className="text-blue-500">是</span>
                      ) : (
                        <span>否</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">启用状态</span>
                    <div className="text-sm mt-1">
                      {(appDetail?.isEnabled ?? app.isEnabled) ? (
                        <span className="text-green-500">已启用</span>
                      ) : (
                        <span className="text-red-500">已禁用</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">开发者/供应商</span>
                    <div className="text-sm mt-1">{appDetail?.vendor || 'Unknown'}</div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">安装类型</span>
                    <div className="text-sm mt-1">
                      {appDetail?.isPreInstallApp ? (
                        <span className="text-orange-500">预装应用</span>
                      ) : appDetail?.isNativeApp ? (
                        <span className="text-purple-500">原生应用</span>
                      ) : (
                        <span>用户安装</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">目标 API 版本</span>
                    <div className="font-mono text-sm mt-1">{appDetail?.targetVersion || 'Unknown'}</div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">安装路径</span>
                    <div className="font-mono text-xs mt-1 break-all">{appDetail?.codePath || 'Unknown'}</div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* 快捷方式 */}
            <TabsContent value="shortcuts" className="space-y-4">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : shortcuts.length > 0 ? (
                <div className="space-y-2">
                  {shortcuts.map((shortcut) => (
                    <div key={shortcut.id} className="bg-secondary/30 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold">{shortcut.label}</span>
                        <span className="text-xs text-muted-foreground">ID: {shortcut.id}</span>
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div>模块: {shortcut.moduleName}</div>
                        <div>状态: {shortcut.isEnables ? '已启用' : '未启用'}</div>
                        {shortcut.intents.length > 0 && (
                          <div className="mt-2">
                            <div className="font-semibold mb-1">意图:</div>
                            {shortcut.intents.map((intent, idx) => (
                              <div key={idx} className="pl-4 text-xs">
                                <div>目标包: {intent.targetBundle}</div>
                                <div>目标类: {intent.targetClass}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">暂无快捷方式</div>
              )}
            </TabsContent>

            {/* 权限列表 */}
            <TabsContent value="permissions" className="space-y-4">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : permissions.length > 0 ? (
                <div className="space-y-2">
                  {permissions.map((perm, idx) => (
                    <div key={idx} className="bg-secondary/30 rounded-lg p-3">
                      <div className="font-semibold text-sm">{perm.name}</div>
                      {perm.reason && (
                        <div className="text-xs text-muted-foreground mt-1">{perm.reason}</div>
                      )}
                      {perm.usedScene && (
                        <div className="text-xs text-muted-foreground mt-1">
                          使用场景: {perm.usedScene.when || 'always'}
                          {perm.usedScene.abilities && perm.usedScene.abilities.length > 0 && (
                            <span className="ml-2">
                              能力: {perm.usedScene.abilities.join(', ')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">无权限要求</div>
              )}
            </TabsContent>

            {/* 能力信息 */}
            <TabsContent value="abilities" className="space-y-4">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : abilities.length > 0 ? (
                <div className="space-y-3">
                  {abilities.map((ability, idx) => (
                    <div key={idx} className="bg-secondary/30 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold">{ability.name}</div>
                        {ability.launchType && (
                          <span className="text-xs px-2 py-1 rounded bg-primary/20">{ability.launchType}</span>
                        )}
                      </div>
                      {ability.label && (
                        <div className="text-sm text-muted-foreground mb-1">标签: {ability.label}</div>
                      )}
                      {ability.description && (
                        <div className="text-sm text-muted-foreground mb-2">{ability.description}</div>
                      )}
                      {ability.supportWindowMode && ability.supportWindowMode.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {ability.supportWindowMode.map((mode, modeIdx) => (
                            <span key={modeIdx} className="text-xs px-2 py-1 rounded bg-secondary/50">
                              {mode}
                            </span>
                          ))}
                        </div>
                      )}
                      {ability.skills && ability.skills.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="text-xs font-semibold text-muted-foreground">支持的 URL Schemes:</div>
                          {ability.skills.map((skill, skillIdx) => {
                            if (!skill.uris || skill.uris.length === 0) return null
                            return (
                              <div key={skillIdx} className="text-xs text-muted-foreground pl-2">
                                {skill.uris
                                  .map((uri: any) => uri.scheme || `${uri.host || ''}${uri.path || ''}`)
                                  .filter(Boolean)
                                  .join(', ')}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">暂无能力信息</div>
              )}
            </TabsContent>
          </div>

          {/* 操作按钮 */}
          {showActions && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {app.isRunning ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!selectedDevice || !app) return
                      try {
                        await window.hdc.stopApp(selectedDevice.connectKey, app.packageName, selectedDevice.platform)
                        onRefresh?.()
                        // 重新加载详情
                        await loadAppDetails()
                      } catch (error) {
                        console.error('[AppDetailDialog] Failed to stop app:', error)
                      }
                    }}
                  >
                    <Square className="h-4 w-4 mr-2" />
                    停止应用
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!selectedDevice || !app) return
                      try {
                        await window.hdc.startApp(selectedDevice.connectKey, app.packageName, selectedDevice.platform)
                        onRefresh?.()
                        // 重新加载详情
                        await loadAppDetails()
                      } catch (error) {
                        console.error('[AppDetailDialog] Failed to start app:', error)
                      }
                    }}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    启动应用
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false)
                    onAction?.('clear')
                  }}
                >
                  <Database className="h-4 w-4 mr-2" />
                  清除数据
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false)
                    onAction?.('clearCache')
                  }}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  清除缓存
                </Button>
                {!app.isSystemApp && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      onOpenChange(false)
                      onAction?.('uninstall')
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    卸载应用
                  </Button>
                )}
              </div>
            </div>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

