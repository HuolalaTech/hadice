import { create } from 'zustand'
import type { ProcessInfo, ProcessStats } from '@/types/hdc'

interface ProcessCacheState {
  /** 进程列表缓存 */
  processes: ProcessInfo[]
  /** 进程统计信息 */
  stats: ProcessStats
  /** 最后更新时间戳 */
  lastUpdate: number
  /** 缓存过期时间（毫秒），默认 10 秒 */
  cacheExpiry: number

  /** 更新进程缓存 */
  updateProcesses: (processes: ProcessInfo[], stats: ProcessStats) => void
  /** 获取缓存的进程列表 */
  getCachedProcesses: () => ProcessInfo[]
  /** 获取缓存的统计信息 */
  getCachedStats: () => ProcessStats
  /** 清除缓存 */
  clearCache: () => void
  /** 检查缓存是否过期 */
  isExpired: () => boolean
}

/**
 * 进程缓存 Store
 * 用于全局缓存进程列表，避免重复加载
 */
export const useProcessCacheStore = create<ProcessCacheState>((set, get) => ({
  processes: [],
  stats: {
    total: 0,
    running: 0,
    sleeping: 0,
    stopped: 0,
    zombie: 0
  },
  lastUpdate: 0,
  cacheExpiry: 10 * 1000, // 10 秒

  /**
   * 更新进程缓存
   */
  updateProcesses: (processes, stats) => {
    set({
      processes,
      stats,
      lastUpdate: Date.now()
    })
  },

  /**
   * 获取缓存的进程列表
   */
  getCachedProcesses: () => {
    const { processes, isExpired } = get()
    if (isExpired()) {
      return []
    }
    return processes
  },

  /**
   * 获取缓存的统计信息
   */
  getCachedStats: () => {
    const { stats, isExpired } = get()
    if (isExpired()) {
      return {
        total: 0,
        running: 0,
        sleeping: 0,
        stopped: 0,
        zombie: 0
      }
    }
    return stats
  },

  /**
   * 清除缓存
   */
  clearCache: () => {
    set({
      processes: [],
      stats: {
        total: 0,
        running: 0,
        sleeping: 0,
        stopped: 0,
        zombie: 0
      },
      lastUpdate: 0
    })
  },

  /**
   * 检查缓存是否过期
   */
  isExpired: () => {
    const { lastUpdate, cacheExpiry } = get()
    if (lastUpdate === 0) {
      return true
    }
    return Date.now() - lastUpdate > cacheExpiry
  }
}))

