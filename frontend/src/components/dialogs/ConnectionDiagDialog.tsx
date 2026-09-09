import React, { useEffect, useState } from 'react'
import { RefreshCw, Circle, Usb, Wifi, X, Loader2, Power } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { useDeviceStore } from '@/store/deviceStore'
import * as App from '../../../bindings/Hadice/backend/appservice'
import type { Platform, Device } from '@/types/hdc'

import harmonyosIcon from '@/assets/images/ic_harmonyos.png'
import androidosIcon from '@/assets/images/ic_androidos.png'

interface ConnectionDiagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface DiagLog {
  time: string
  message: string
  type: 'info' | 'success' | 'error'
}

/**
 * 连接诊断弹窗组件
 * 显示 HDC/ADB 守护进程状态、设备连接列表、诊断日志
 */
export function ConnectionDiagDialog({
  open,
  onOpenChange
}: ConnectionDiagDialogProps): React.JSX.Element {
  const { refreshDevices, isLoading } = useDeviceStore()
  const [diagLogs, setDiagLogs] = useState<DiagLog[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isRestartingHdc, setIsRestartingHdc] = useState(false)
  const [isRestartingAdb, setIsRestartingAdb] = useState(false)

  // HDC 状态
  const [hdcVersion, setHdcVersion] = useState('Unknown')
  const [hdcStatus, setHdcStatus] = useState<'running' | 'stopped'>('stopped')
  const [hdcDevices, setHdcDevices] = useState<Device[]>([])

  // ADB 状态
  const [adbVersion, setAdbVersion] = useState('Unknown')
  const [adbStatus, setAdbStatus] = useState<'running' | 'stopped'>('stopped')
  const [adbDevices, setAdbDevices] = useState<Device[]>([])

  // 添加诊断日志
  const addLog = (message: string, type: DiagLog['type'] = 'info'): void => {
    const now = new Date()
    const time = now.toLocaleTimeString('zh-CN', { hour12: false })
    setDiagLogs((prev) => [...prev, { time, message, type }])
  }

  // 初始化诊断
  useEffect(() => {
    if (open) {
      runDiagnostics()
    }
  }, [open])

  // 运行诊断
  const runDiagnostics = async (): Promise<void> => {
    console.log('[ConnectionDiag] ========== 开始连接诊断 ==========')
    setIsRefreshing(true)
    setDiagLogs([])

    try {
      // 并行诊断 HDC 和 ADB
      await Promise.all([runHdcDiagnostics(), runAdbDiagnostics()])
    } catch (error) {
      console.error('[ConnectionDiag] ❌ 诊断过程发生异常:', error)
      addLog(`诊断出错: ${error instanceof Error ? error.message : '未知错误'}`, 'error')
    } finally {
      setIsRefreshing(false)
    }
  }

  // 运行 HDC 诊断
  const runHdcDiagnostics = async (): Promise<void> => {
    // 检查 HDC 版本
    try {
      const versionResult = await App.GetHdcVersion()
      if (versionResult && versionResult !== 'Unknown') {
        setHdcVersion(versionResult)
        addLog(`HDC 版本: ${versionResult}`, 'success')
      } else {
        addLog(`无法获取 HDC 版本`, 'error')
      }
    } catch (error) {
      addLog(`获取 HDC 版本失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error')
    }

    // 检查服务状态
    try {
      const serverInfo = await App.CheckServer()
      if (serverInfo.client && serverInfo.client !== 'Unknown') {
        setHdcStatus('running')
        addLog(`HDC 服务运行中 (Client: ${serverInfo.client}, Server: ${serverInfo.server})`, 'success')
      } else {
        setHdcStatus('stopped')
        addLog(`HDC 服务未运行`, 'error')
        // 尝试启动服务
        try {
          const startResult = await App.StartServer()
          if (startResult.success) {
            setHdcStatus('running')
            addLog('HDC 服务已启动', 'success')
          }
        } catch (e) {
          addLog('启动 HDC 服务失败', 'error')
        }
      }
    } catch (error) {
      setHdcStatus('stopped')
      addLog(`HDC 服务状态检查失败`, 'error')
    }

    // 获取鸿蒙设备列表
    try {
      const devices = await App.ListDevicesWithInfo()
      const harmonyDevices: Device[] = devices
        .filter(d => d.status === 'Connected')
        .map(d => ({
          ...d,
          platform: 'harmonyos' as Platform
        }))
      setHdcDevices(harmonyDevices)
      addLog(`发现 ${harmonyDevices.length} 个鸿蒙设备`, harmonyDevices.length > 0 ? 'success' : 'info')
    } catch (error) {
      addLog(`获取鸿蒙设备列表失败`, 'error')
    }

    addLog('鸿蒙诊断完成', 'success')
  }

  // 运行 ADB 诊断
  const runAdbDiagnostics = async (): Promise<void> => {
    // 检查 ADB 版本
    try {
      const versionResult = await App.GetAdbVersion()
      if (versionResult && versionResult !== 'Unknown') {
        setAdbVersion(versionResult)
        addLog(`ADB 版本: ${versionResult}`, 'success')
      } else {
        addLog(`无法获取 ADB 版本`, 'error')
      }
    } catch (error) {
      addLog(`获取 ADB 版本失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error')
    }

    // 检查服务状态（尝试 start-server）
    try {
      await App.AdbStartServer()
      setAdbStatus('running')
      addLog('ADB 服务运行中', 'success')
    } catch (error) {
      setAdbStatus('stopped')
      addLog('ADB 服务未运行', 'error')
    }

    // 获取安卓设备列表
    try {
      const devices = await App.ListAdbDevices(true)
      setAdbDevices(devices)
      addLog(`发现 ${devices.length} 个安卓设备`, devices.length > 0 ? 'success' : 'info')
    } catch (error) {
      addLog(`获取安卓设备列表失败`, 'error')
    }

    addLog('安卓诊断完成', 'success')
  }

  // 重启 HDC 服务
  const restartHdcService = async (): Promise<void> => {
    setIsRestartingHdc(true)
    addLog('正在重启 HDC 服务...', 'info')

    try {
      // 先终止再启动
      await App.KillServer()
      await new Promise(resolve => setTimeout(resolve, 500))
      const result = await App.StartServer()

      if (result.success) {
        setHdcStatus('running')
        addLog('HDC 服务已重启', 'success')
        // 刷新设备列表
        setTimeout(async () => {
          await runHdcDiagnostics()
          await refreshDevices()
        }, 500)
      } else {
        addLog(`重启失败: ${result.error || '未知错误'}`, 'error')
      }
    } catch (error) {
      addLog(`重启出错: ${error instanceof Error ? error.message : '未知错误'}`, 'error')
    } finally {
      setIsRestartingHdc(false)
    }
  }

  // 重启 ADB 服务
  const restartAdbService = async (): Promise<void> => {
    setIsRestartingAdb(true)
    addLog('正在重启 ADB 服务...', 'info')

    try {
      // 先终止再启动
      await App.AdbKillServer()
      await new Promise(resolve => setTimeout(resolve, 500))
      const result = await App.AdbStartServer()

      if (result.success) {
        setAdbStatus('running')
        addLog('ADB 服务已重启', 'success')
        // 刷新设备列表
        setTimeout(async () => {
          await runAdbDiagnostics()
          await refreshDevices()
        }, 500)
      } else {
        addLog(`重启失败: ${result.error || '未知错误'}`, 'error')
      }
    } catch (error) {
      addLog(`重启出错: ${error instanceof Error ? error.message : '未知错误'}`, 'error')
    } finally {
      setIsRestartingAdb(false)
    }
  }

  // 刷新所有
  const handleRefreshAll = async (): Promise<void> => {
    await runDiagnostics()
    await refreshDevices()
  }

  // 合并设备列表
  const allDevices = [...hdcDevices, ...adbDevices]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl [&>button]:hidden">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <DialogTitle>连接诊断</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div className="space-y-4">
          {/* HDC 状态行 */}
          <div className="flex items-stretch gap-3">
            <div className="grid grid-cols-3 gap-3 flex-1">
              <Card className="bg-secondary/30">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Circle
                      className="h-2.5 w-2.5"
                      style={{
                        fill: hdcStatus === 'running' ? '#22c55e' : '#ef4444',
                        color: hdcStatus === 'running' ? '#22c55e' : '#ef4444'
                      }}
                    />
                    <span className="text-sm font-medium">鸿蒙HDC守护进程</span>
                  </div>
                  <span className="text-base font-semibold">
                    {hdcStatus === 'running' ? '运行中' : '已停止'}
                  </span>
                </CardContent>
              </Card>

              <Card className="bg-secondary/30">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Circle className="h-2.5 w-2.5" style={{ fill: hdcDevices.length > 0 ? '#22c55e' : '#94a3b8', color: hdcDevices.length > 0 ? '#22c55e' : '#94a3b8' }} />
                    <span className="text-sm font-medium">设备连接数</span>
                  </div>
                  <span className="text-base font-semibold">{hdcDevices.length} 个设备</span>
                </CardContent>
              </Card>

              <Card className="bg-secondary/30">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Circle className="h-2.5 w-2.5" style={{ fill: '#3b82f6', color: '#3b82f6' }} />
                    <span className="text-sm font-medium">HDC 版本</span>
                  </div>
                  <span className="text-base font-semibold">{hdcVersion}</span>
                </CardContent>
              </Card>
            </div>
            <div className="flex flex-col gap-2 justify-center">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={restartHdcService}
                disabled={isRestartingHdc || isRefreshing}
              >
                {isRestartingHdc ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Power className="h-3.5 w-3.5" />
                )}
                重启 HDC 服务
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleRefreshAll}
                disabled={isRefreshing || isLoading}
              >
                {isRefreshing || isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                刷新
              </Button>
            </div>
          </div>

          {/* ADB 状态行 */}
          <div className="flex items-stretch gap-3">
            <div className="grid grid-cols-3 gap-3 flex-1">
              <Card className="bg-secondary/30">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Circle
                      className="h-2.5 w-2.5"
                      style={{
                        fill: adbStatus === 'running' ? '#22c55e' : '#ef4444',
                        color: adbStatus === 'running' ? '#22c55e' : '#ef4444'
                      }}
                    />
                    <span className="text-sm font-medium">安卓ADB守护进程</span>
                  </div>
                  <span className="text-base font-semibold">
                    {adbStatus === 'running' ? '运行中' : '已停止'}
                  </span>
                </CardContent>
              </Card>

              <Card className="bg-secondary/30">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Circle className="h-2.5 w-2.5" style={{ fill: adbDevices.length > 0 ? '#22c55e' : '#94a3b8', color: adbDevices.length > 0 ? '#22c55e' : '#94a3b8' }} />
                    <span className="text-sm font-medium">设备连接数</span>
                  </div>
                  <span className="text-base font-semibold">{adbDevices.length} 个设备</span>
                </CardContent>
              </Card>

              <Card className="bg-secondary/30">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Circle className="h-2.5 w-2.5" style={{ fill: '#3b82f6', color: '#3b82f6' }} />
                    <span className="text-sm font-medium">ADB 版本</span>
                  </div>
                  <span className="text-base font-semibold">{adbVersion}</span>
                </CardContent>
              </Card>
            </div>
            <div className="flex flex-col gap-2 justify-center">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={restartAdbService}
                disabled={isRestartingAdb || isRefreshing}
              >
                {isRestartingAdb ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Power className="h-3.5 w-3.5" />
                )}
                重启 ADB 服务
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleRefreshAll}
                disabled={isRefreshing || isLoading}
              >
                {isRefreshing || isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                刷新
              </Button>
            </div>
          </div>

          {/* 设备列表 */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">设备列表:</h4>
            <Card className="bg-secondary/20">
              <CardContent className="p-0">
                {allDevices.length === 0 ? (
                  <div className="px-4 py-6 text-center text-muted-foreground">
                    未发现任何设备
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {allDevices.map((device) => (
                      <div
                        key={device.connectKey}
                        className="flex items-center justify-between px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <img 
                            src={device.platform === 'harmonyos' ? harmonyosIcon : androidosIcon} 
                            alt={device.platform === 'harmonyos' ? 'HarmonyOS' : 'Android'} 
                            className="h-5 w-5"
                          />
                          <div className="flex flex-col">
                            {device.productName ? (
                              <span className="text-sm font-medium">
                                {device.productName}
                                {device.model && ` - ${device.model}`}
                              </span>
                            ) : (
                              <span className="text-sm font-medium">{device.connectKey}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant="outline">
                            {device.connectionType === 'USB' ? (
                              <span className="flex items-center gap-1">
                                <Usb className="h-3 w-3" /> USB
                              </span>
                            ) : (
                              <span className="flex items-center gap-1">
                                <Wifi className="h-3 w-3" /> TCP
                              </span>
                            )}
                          </Badge>
                          <Badge
                            variant={
                              device.status === 'Connected'
                                ? 'success'
                                : device.status === 'Unauthorized'
                                  ? 'warning'
                                  : 'destructive'
                            }
                          >
                            {device.status === 'Connected'
                              ? '已连接'
                              : device.status === 'Unauthorized'
                                ? '未授权'
                                : device.status === 'Offline'
                                  ? '离线'
                                  : '未知'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 诊断日志 */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">诊断日志</h4>
            <Card className="bg-secondary/20">
              <ScrollArea className="h-[150px]">
                <CardContent className="p-3 font-mono text-xs space-y-0">
                  {diagLogs.length === 0 ? (
                    <div className="text-muted-foreground text-center py-4">
                      点击刷新按钮开始诊断
                    </div>
                  ) : (
                    diagLogs.map((log, index) => (
                      <div
                        key={index}
                        className={`flex ${
                          log.type === 'error'
                            ? 'text-red-400'
                            : log.type === 'success'
                              ? 'text-green-400'
                              : ''
                        }`}
                      >
                        <span className="text-muted-foreground">[{log.time}]</span>
                        <span className="ml-2">{log.message}</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </ScrollArea>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
