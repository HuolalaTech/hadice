import React, { useState, useCallback, useMemo, useEffect } from 'react'
import {
  Activity,
  Pause,
  Play,
  Download
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useDeviceStore } from '@/store/deviceStore'
import { toast } from 'sonner'
import { usePerformanceData } from '@/hooks/usePerformanceData'
import { useChartAnimation } from '@/hooks/useChartAnimation'
import { PerformanceOverviewCards } from '@/components/performance/PerformanceOverviewCards'
import {
  CpuChart,
  MemoryChart,
  NetworkChart,
  FpsChart,
  StorageCard,
  BatteryChart,
  CpuFreqChart,
  FaultLogList,
  ProcessIOChart,
  IpcChart
} from '@/components/performance/PerformanceCharts'
import { exportPerformanceToCSV } from '@/lib/performanceExport'
import { captureEvent } from '@/lib/posthog'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { NoDeviceState } from '@/components/layout/NoDeviceState'
import { ProcessFilter } from '@/components/performance/ProcessFilter'
import { isAndroidDevice } from '@/lib/hdc'
import {
  getOutputDeviceName,
  normalizeOutputPlatform
} from '@/lib/outputNaming'
import * as App from '../../bindings/Hadice/backend/appservice'

// 最大历史记录数
const MAX_HISTORY = 60
// 图表只显示最近50个数据点
const CHART_DATA_LIMIT = 50

/**
 * 性能监控页面
 */
