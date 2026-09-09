import React, { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  ReferenceLine,
  ComposedChart
} from 'recharts'
import { Cpu, MemoryStick, Wifi, Monitor, Battery, HardDrive, Zap, Activity, AlertTriangle, HardDriveDownload, Loader2 } from 'lucide-react'
import { formatBytes } from '@/lib/format'

const TOOLTIP_STYLE = { backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', fontSize: '10px', lineHeight: '14px', padding: '4px 6px' }
import { ANIMATION_CONFIG } from '@/hooks/useChartAnimation'
import { useDeviceStore } from '@/store/deviceStore'
import type { PerformanceHistory, ProcessPerformanceEntry, CpuFreqHistory, ProcessMemoryHistory, ProcessIOHistory, IpcHistory } from '@/hooks/usePerformanceData'
import { PROCESS_COLORS, MEMORY_CATEGORY_COLORS } from '@/hooks/usePerformanceData'
import type {
  CpuDetailInfo,
  MemoryDetailInfo,
  BatteryInfo,
  StorageInfo,
  GraphicsInfo,
  CpuFreqInfo,
  ProcessMemoryDetail,
  FaultLogEntry,
  ProcessIOInfo,
  IpcStatInfo
} from '@/types/hdc'

/**
 * 从进程历史中提取进程名映射
 */
function getProcessNames(
  processData: ProcessPerformanceEntry[],
  pids: number[]
): Map<number, string> {
  const names = new Map<number, string>()
  const lastEntry = processData[processData.length - 1]
  if (lastEntry) {
    for (const pid of pids) {
      names.set(pid, lastEntry.processes[pid]?.command || `PID:${pid}`)
    }
  }
  return names
}

/**
 * 将进程历史转为扁平图表数据
 */
function transformProcessData(
  processData: ProcessPerformanceEntry[],
  pids: number[],
  field: 'cpuPercent' | 'memPercent' | 'memMB',
  keyPrefix: string
): Record<string, unknown>[] {
  return processData.map(entry => {
    const point: Record<string, unknown> = { time: entry.time }
    let total = 0
    for (const pid of pids) {
      const val = entry.processes[pid]?.[field] || 0
      point[`${keyPrefix}_${pid}`] = val
      total += val
    }
    point[`${keyPrefix}_total`] = Math.round(total * 10) / 10
    return point
  })
}

/**
 * CPU 图表组件 — 统一 3 线模式（总计/用户/内核）
 */
export function CpuChart({
  data,
  cpuInfo,
  isAnimationActive,
  processData,
  selectedPids
}: {
  data: PerformanceHistory[]
  cpuInfo: CpuDetailInfo | null
  isAnimationActive: boolean
  processData?: ProcessPerformanceEntry[]
  selectedPids?: number[]
}): React.JSX.Element {
  const hasProcessData = processData && selectedPids && selectedPids.length > 0 && processData.length > 0

  // 进程模式：汇总选中进程的 Total/User/Kernel
  if (hasProcessData) {
    const chartData = processData.map(entry => {
      let total = 0, user = 0, kernel = 0
      for (const pid of selectedPids) {
        const p = entry.processes[pid]
        if (p) {
          total += p.cpuPercent
          user += p.cpuUser
          kernel += p.cpuKernel
        }
      }
      return { time: entry.time, cpuTotal: Math.round(total * 10) / 10, cpuUser: Math.round(user * 10) / 10, cpuKernel: Math.round(kernel * 10) / 10 }
    })
    const lastPoint = chartData[chartData.length - 1]

    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            CPU 使用率（按进程）
            <span className="text-xs font-normal text-muted-foreground font-mono ml-auto">
              合计: {lastPoint?.cpuTotal}%
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%" key="cpu-process-chart">
              <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }} syncId="performance-charts">
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="time" stroke="#666" fontSize={10} interval="preserveStartEnd" />
                <YAxis stroke="#666" fontSize={10} domain={[0, 'auto']} tickFormatter={(v: number) => `${Math.round(v)}%`} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#888', fontSize: '10px' }} formatter={(value: number) => `${Math.round(value * 10) / 10}%`} />

                <Line type="monotone" dataKey="cpuTotal" name="总计" stroke="#f97316" strokeWidth={2} dot={false} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
                <Line type="monotone" dataKey="cpuUser" name="用户" stroke="#22c55e" strokeWidth={1.5} dot={false} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
                <Line type="monotone" dataKey="cpuKernel" name="内核" stroke="#8b5cf6" strokeWidth={1.5} dot={false} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    )
  }

  // 全局模式：3 线折线图
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            CPU 使用率
          </span>
          <span className="text-xs font-normal text-muted-foreground font-mono">
            {cpuInfo?.loadAverage.one.toFixed(2)} / {cpuInfo?.loadAverage.five.toFixed(2)} /{' '}
            {cpuInfo?.loadAverage.fifteen.toFixed(2)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%" key="cpu-chart">
            <LineChart
              data={data}
              margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
              syncId="performance-charts"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="time" stroke="#666" fontSize={10} interval="preserveStartEnd" />
              <YAxis stroke="#666" fontSize={10} domain={[0, 100]} tickFormatter={(v: number) => `${Math.round(v)}%`} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: '#888' }}
                formatter={(value: number) => `${Math.round(value)}%`}
              />
              <Line type="monotone" dataKey="cpuTotal" name="总计" stroke="#f97316" strokeWidth={2} dot={false} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
              <Line type="monotone" dataKey="cpuUser" name="用户" stroke="#22c55e" strokeWidth={1.5} dot={false} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
              <Line type="monotone" dataKey="cpuKernel" name="内核" stroke="#8b5cf6" strokeWidth={1.5} dot={false} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * 内存图表组件
 */
