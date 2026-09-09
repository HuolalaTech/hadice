import React, { useEffect, useState, useRef } from 'react'
import { Cpu, MemoryStick, Wifi, Monitor } from 'lucide-react'
import { ANIMATION_CONFIG } from '@/hooks/useChartAnimation'
import { formatBytes } from '@/lib/format'
import type { CardAnimations } from '@/hooks/useChartAnimation'
import type {
  CpuDetailInfo,
  MemoryDetailInfo,
  GraphicsInfo
} from '@/types/hdc'

/**
 * 概览卡片组件 - 使用 memo 优化，避免不必要的重新渲染
 * 添加动画效果：数值变化时的过渡动画和图标脉冲动画
 */
const OverviewCard = React.memo(function OverviewCard({
  icon: Icon,
  title,
  value,
  subValue,
  color,
  animate = false
}: {
  icon: React.ElementType
  title: string
  value: string
  subValue?: string
  color: string
  animate?: boolean
}): React.JSX.Element {
  const prevValueRef = useRef(value)
  const [isAnimating, setIsAnimating] = useState(false)

  // 检测数值变化，触发动画
  useEffect(() => {
    if (value !== prevValueRef.current && animate) {
      setIsAnimating(true)
      const timer = setTimeout(() => setIsAnimating(false), ANIMATION_CONFIG.duration)
      prevValueRef.current = value
      return () => clearTimeout(timer)
    }
    prevValueRef.current = value
    return undefined
  }, [value, animate])

  return (
    <div
      className="flex items-center gap-4 p-4 rounded-xl bg-secondary/30 border border-border/50 transition-all hover:bg-secondary/40"
      style={{ transitionDuration: '500ms', transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)' }}
    >
      <div
        className={`p-3 rounded-xl ${color} flex-shrink-0 transition-all ${
          isAnimating ? 'scale-110 animate-pulse' : 'scale-100'
        }`}
        style={{
          transitionDuration: `${ANIMATION_CONFIG.duration}ms`,
          transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        <Icon
          className={`h-5 w-5 text-white transition-transform ${
            isAnimating ? 'rotate-12' : 'rotate-0'
          }`}
          style={{
            transitionDuration: `${ANIMATION_CONFIG.duration}ms`,
            transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground mb-0.5">{title}</p>
        <p
          className={`text-xl font-bold font-mono leading-tight transition-all ${
            isAnimating ? 'scale-105 text-primary' : 'scale-100'
          }`}
          style={{
            transitionDuration: `${ANIMATION_CONFIG.duration}ms`,
            transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
          }}
          key={value} // 使用 key 触发重新渲染，配合 CSS transition
        >
          {value}
        </p>
        {subValue && (
          <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{subValue}</p>
        )}
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // 自定义比较函数，只在关键属性变化时重新渲染
  return (
    prevProps.value === nextProps.value &&
    prevProps.subValue === nextProps.subValue &&
    prevProps.animate === nextProps.animate
  )
})

/**
 * 性能概览卡片组件
 */
export function PerformanceOverviewCards({
  cpuInfo,
  memoryInfo,
  graphicsInfo,
  networkSpeed,
  currentFps,
  uptime,
  cardAnimations
}: {
  cpuInfo: CpuDetailInfo | null
  memoryInfo: MemoryDetailInfo | null
  graphicsInfo: GraphicsInfo | null
  networkSpeed: { rx: number; tx: number }
  currentFps: number
  uptime: { uptime: string; uptimeDays: number; loadAverage: string }
  cardAnimations: CardAnimations
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-4 gap-4 mb-4 flex-shrink-0">
      <OverviewCard
        icon={Cpu}
        title="CPU 使用率"
        value={`${cpuInfo?.total.toFixed(1) || 0}%`}
        subValue={`负载: ${uptime.loadAverage || '-'}`}
        color="bg-orange-500"
        animate={cardAnimations.cpu}
      />
      <OverviewCard
        icon={MemoryStick}
        title="内存使用"
        value={`${formatBytes(memoryInfo?.used || 0)}`}
        subValue={`总计: ${formatBytes(memoryInfo?.total || 0)} | Swap: ${formatBytes(memoryInfo?.swapUsed || 0)}`}
        color="bg-cyan-500"
        animate={cardAnimations.memory}
      />
      <OverviewCard
        icon={Wifi}
        title="网络速率"
        value={`↓${formatBytes(networkSpeed.rx)}/s`}
        subValue={`↑${formatBytes(networkSpeed.tx)}/s`}
        color="bg-blue-500"
        animate={cardAnimations.network}
      />
      <OverviewCard
        icon={Monitor}
        title="帧率"
        value={`${currentFps}FPS`}
        subValue={`GPU: ${graphicsInfo?.gpuRenderer || '-'}`}
        color="bg-purple-500"
        animate={cardAnimations.fps}
      />
    </div>
  )
}