export function PerformanceMonitorPage(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()

  // 状态
  const [isPaused, setIsPaused] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(3000) // 默认 3 秒
  const [selectedPids, setSelectedPids] = useState<number[]>([])

  // 设备切换时重置选中进程
  useEffect(() => {
    setSelectedPids([])
  }, [selectedDevice?.connectKey])

  // 使用性能数据 Hook
  const {
    cpuInfo,
    memoryInfo,
    batteryInfo,
    networkTraffic,
    storageInfo,
    graphicsInfo,
    uptime,
    history,
    networkSpeed,
    currentFps,
    processHistory,
    cpuFreqInfo,
    cpuFreqHistory,
    faultLogs,
    processMemoryDetail,
    processMemoryHistory,
    processIOInfo,
    processIOHistory,
    ipcStatInfo,
    ipcHistory
  } = usePerformanceData(refreshInterval, isPaused, MAX_HISTORY, selectedPids, () => {
    setIsPaused(true)
    toast.warning('被监控的进程已销毁，已暂停监控')
  })

  // 使用图表动画 Hook
  const { chartAnimations, cardAnimations } = useChartAnimation(
    history,
    cpuInfo,
    memoryInfo,
    networkSpeed,
    currentFps,
    batteryInfo
  )

  // 缓存图表数据，限制数据量并避免频繁更新
  const chartDataMemo = useMemo(() => {
    // 限制图表数据量，只保留最近的数据
    return history.length > CHART_DATA_LIMIT ? history.slice(-CHART_DATA_LIMIT) : history
  }, [history])

  // 导出 CSV
  const handleExportCSV = useCallback(async () => {
    try {
      captureEvent('performance data exported', { data_points: history.length })
      const savedPath = await exportPerformanceToCSV({
        platform: normalizeOutputPlatform(selectedDevice?.platform),
        deviceName: getOutputDeviceName(selectedDevice),
        history,
        cpuFreqHistory,
        processHistory,
        processMemoryHistory,
        ipcHistory,
        processIOHistory,
        faultLogs,
        selectedPids
      })
      if (savedPath) {
        const dirPath = savedPath.replace(/[\\/][^\\/]+$/, '')
        toast.success('性能数据已导出', {
          description: savedPath,
          action: {
            label: '打开目录',
            onClick: () => App.OpenFolder(dirPath).catch(console.error)
          },
          duration: 8000
        })
      }
    } catch (err) {
      toast.error('导出失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [selectedDevice, history, cpuFreqHistory, processHistory, processMemoryHistory, ipcHistory, processIOHistory, faultLogs, selectedPids])

  // 计算总网络流量
  const totalNetworkTraffic = useMemo(() => {
    let rx = 0
    let tx = 0
    for (const net of networkTraffic) {
      rx += net.rxBytes
      tx += net.txBytes
    }
    return { rx, tx }
  }, [networkTraffic])


  // 未连接设备
  if (!selectedDevice) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Activity className="h-6 w-6 text-primary" />
            性能监控
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

  const isAndroid = isAndroidDevice(selectedDevice?.platform)

  return (
    <div className="p-6 h-full flex flex-col overflow-auto">
      {/* 标题栏和控制区 */}
      <div className="mb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          性能监控
          <WindowToggleButton />
            <HelpToggleButton />
        </h1>
        <div className="flex items-center gap-3">
          {/* 进程筛选 */}
          <ProcessFilter
            selectedPids={selectedPids}
            onSelectionChange={setSelectedPids}
            disabled={!selectedDevice}
          />

          {/* 刷新间隔 */}
          <Select
            value={String(refreshInterval)}
            onValueChange={(v) => setRefreshInterval(parseInt(v))}
          >
            <SelectTrigger className="w-24 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3000">3 秒</SelectItem>
              <SelectItem value="6000">6 秒</SelectItem>
              <SelectItem value="10000">10 秒</SelectItem>
            </SelectContent>
          </Select>

          {/* 暂停/继续 */}
          <Button
            variant={isPaused ? 'default' : 'outline'}
            size="sm"
            onClick={() => setIsPaused(!isPaused)}
            className="gap-2"
          >
            {isPaused ? (
              <>
                <Play className="h-4 w-4" />
                继续
              </>
            ) : (
              <>
                <Pause className="h-4 w-4" />
                暂停
              </>
            )}
          </Button>

          {/* 导出 */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={history.length === 0}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            导出 CSV
          </Button>
        </div>
      </div>

      {/* 实时概览卡片 */}
      <PerformanceOverviewCards
        cpuInfo={cpuInfo}
        memoryInfo={memoryInfo}
        graphicsInfo={graphicsInfo}
        networkSpeed={networkSpeed}
        currentFps={currentFps}
        uptime={uptime}
        cardAnimations={cardAnimations}
      />

      {/* 图表卡片 - 按2列流式排列，安卓隐藏IPC/IO后自动前移补位 */}
      <div className="grid grid-cols-2 gap-4 mb-4 flex-shrink-0">
        <CpuChart
          data={chartDataMemo}
          cpuInfo={cpuInfo}
          isAnimationActive={chartAnimations.cpu}
          processData={processHistory}
          selectedPids={selectedPids}
        />
        <MemoryChart
          data={chartDataMemo}
          memoryInfo={memoryInfo}
          isAnimationActive={chartAnimations.memory}
          processMemoryHistory={processMemoryHistory}
          processMemoryDetail={processMemoryDetail}
          selectedPids={selectedPids}
        />
        <CpuFreqChart
          data={cpuFreqHistory.length > CHART_DATA_LIMIT ? cpuFreqHistory.slice(-CHART_DATA_LIMIT) : cpuFreqHistory}
          cpuFreqInfo={cpuFreqInfo}
          isAnimationActive={chartAnimations.cpu}
        />
        {!isAndroid && (
          <IpcChart
            data={ipcHistory.length > CHART_DATA_LIMIT ? ipcHistory.slice(-CHART_DATA_LIMIT) : ipcHistory}
            ipcStatInfo={ipcStatInfo}
            isAnimationActive={chartAnimations.network}
          />
        )}
        <NetworkChart
          data={chartDataMemo}
          totalNetworkTraffic={totalNetworkTraffic}
          isAnimationActive={chartAnimations.network}
        />
        <FpsChart
          data={chartDataMemo}
          graphicsInfo={graphicsInfo}
          currentFps={currentFps}
          isAnimationActive={chartAnimations.fps}
        />
        <BatteryChart
          data={chartDataMemo}
          batteryInfo={batteryInfo}
          isAnimationActive={chartAnimations.battery}
        />
        <StorageCard storageInfo={storageInfo} graphicsInfo={graphicsInfo} />
        {!isAndroid && selectedPids.length > 0 && (
          <ProcessIOChart
            data={processIOHistory.length > CHART_DATA_LIMIT ? processIOHistory.slice(-CHART_DATA_LIMIT) : processIOHistory}
            processIOInfo={processIOInfo}
            isAnimationActive={chartAnimations.network}
          />
        )}
        <FaultLogList faultLogs={faultLogs} />
      </div>
    </div>
  )
}
