import { useState, useRef, useEffect } from 'react'
import type { PerformanceHistory } from './usePerformanceData'

/**
 * 动画配置：优化动画时长和缓动函数
 */
export const ANIMATION_CONFIG = {
  duration: 600, // 动画时长 600ms，更平缓自然
  easing: 'ease' as const // 使用 ease 缓动，Recharts 支持的标准缓动函数
}

/**
 * 变化阈值配置
 */
const ANIMATION_THRESHOLDS = {
  cpu: 2, // CPU 变化超过 2% 时启用动画
  memory: 2, // 内存变化超过 2% 时启用动画
  network: 10000, // 网络速率变化超过 10KB/s 时启用动画
  fps: 5, // FPS 变化超过 5 时启用动画
  battery: 2 // 电池变化超过 2% 时启用动画
}

/**
 * 图表动画状态
 */
export interface ChartAnimations {
  cpu: boolean
  memory: boolean
  network: boolean
  fps: boolean
  battery: boolean
}

/**
 * 卡片动画状态
 */
export interface CardAnimations {
  cpu: boolean
  memory: boolean
  network: boolean
  fps: boolean
}

/**
 * 使用图表动画控制 Hook
 */
export function useChartAnimation(
  history: PerformanceHistory[],
  cpuInfo: { total: number } | null,
  memoryInfo: { usedPercent: number } | null,
  networkSpeed: { rx: number; tx: number },
  currentFps: number,
  batteryInfo: { capacity: number } | null
) {
  // 动画控制：跟踪上一次的数据值，用于判断变化是否超过阈值
  const prevDataRef = useRef<{
    cpuTotal: number
    memPercent: number
    networkRx: number
    networkTx: number
    fps: number
    batteryCapacity: number
  } | null>(null)

  // 各图表独立的动画启用状态：仅在数据变化超过阈值时启用
  const [chartAnimations, setChartAnimations] = useState<ChartAnimations>({
    cpu: false,
    memory: false,
    network: false,
    fps: false,
    battery: false
  })

  // 概览卡片动画状态：用于触发图标和数值动画
  const [cardAnimations, setCardAnimations] = useState<CardAnimations>({
    cpu: false,
    memory: false,
    network: false,
    fps: false
  })

  // 更新动画状态
  useEffect(() => {
    if (!cpuInfo || !memoryInfo || !batteryInfo) {
      return
    }

    const isFirstUpdate = prevDataRef.current === null
    const prev = prevDataRef.current

    const newChartAnimations: ChartAnimations = {
      cpu:
        isFirstUpdate ||
        Math.abs(cpuInfo.total - (prev?.cpuTotal || 0)) > ANIMATION_THRESHOLDS.cpu,
      memory:
        isFirstUpdate ||
        Math.abs(memoryInfo.usedPercent - (prev?.memPercent || 0)) >
          ANIMATION_THRESHOLDS.memory,
      network:
        isFirstUpdate ||
        Math.abs(networkSpeed.rx - (prev?.networkRx || 0)) >
          ANIMATION_THRESHOLDS.network ||
        Math.abs(networkSpeed.tx - (prev?.networkTx || 0)) >
          ANIMATION_THRESHOLDS.network,
      fps:
        isFirstUpdate ||
        Math.abs(currentFps - (prev?.fps || 0)) > ANIMATION_THRESHOLDS.fps,
      battery:
        isFirstUpdate ||
        Math.abs(batteryInfo.capacity - (prev?.batteryCapacity || 0)) >
          ANIMATION_THRESHOLDS.battery
    }

    // 更新图表动画状态
    setChartAnimations(newChartAnimations)

    // 更新概览卡片动画状态（用于触发图标动画）
    setCardAnimations({
      cpu: newChartAnimations.cpu,
      memory: newChartAnimations.memory,
      network: newChartAnimations.network,
      fps: newChartAnimations.fps
    })

    // 更新上一次的数据值
    prevDataRef.current = {
      cpuTotal: cpuInfo.total,
      memPercent: memoryInfo.usedPercent,
      networkRx: networkSpeed.rx,
      networkTx: networkSpeed.tx,
      fps: currentFps,
      batteryCapacity: batteryInfo.capacity
    }
  }, [cpuInfo, memoryInfo, networkSpeed, currentFps, batteryInfo])

  // 设备切换时重置动画状态（当历史记录为空时重置）
  useEffect(() => {
    if (history.length === 0) {
      prevDataRef.current = null
      setChartAnimations({ cpu: false, memory: false, network: false, fps: false, battery: false })
      setCardAnimations({ cpu: false, memory: false, network: false, fps: false })
    }
  }, [history.length])

  return {
    chartAnimations,
    cardAnimations
  }
}