export function MemoryChart({
  data,
  memoryInfo,
  isAnimationActive,
  processMemoryHistory,
  processMemoryDetail,
  selectedPids
}: {
  data: PerformanceHistory[]
  memoryInfo: MemoryDetailInfo | null
  isAnimationActive: boolean
  processMemoryHistory?: ProcessMemoryHistory[]
  processMemoryDetail?: ProcessMemoryDetail | null
  selectedPids?: number[]
}): React.JSX.Element {
  const hasProcessData = processMemoryHistory && selectedPids && selectedPids.length > 0 && processMemoryHistory.length > 0

  // 进程模式：按内存分类堆叠面积图
  if (hasProcessData && processMemoryDetail) {
    // 获取所有分类名称（按 PSS 降序）
    const lastEntry = processMemoryHistory[processMemoryHistory.length - 1]
    const sortedCategories = Object.entries(lastEntry.categories)
      .sort(([, a], [, b]) => b - a)
      .map(([name]) => name)

    const totalPssMB = Math.round(processMemoryDetail.totalPss / 1024)

    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <MemoryStick className="h-4 w-4" />
            内存详情（按分类）
            <span className="text-xs font-normal text-muted-foreground font-mono ml-auto">
              PSS: {totalPssMB}MB
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%" key="memory-category-chart">
              <ComposedChart
                data={processMemoryHistory}
                margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
                syncId="performance-charts"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="time" stroke="#666" fontSize={10} interval="preserveStartEnd" />
                <YAxis stroke="#666" fontSize={10} domain={[0, 'auto']} tickFormatter={(v: number) => `${Math.round(v)}MB`} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: '#888', fontSize: '10px' }}
                  formatter={(value: number) => `${Math.round(value * 10) / 10}MB`}
                />

                {sortedCategories.map((cat) => (
                  <Area
                    key={cat}
                    type="monotone"
                    dataKey={`categories.${cat}`}
                    name={cat}
                    stroke={MEMORY_CATEGORY_COLORS[cat] || '#6b7280'}
                    fill={MEMORY_CATEGORY_COLORS[cat] || '#6b7280'}
                    fillOpacity={0.4}
                    stackId="mem-categories"
                    isAnimationActive={isAnimationActive}
                    animationDuration={ANIMATION_CONFIG.duration}
                    animationEasing={ANIMATION_CONFIG.easing}
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey="totalPss"
                  name="总 PSS"
                  stroke="#ffffff"
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="5 3"
                  isAnimationActive={isAnimationActive}
                  animationDuration={ANIMATION_CONFIG.duration}
                  animationEasing={ANIMATION_CONFIG.easing}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {processMemoryDetail && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
              {processMemoryDetail.swapUsed > 0 && <span>Swap: {Math.round(processMemoryDetail.swapUsed / 1024)}MB</span>}
              {processMemoryDetail.heapSize > 0 && <span>Heap: {Math.round(processMemoryDetail.heapSize / 1024)}MB(已分配{Math.round(processMemoryDetail.heapAlloc / 1024)}MB)</span>}
              {processMemoryDetail.dma > 0 && <span>DMA: {Math.round(processMemoryDetail.dma / 1024)}MB</span>}
              {processMemoryDetail.ashmem > 0 && <span>Ashmem: {Math.round(processMemoryDetail.ashmem / 1024)}MB</span>}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  // 整机模式：面积图（MB 单位）
  // memUsed 是字节数，转换为 MB
  const chartDataMB = data.map(d => ({ ...d, memUsedMB: Math.round((d.memUsed || 0) / (1024 * 1024)) }))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <MemoryStick className="h-4 w-4" />
            内存使用
          </span>
          <span className="text-xs font-normal text-muted-foreground font-mono">
            {formatBytes(memoryInfo?.used || 0)} /{' '}
            {formatBytes(memoryInfo?.total || 0)}
            {memoryInfo?.swapUsed
              ? ` + Swap: ${formatBytes(memoryInfo.swapUsed)}`
              : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%" key="memory-chart">
            <AreaChart
              data={chartDataMB}
              margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
              syncId="performance-charts"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="time" stroke="#666" fontSize={10} interval="preserveStartEnd" />
              <YAxis stroke="#666" fontSize={10} domain={[0, 'auto']} tickFormatter={(v: number) => `${Math.round(v)}MB`} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number) => `${Math.round(value)}MB`}
              />
              <Area
                type="monotone"
                dataKey="memUsedMB"
                name="内存使用"
                stroke="#06b6d4"
                fill="#06b6d4"
                fillOpacity={0.3}
                isAnimationActive={isAnimationActive}
                animationDuration={ANIMATION_CONFIG.duration}
                animationEasing={ANIMATION_CONFIG.easing}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * 网络速率图表组件
 */
export function NetworkChart({
  data,
  totalNetworkTraffic,
  isAnimationActive
}: {
  data: PerformanceHistory[]
  totalNetworkTraffic: { rx: number; tx: number }
  isAnimationActive: boolean
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Wifi className="h-4 w-4" />
            网络速率
          </span>
          <span className="text-xs font-normal text-muted-foreground font-mono">
            累计: ↓{formatBytes(totalNetworkTraffic.rx)} ↑{formatBytes(totalNetworkTraffic.tx)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3 flex flex-col">
        <div className="h-[198px]">
          <ResponsiveContainer width="100%" height="100%" key="network-chart">
            <AreaChart
              data={data}
              margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
              syncId="performance-charts"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="time" stroke="#666" fontSize={10} interval="preserveStartEnd" />
              <YAxis stroke="#666" fontSize={10} tickFormatter={(v) => formatBytes(v)} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number) => formatBytes(value) + '/s'}
              />
              <Area
                type="monotone"
                dataKey="networkRx"
                name="下载"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.3}
                isAnimationActive={isAnimationActive}
                animationDuration={ANIMATION_CONFIG.duration}
                animationEasing={ANIMATION_CONFIG.easing}
              />
              <Area
                type="monotone"
                dataKey="networkTx"
                name="上传"
                stroke="#22c55e"
                fill="#22c55e"
                fillOpacity={0.3}
                isAnimationActive={isAnimationActive}
                animationDuration={ANIMATION_CONFIG.duration}
                animationEasing={ANIMATION_CONFIG.easing}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * FPS 图表组件
 */
export function FpsChart({
  data,
  graphicsInfo,
  currentFps,
  isAnimationActive
}: {
  data: PerformanceHistory[]
  graphicsInfo: GraphicsInfo | null
  currentFps: number
  isAnimationActive: boolean
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            帧率 (FPS)
          </span>
          <span className="text-xs font-normal text-muted-foreground font-mono">
            GPU: {graphicsInfo?.gpuRenderer || '-'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%" key="fps-chart">
            <BarChart
              data={data}
              margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
              syncId="performance-charts"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="time" stroke="#666" fontSize={10} interval="preserveStartEnd" />
              <YAxis stroke="#666" fontSize={10} domain={[0, 'auto']} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number) => `${value} FPS`}
              />
              <Bar
                dataKey="fps"
                name="帧率"
                fill="#a855f7"
                radius={[2, 2, 0, 0]}
                isAnimationActive={isAnimationActive}
                animationDuration={ANIMATION_CONFIG.duration}
                animationEasing={ANIMATION_CONFIG.easing}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* FPS 统计信息 */}
        <div className="flex justify-between mt-3 pt-3 border-t border-border/50 text-xs">
          <div className="text-center">
            <p className="text-muted-foreground">当前</p>
            <p className="font-mono font-bold text-sm">{currentFps} FPS</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">60Hz 帧数</p>
            <p className="font-mono font-bold text-sm">
              {(graphicsInfo?.fpsCount.fps60 || 0).toLocaleString()}
            </p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">90Hz 帧数</p>
            <p className="font-mono font-bold text-sm">
              {(graphicsInfo?.fpsCount.fps90 || 0).toLocaleString()}
            </p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">120Hz 帧数</p>
            <p className="font-mono font-bold text-sm">
              {(graphicsInfo?.fpsCount.fps120 || 0).toLocaleString()}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * 存储信息组件
 */
export function StorageCard({
  storageInfo,
  graphicsInfo
}: {
  storageInfo: StorageInfo | null
  graphicsInfo: GraphicsInfo | null
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            存储使用
          </span>
          <span className="text-xs font-normal text-muted-foreground font-mono">
            {storageInfo?.usedPercent || 0}% 已用
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        {/* 存储使用进度条 */}
        <div className="mb-4">
          <div className="h-4 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all"
              style={{ width: `${storageInfo?.usedPercent || 0}%` }}
            />
          </div>
        </div>

        {/* 存储详情 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">总容量</span>
              <span className="font-mono">{storageInfo?.total || '-'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">已使用</span>
              <span className="font-mono">{storageInfo?.used || '-'}</span>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">可用空间</span>
              <span className="font-mono">{storageInfo?.available || '-'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">图形内存</span>
              <span className="font-mono">
                {formatBytes((graphicsInfo?.surfaceMemory || 0) * 1024)}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * 电池图表组件
 */
export function BatteryChart({
  data,
  batteryInfo,
  isAnimationActive
}: {
  data: PerformanceHistory[]
  batteryInfo: BatteryInfo | null
  isAnimationActive: boolean
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Battery className="h-4 w-4" />
            电池状态
          </span>
          <span className="text-xs font-normal text-muted-foreground font-mono flex items-center gap-1">
            {batteryInfo?.chargingStatus === 'charging' ? (
              <>
                <Zap className="h-3 w-3" />
                充电中
              </>
            ) : batteryInfo?.chargingStatus === 'full' ? (
              <>
                <Battery className="h-3 w-3" />
                已充满
              </>
            ) : (
              <>
                <Battery className="h-3 w-3" />
                放电中
              </>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%" key="battery-chart">
            <LineChart
              data={data}
              margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
              syncId="performance-charts"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="time" stroke="#666" fontSize={10} interval="preserveStartEnd" />
              <YAxis yAxisId="left" stroke="#22c55e" fontSize={10} domain={[0, 100]} />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#ef4444"
                fontSize={10}
                domain={[0, 50]}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="batteryCapacity"
                name="电量 %"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
                isAnimationActive={isAnimationActive}
                animationDuration={ANIMATION_CONFIG.duration}
                animationEasing={ANIMATION_CONFIG.easing}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="batteryTemperature"
                name="温度 °C"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
                isAnimationActive={isAnimationActive}
                animationDuration={ANIMATION_CONFIG.duration}
                animationEasing={ANIMATION_CONFIG.easing}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * CPU 频率图表组件
 */
export function CpuFreqChart({
  data,
  cpuFreqInfo,
  isAnimationActive
}: {
  data: CpuFreqHistory[]
  cpuFreqInfo: CpuFreqInfo | null
  isAnimationActive: boolean
}): React.JSX.Element {
  let bigCur = 0, bigMax = 0, midCur = 0, midMax = 0, littleCur = 0, littleMax = 0
  if (cpuFreqInfo?.cores) {
    for (const c of cpuFreqInfo.cores) {
      if (c.core >= 10) { bigCur = Math.max(bigCur, c.currentFreq); bigMax = Math.max(bigMax, c.maxFreq) }
      else if (c.core >= 4) { midCur = Math.max(midCur, c.currentFreq); midMax = Math.max(midMax, c.maxFreq) }
      else { littleCur = Math.max(littleCur, c.currentFreq); littleMax = Math.max(littleMax, c.maxFreq) }
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4" />
          CPU 频率 (MHz)
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%" key="cpufreq-chart">
            <LineChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }} syncId="performance-charts">
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="time" stroke="#666" fontSize={10} interval="preserveStartEnd" />
              <YAxis stroke="#666" fontSize={10} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#888', fontSize: '10px' }} formatter={(value: number) => `${value} MHz`} />
              <Line type="monotone" dataKey="bigCore" name="大核" stroke="#f97316" strokeWidth={1.5} dot={false} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
              <Line type="monotone" dataKey="midCore" name="中核" stroke="#06b6d4" strokeWidth={1.5} dot={false} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
              <Line type="monotone" dataKey="littleCore" name="小核" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>大核: {Math.round(bigCur / 1000)}/{Math.round(bigMax / 1000)}</span>
          <span>中核: {Math.round(midCur / 1000)}/{Math.round(midMax / 1000)}</span>
          <span>小核: {Math.round(littleCur / 1000)}/{Math.round(littleMax / 1000)}</span>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * 崩溃记录列表组件
 */
export function FaultLogList({
  faultLogs
}: {
  faultLogs: FaultLogEntry[]
}): React.JSX.Element {
  const [selectedLog, setSelectedLog] = useState<FaultLogEntry | null>(null)
  const [detailText, setDetailText] = useState<string>('')
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [copied, setCopied] = useState(false)
  const { selectedDevice } = useDeviceStore()

  const getReasonColor = (reason: string): string => {
    if (reason.includes('LowMemory')) return 'text-red-400'
    if (reason.includes('CppCrash')) return 'text-orange-400'
    if (reason.includes('ThreadBlock') || reason.includes('AppInput')) return 'text-yellow-400'
    if (reason.includes('JsError') || reason.includes('JSCrash')) return 'text-pink-400'
    return 'text-gray-400'
  }
  const getReasonDot = (reason: string): string => {
    if (reason.includes('LowMemory')) return 'bg-red-500'
    if (reason.includes('CppCrash')) return 'bg-orange-500'
    if (reason.includes('ThreadBlock') || reason.includes('AppInput')) return 'bg-yellow-500'
    if (reason.includes('JsError') || reason.includes('JSCrash')) return 'bg-pink-500'
    return 'bg-gray-500'
  }

  const handleViewDetail = useCallback(async (log: FaultLogEntry) => {
    setSelectedLog(log)
    setDetailText('')
    setCopied(false)
    setLoadingDetail(true)
    try {
      if (selectedDevice?.connectKey && log.recordId) {
        const detail = await window.hdc.getFaultLogDetail(selectedDevice.connectKey, log.recordId)
        setDetailText(detail || '该记录没有详细的 faultlog 信息')
      }
    } catch {
      setDetailText('获取详情失败')
    } finally {
      setLoadingDetail(false)
    }
  }, [selectedDevice?.connectKey])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(detailText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [detailText])

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              崩溃记录
            </span>
            <span className="text-xs font-normal text-muted-foreground">最近 {faultLogs.length} 条</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          {faultLogs.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">暂无崩溃记录</div>
          ) : (
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {faultLogs.map((log, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/50 text-xs cursor-pointer"
                  onClick={() => handleViewDetail(log)}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getReasonDot(log.reason)}`} />
                  <span className="text-muted-foreground font-mono w-16 flex-shrink-0">{log.time?.split(' ')[1] || log.time}</span>
                  <span className={`${getReasonColor(log.reason)} font-medium flex-shrink-0`}>{log.reason}</span>
                  <span className="text-muted-foreground flex-shrink-0">{log.foreground ? '✓' : '✗'}</span>
                  <span className="text-muted-foreground truncate">{log.processName}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedLog} onOpenChange={(open) => { if (!open) setSelectedLog(null) }}>
        <DialogContent className="max-w-5xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4" />
              {selectedLog?.reason} - {selectedLog?.processName}
            </DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground mb-2">
            {selectedLog?.time} | {selectedLog?.foreground ? '前台' : '后台'} | ID: {selectedLog?.recordId}
          </div>
          <div className="relative border rounded-md overflow-auto max-h-[60vh]">
            {!loadingDetail && detailText && (
              <button
                onClick={handleCopy}
                className="absolute top-2 right-2 z-10 px-2 py-1 text-xs bg-secondary/80 hover:bg-secondary rounded border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied ? '☑ 已复制' : '复制'}
              </button>
            )}
            {loadingDetail ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                加载中...
              </div>
            ) : (
              <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">{detailText}</pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * 进程 IO 监控图表组件
 */
export function ProcessIOChart({
  data,
  processIOInfo,
  isAnimationActive
}: {
  data: ProcessIOHistory[]
  processIOInfo: ProcessIOInfo | null
  isAnimationActive: boolean
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <HardDriveDownload className="h-4 w-4" />
          进程 IO 速率
          <span className="text-xs font-normal text-muted-foreground font-mono ml-auto">
            {processIOInfo ? `累计: R${formatBytes(processIOInfo.readBytes)} W${formatBytes(processIOInfo.writeBytes)}` : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%" key="process-io-chart">
            <AreaChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }} syncId="performance-charts">
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="time" stroke="#666" fontSize={10} interval="preserveStartEnd" />
              <YAxis stroke="#666" fontSize={10} tickFormatter={(v) => formatBytes(v) + '/s'} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#888', fontSize: '10px' }} formatter={(value: number) => formatBytes(value) + '/s'} />
              <Area type="monotone" dataKey="readRate" name="读取" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
              <Area type="monotone" dataKey="writeRate" name="写入" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {processIOInfo && (
          <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
            <span>系统调用 读:{processIOInfo.syscr.toLocaleString()} 写:{processIOInfo.syscw.toLocaleString()}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * IPC 通信统计图表组件
 */
export function IpcChart({
  data,
  ipcStatInfo,
  isAnimationActive
}: {
  data: IpcHistory[]
  ipcStatInfo: IpcStatInfo | null
  isAnimationActive: boolean
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4" />
          IPC 通信统计
          <span className="text-xs font-normal text-muted-foreground font-mono ml-auto">
            {ipcStatInfo ? `总调用:${ipcStatInfo.totalCount} 平均:${ipcStatInfo.totalCount > 0 ? Math.round(ipcStatInfo.totalTimeCost / ipcStatInfo.totalCount) : 0}μs` : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%" key="ipc-chart">
            <LineChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }} syncId="performance-charts">
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="time" stroke="#666" fontSize={10} interval="preserveStartEnd" />
              <YAxis yAxisId="left" stroke="#3b82f6" fontSize={10} />
              <YAxis yAxisId="right" orientation="right" stroke="#f97316" fontSize={10} tickFormatter={(v: number) => `${v}μs`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#888', fontSize: '10px' }} />
              <Line yAxisId="left" type="monotone" dataKey="callCount" name="调用次数" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
              <Line yAxisId="right" type="monotone" dataKey="avgTimeCost" name="平均耗时(μs)" stroke="#f97316" strokeWidth={1.5} dot={false} isAnimationActive={isAnimationActive} animationDuration={ANIMATION_CONFIG.duration} animationEasing={ANIMATION_CONFIG.easing} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {ipcStatInfo && ipcStatInfo.interfaces && ipcStatInfo.interfaces.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {ipcStatInfo.interfaces.slice(0, 3).map((iface, i) => (
                <span key={i} className="text-muted-foreground truncate">
                  {iface.descriptorCode.split('_').slice(-1)[0]}: {iface.count}次/{iface.avgTime}μs
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

