import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  LayoutDashboard,
  Smartphone,
  Battery,
  Cpu,
  HardDrive,
  MemoryStick,
  Wifi,
  Clock,
  RefreshCw,
  Zap,
  Thermometer,
  Activity,
  Server,
  Copy
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { useDeviceStore } from '@/store/deviceStore'
import type {
  DeviceDetailInfo,
  BatteryInfo,
  MemoryInfo,
  StorageInfo,
  CpuUsageInfo,
  NetworkInfo,
  SystemRuntime
} from '@/types/hdc'
import { isHdcAvailable } from '@/lib/hdc'
import { captureEvent } from '@/lib/posthog'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { NoDeviceState } from '@/components/layout/NoDeviceState'

/**
 * 格式化内存大小
 */
function formatMemory(kb: number): string {
  if (kb >= 1024 * 1024) {
    return `${(kb / 1024 / 1024).toFixed(1)} GB`
  }
  if (kb >= 1024) {
    return `${(kb / 1024).toFixed(0)} MB`
  }
  return `${kb} KB`
}

/**
 * 进度条组件
 */
function ProgressBar({
  value,
  max = 100,
  color = 'bg-primary'
}: {
  value: number
  max?: number
  color?: string
}): React.JSX.Element {
  const percent = Math.min((value / max) * 100, 100)
  return (
    <div className="h-2 bg-secondary rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-500`}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

/**
 * 交互式UDID显示组件
 */
function UdidDisplay({ udid }: { udid: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(udid)
      captureEvent('device udid copied')
      toast.success('已复制UDID到剪贴板')
    } catch (error) {
      console.error('复制失败:', error)
      toast.error('复制失败')
    }
  }

  // 显示前11位 + 省略号
  const displayUdid = udid.length > 11 ? `${udid.substring(0, 11)}...` : udid

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCopy}
            className="font-medium text-left hover:bg-muted/50 px-1 py-0.5 rounded cursor-pointer flex items-center gap-1 group"
          >
            <span className="font-mono">{displayUdid}</span>
            <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>点击复制完整UDID</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * 圆形进度指示器
 */
function CircularProgress({
  value,
  size = 120,
  strokeWidth = 8,
  color = '#3b82f6',
  label,
  sublabel
}: {
  value: number
  size?: number
  strokeWidth?: number
  color?: string
  label: string
  sublabel?: string
}): React.JSX.Element {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (value / 100) * circumference

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-secondary"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute flex flex-col items-center font-mono">
        <span className="text-2xl font-bold">{value}%</span>
        <span className="text-xs text-muted-foreground">{label}</span>
        {sublabel && <span className="text-[10px] text-muted-foreground">{sublabel}</span>}
      </div>
    </div>
  )
}


/**
 * 设备总览页面
 */
