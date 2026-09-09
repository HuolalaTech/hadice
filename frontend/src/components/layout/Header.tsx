import React, { useState, useEffect } from 'react'
import { Plus, RefreshCw, Plug, Smartphone, Wifi, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ConnectionDiagDialog } from '@/components/dialogs/ConnectionDiagDialog'
import { WirelessDebugDialog } from '@/components/dialogs/WirelessDebugDialog'
import { useDeviceStore } from '@/store/deviceStore'
import { captureEvent } from '@/lib/posthog'
import * as App from '../../../bindings/Hadice/backend/appservice'
import logoIcon from '@/assets/icon.png'
import harmonyosIcon from '@/assets/images/ic_harmonyos.png'
import androidosIcon from '@/assets/images/ic_androidos.png'

const WIRELESS_DEBUG_VALUE = '__wireless_debug__'

/**
 * 顶部导航栏组件
 * 包含 Logo、设备选择器、连接诊断、刷新按钮
 */
export function Header(): React.JSX.Element {
  const [diagOpen, setDiagOpen] = useState(false)
  const [wirelessOpen, setWirelessOpen] = useState(false)
  const [disconnectingDevice, setDisconnectingDevice] = useState<string | null>(null)

  const {
    devices,
    selectedDevice,
    isLoading,
    isRefreshing,
    selectDevice,
    refreshDevices,
    initialize
  } = useDeviceStore()

  // 初始化：加载设备列表
  useEffect(() => {
    initialize()
  }, [initialize])

  // 处理设备选择
  const handleDeviceChange = (connectKey: string): void => {
    if (connectKey === WIRELESS_DEBUG_VALUE) {
      captureEvent('wireless debug dialog opened')
      setWirelessOpen(true)
      return
    }

    const device = devices.find((d) => d.connectKey === connectKey)
    if (device) {
      selectDevice(device)
    }
  }

  // 刷新设备列表（同时刷新鸿蒙和安卓设备）
  const handleRefresh = (): void => {
    captureEvent('device list refreshed')
    refreshDevices()
  }

  const handleDisconnectWirelessDevice = async (
    event: React.PointerEvent<HTMLButtonElement>,
    device: typeof devices[0]
  ): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()

    if (disconnectingDevice) {
      return
    }

    setDisconnectingDevice(device.connectKey)
    try {
      if (device.platform === 'android') {
        await App.AdbDisconnectDevice(device.connectKey)
      } else {
        await App.DisconnectDevice(device.connectKey)
      }
      captureEvent('wireless debug disconnected', {
        platform: device.platform,
        connection_type: device.connectionType
      })
      await refreshDevices()
    } finally {
      setDisconnectingDevice(null)
    }
  }

  // 计算是否有已连接的设备
  const hasConnectedDevice = devices.some((d) => d.status === 'Connected')

  // 格式化设备显示名称：产品名称(序列号)
  const formatDeviceDisplayName = (device: typeof devices[0]): string => {
    if (device.productName) {
      return device.model ? `${device.productName} (${device.model})` : device.productName
    }
    return device.model || device.connectKey
  }

  return (
    <>
      <header className="h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 drag-region">
        <div className="flex h-full items-center justify-between px-4 no-drag">
          {/* Logo 区域 */}
          <div className="flex items-center gap-3">
            <img src={logoIcon} alt="Logo" className="h-8 w-8 rounded-lg" />
            <div className="flex flex-col">
              <span className="text-base font-semibold tracking-tight">Hadice</span>
              <span className="text-[10px] text-muted-foreground">安卓&鸿蒙调试工具</span>
            </div>
          </div>

          {/* 右侧操作区 */}
          <div className="flex items-center gap-3">
            {/* 设备选择器 */}
            <div className="flex items-center gap-2">
              <Smartphone
                className={`h-4 w-4 ${
                  hasConnectedDevice ? 'text-muted-foreground' : 'text-muted-foreground/50'
                }`}
              />
              <Select
                value={selectedDevice?.connectKey || ''}
                onValueChange={handleDeviceChange}
                disabled={isLoading}
              >
                <SelectTrigger
                  className={`w-auto min-w-[180px] max-w-[400px] h-9 ${
                    hasConnectedDevice
                      ? 'bg-secondary/50'
                      : 'bg-secondary/30'
                  }`}
                >
                  {selectedDevice ? (
                    <div className="flex items-center gap-2 min-w-0">
                      <img 
                        src={selectedDevice.platform === 'harmonyos' ? harmonyosIcon : androidosIcon} 
                        alt={selectedDevice.platform === 'harmonyos' ? 'HarmonyOS' : 'Android'} 
                        className="h-4 w-4 flex-shrink-0"
                      />
                      {selectedDevice.connectionType === 'TCP' && (
                        <Wifi className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                      )}
                      <span
                        className={`h-2 w-2 rounded-full flex-shrink-0 ${
                          selectedDevice.status === 'Connected'
                            ? 'bg-green-500'
                            : selectedDevice.status === 'Unauthorized'
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                        }`}
                      />
                      <span className="flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
                        {formatDeviceDisplayName(selectedDevice)}
                      </span>
                    </div>
                  ) : (
                    <SelectValue placeholder={isLoading ? '加载中...' : '未连接设备'} />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {devices.length === 0 && (
                    <SelectItem value="none" disabled>
                      未发现设备
                    </SelectItem>
                  )}
                  {devices.length > 0 && (
                    devices.map((device) => (
                      <SelectItem key={device.connectKey} value={device.connectKey}>
                        <div className="flex items-center gap-2 min-w-0">
                          <img 
                            src={device.platform === 'harmonyos' ? harmonyosIcon : androidosIcon} 
                            alt={device.platform === 'harmonyos' ? 'HarmonyOS' : 'Android'} 
                            className="h-4 w-4 flex-shrink-0"
                          />
                          {device.connectionType === 'TCP' && (
                            <Wifi className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                          )}
                          <span
                            className={`h-2 w-2 rounded-full flex-shrink-0 ${
                              device.status === 'Connected'
                                ? 'bg-green-500'
                                : device.status === 'Unauthorized'
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                          />
                          <span className="flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
                            {formatDeviceDisplayName(device)}
                          </span>
                          {device.connectionType === 'TCP' && (
                            <button
                              type="button"
                              className="ml-auto flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                              disabled={disconnectingDevice === device.connectKey}
                              onPointerDown={(event) => handleDisconnectWirelessDevice(event, device)}
                              aria-label="断开无线调试设备"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </SelectItem>
                    ))
                  )}
                  <SelectSeparator />
                  <SelectItem value={WIRELESS_DEBUG_VALUE}>
                    <div className="flex items-center gap-2 text-primary">
                      <Plus className="h-4 w-4" />
                      <Wifi className="h-4 w-4" />
                      <span>无线调试</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 连接诊断按钮 */}
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                captureEvent('connection diagnosed')
                setDiagOpen(true)
              }}
            >
              <Plug className="h-4 w-4" />
              <span>连接诊断</span>
            </Button>

            {/* 刷新按钮 */}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>

          </div>
        </div>
      </header>

      {/* 连接诊断弹窗 */}
      <ConnectionDiagDialog open={diagOpen} onOpenChange={setDiagOpen} />
      <WirelessDebugDialog open={wirelessOpen} onOpenChange={setWirelessOpen} />
    </>
  )
}