export function DeviceOverviewPage(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()

  const [deviceInfo, setDeviceInfo] = useState<DeviceDetailInfo | null>(null)
  const [deviceUdid, setDeviceUdid] = useState<string>('')
  const [batteryInfo, setBatteryInfo] = useState<BatteryInfo | null>(null)
  const [memoryInfo, setMemoryInfo] = useState<MemoryInfo | null>(null)
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
  const [cpuInfo, setCpuInfo] = useState<CpuUsageInfo | null>(null)
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo[]>([])
  const [systemRuntime, setSystemRuntime] = useState<SystemRuntime | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const fetchDeviceData = useCallback(async () => {
    if (!selectedDevice || !isHdcAvailable()) return

    setIsLoading(true)
    try {
      const connectKey = selectedDevice.connectKey
      const platform = selectedDevice.platform as 'harmonyos' | 'android'

      const [detail, udid, battery, memory, storage, cpu, network, runtime] = await Promise.all([
        window.hdc.getDeviceDetailInfo(connectKey, platform),
        window.hdc.getDeviceUdid(connectKey, platform),
        window.hdc.getBatteryInfo(connectKey, platform),
        window.hdc.getMemoryInfo(connectKey, platform),
        window.hdc.getStorageInfo(connectKey, platform),
        window.hdc.getCpuUsageInfo(connectKey, platform),
        window.hdc.getNetworkInfo(connectKey, platform),
        window.hdc.getSystemRuntime(connectKey, platform)
      ])

      setDeviceInfo(detail)
      setDeviceUdid(udid)
      setBatteryInfo(battery)
      setMemoryInfo(memory)
      setStorageInfo(storage)
      setCpuInfo(cpu)
      setNetworkInfo(network)
      setSystemRuntime(runtime)
      setLastUpdate(new Date())
    } catch (error) {
      console.error('[DeviceOverview] Failed to fetch device data:', error)
    } finally {
      setIsLoading(false)
    }
  }, [selectedDevice])

  const pollCountRef = useRef(0)

  useEffect(() => {
    pollCountRef.current = 0
    fetchDeviceData()
    const interval = setInterval(() => {
      if (pollCountRef.current >= 3) {
        clearInterval(interval)
        return
      }
      if (selectedDevice && isHdcAvailable()) {
        const platform = selectedDevice.platform as 'harmonyos' | 'android'
        Promise.all([
          window.hdc.getBatteryInfo(selectedDevice.connectKey, platform),
          window.hdc.getMemoryInfo(selectedDevice.connectKey, platform),
          window.hdc.getCpuUsageInfo(selectedDevice.connectKey, platform),
          window.hdc.getSystemRuntime(selectedDevice.connectKey, platform)
        ]).then(([battery, memory, cpu, runtime]) => {
          setBatteryInfo(battery)
          setMemoryInfo(memory)
          setCpuInfo(cpu)
          setSystemRuntime(runtime)
          setLastUpdate(new Date())
          pollCountRef.current++
        })
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [selectedDevice, fetchDeviceData])

  if (!selectedDevice) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            设备总览
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

  const getBatteryColor = (capacity: number) => {
    if (capacity > 50) return '#22c55e'
    if (capacity > 20) return '#eab308'
    return '#ef4444'
  }

  const getChargingStatusText = (status: BatteryInfo['chargingStatus']) => {
    const map = {
      charging: '充电中',
      discharging: '放电中',
      full: '已充满',
      not_charging: '未充电',
      unknown: '未知'
    }
    return map[status] || '未知'
  }

  const getPluggedTypeText = (type: BatteryInfo['pluggedType']) => {
    const map = {
      none: '未连接电源',
      ac: 'AC 电源',
      usb: 'USB',
      wireless: '无线充电',
      unknown: '未知'
    }
    return map[type] || '未知'
  }

  return (
    <div className="p-6 h-full flex flex-col overflow-auto">
      {/* 标题栏 */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-3">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            设备总览
            <WindowToggleButton />
            <HelpToggleButton />
        </h1>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchDeviceData}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* 设备基本信息 */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            设备信息
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 font-mono text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-1">产品名称</p>
              <p className="font-medium">{deviceInfo?.productName || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">型号</p>
              <p className="font-medium">{deviceInfo?.model || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">品牌</p>
              <p className="font-medium">{deviceInfo?.brand || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">序列号</p>
              <p className="font-medium">{selectedDevice.connectKey}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">连接方式</p>
              <p className="font-medium">{selectedDevice.connectionType}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {selectedDevice.platform === 'android' ? 'Android ID' : '设备UDID'}
              </p>
              {deviceUdid ? <UdidDisplay udid={deviceUdid} /> : <p className="font-medium">-</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 实时仪表盘 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* 电池状态 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Battery className="h-4 w-4" />
              电池
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-2">
              <CircularProgress
                value={batteryInfo?.capacity || 0}
                color={getBatteryColor(batteryInfo?.capacity || 0)}
                label="电量"
              />
            </div>
            <div className="space-y-1 mt-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  状态
                </span>
                <span>{getChargingStatusText(batteryInfo?.chargingStatus || 'unknown')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">电源</span>
                <span>{getPluggedTypeText(batteryInfo?.pluggedType || 'unknown')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Thermometer className="h-3 w-3" />
                  温度
                </span>
                <span>{batteryInfo?.temperature?.toFixed(1) || '-'}°C</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">电压</span>
                <span>{batteryInfo?.voltage || '-'} mV</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CPU 使用 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              CPU
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-2">
              <CircularProgress
                value={cpuInfo?.usagePercent || 0}
                color="#8b5cf6"
                label="使用率"
              />
            </div>
            <div className="space-y-2 mt-2 font-mono">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">用户</span>
                  <span>{cpuInfo?.user || 0}%</span>
                </div>
                <ProgressBar value={cpuInfo?.user || 0} color="bg-blue-500" />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">系统</span>
                  <span>{cpuInfo?.system || 0}%</span>
                </div>
                <ProgressBar value={cpuInfo?.system || 0} color="bg-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 内存使用 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MemoryStick className="h-4 w-4" />
              内存
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-2">
              <CircularProgress
                value={memoryInfo?.usedPercent || 0}
                color="#06b6d4"
                label="使用率"
                sublabel={formatMemory(memoryInfo?.total || 0)}
              />
            </div>
            <div className="space-y-1 mt-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-muted-foreground">总计</span>
                <span>{formatMemory(memoryInfo?.total || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">可用</span>
                <span>{formatMemory(memoryInfo?.available || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">缓存</span>
                <span>{formatMemory(memoryInfo?.cached || 0)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 存储使用 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              存储
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-2">
              <CircularProgress
                value={storageInfo?.usedPercent || 0}
                color="#f59e0b"
                label="使用率"
                sublabel={storageInfo?.total || '-'}
              />
            </div>
            <div className="space-y-1 mt-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-muted-foreground">总计</span>
                <span>{storageInfo?.total || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">已用</span>
                <span>{storageInfo?.used || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">可用</span>
                <span>{storageInfo?.available || '-'}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 底部信息区 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 系统信息 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Server className="h-4 w-4" />
              系统信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm font-mono">
            <div className="flex justify-between">
              <span className="text-muted-foreground">操作系统</span>
              <span>{deviceInfo?.osName || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">系统版本</span>
              <span>{deviceInfo?.osVersion || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">API 版本</span>
              <span>{deviceInfo?.apiVersion || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">CPU 架构</span>
              <span>{deviceInfo?.cpuAbi || '-'}</span>
            </div>
          </CardContent>
        </Card>

        {/* 网络信息 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wifi className="h-4 w-4" />
              网络
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm font-mono">
            {networkInfo.length > 0 ? (
              networkInfo.map((net, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">接口</span>
                    <span>{net.interface}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IP 地址</span>
                    <span>{net.ipAddress}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MAC</span>
                    <span className="text-xs">{net.macAddress}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-center py-4">未检测到网络连接</p>
            )}
          </CardContent>
        </Card>

        {/* 运行状态 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" />
              运行状态
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm font-mono">
            <div className="flex justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                运行时间
              </span>
              <span>{systemRuntime?.uptime || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">系统时间</span>
              <span>{systemRuntime?.currentTime || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">负载均值</span>
              <span className="text-xs">{systemRuntime?.loadAverage || '-'}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
