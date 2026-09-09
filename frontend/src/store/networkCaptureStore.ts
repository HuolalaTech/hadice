import { create } from 'zustand'
import type { NetworkRequest, PortForwardStatus, CaptureStatus, ClientHeartbeatInfo } from '@/types/hdc'
import { networkCaptureAPI } from '@/lib/hdc-api/network-capture'
import { capturePostHogException } from '@/lib/posthog'
import { getNetworkRequestKey } from '@/lib/network-request-key'

// 缓存配置常量
const CACHE_CONFIG = {
  // 最大缓存请求数量
  MAX_REQUESTS_PER_DEVICE: 10000,
  // 自动清理间隔（毫秒）
  CLEANUP_INTERVAL: 5 * 60 * 1000, // 5分钟
  // 请求过期时间（毫秒）
  REQUEST_EXPIRY_TIME: 30 * 60 * 1000, // 30分钟
  // 内存警告阈值（请求数量）
  MEMORY_WARNING_THRESHOLD: 8000,
  // 强制清理阈值（请求数量）
  FORCE_CLEANUP_THRESHOLD: 9000
}

// LocalStorage key 常量
const STORAGE_KEYS = {
  AUTO_SCROLL_ENABLED: 'network-capture-auto-scroll-enabled'
}

/**
 * 从 localStorage 读取自动滚动状态
 */
function loadAutoScrollEnabled(): boolean {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.AUTO_SCROLL_ENABLED)
    return value === 'true'
  } catch {
    return true
  }
}

/**
 * 保存自动滚动状态到 localStorage
 */
function saveAutoScrollEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.AUTO_SCROLL_ENABLED, String(enabled))
  } catch (error) {
    console.error('[NetworkCaptureStore] 保存自动滚动状态失败:', error)
  }
}

/**
 * 搜索匹配结果
 */
export interface SearchMatchResult {
  urlMatch: boolean
  requestBodyMatch: boolean
  responseBodyMatch: boolean
  requestHeadersMatch: boolean
  requestParamsMatch: boolean
  matches: Array<{ start: number; end: number; text: string }>
}

/**
 * 单个设备的抓包状态
 */
interface DeviceCaptureState {
  /** 是否正在抓包 */
  isCapturing: boolean
  /** 请求列表 */
  requests: NetworkRequest[]
  /** 端口转发状态 */
  portForward: PortForwardStatus
  /** 开始时间戳 */
  startTime: number | null
  /** 成功请求数 */
  successCount: number
  /** 失败请求数 */
  errorCount: number
  /** 事件监听器取消函数 */
  unsubscribeFunctions: {
    requestReceived?: () => void
    error?: () => void
    closed?: () => void
    boundaryMarker?: () => void
    clientConnected?: () => void
  }
  /** 状态更新定时器 */
  statusInterval?: NodeJS.Timeout
  /** 搜索输入内容 */
  searchQuery: string
  /** 是否启用正则模式 */
  isRegexMode: boolean
  /** 是否启用过滤模式 */
  isFilterMode: boolean
  /** 是否启用自动滚动 */
  autoScrollEnabled: boolean
  /** 搜索匹配结果 Map<requestKey, SearchMatchResult> */
  searchMatches: Map<string, SearchMatchResult>
  /** 选中的请求 */
  selectedRequest: NetworkRequest | null
  /** 心跳状态信息 */
  heartbeatInfo: ClientHeartbeatInfo[]
  /** 最后一次心跳时间 */
  lastHeartbeatCheck: number | null
  /** 缓存统计信息 */
  cacheStats: {
    totalRequests: number
    lastCleanupTime: number | null
    memoryUsage: 'low' | 'medium' | 'high'
  }
}

interface NetworkCaptureState {
  /** 每个设备的抓包状态 Map<deviceId, DeviceCaptureState> */
  deviceStates: Map<string, DeviceCaptureState>

  /** 全局缓存管理器 */
  globalCacheManager: {
    cleanupTimer?: NodeJS.Timeout
    isRunning: boolean
  }

  /**
   * 初始化设备状态
   */
  initializeDevice: (deviceId: string) => void

  /**
   * 获取设备状态
   */
  getDeviceState: (deviceId: string) => DeviceCaptureState | null

  /**
   * 设置抓包状态
   */
  setCapturing: (deviceId: string, isCapturing: boolean) => void

  /**
   * 添加请求
   */
  addRequest: (deviceId: string, request: NetworkRequest) => void

  /**
   * 添加边界标记
   */
  addBoundaryMarker: (deviceId: string, boundaryMarker: NetworkRequest) => void

  /**
   * 设置请求列表
   */
  setRequests: (deviceId: string, requests: NetworkRequest[]) => void

  /**
   * 清空请求列表
   */
  clearRequests: (deviceId: string) => void

  /**
   * 设置端口转发状态
   */
  setPortForward: (deviceId: string, portForward: PortForwardStatus) => void

  /**
   * 设置开始时间
   */
  setStartTime: (deviceId: string, startTime: number | null) => void

  /**
   * 增加成功计数
   */
  incrementSuccessCount: (deviceId: string) => void

  /**
   * 增加失败计数
   */
  incrementErrorCount: (deviceId: string) => void

  /**
   * 重置统计信息
   */
  resetStats: (deviceId: string) => void

  /**
   * 设置事件监听器
   */
  setEventListeners: (
    deviceId: string,
    listeners: {
      requestReceived?: () => void
      error?: () => void
      closed?: () => void
      boundaryMarker?: () => void
      clientConnected?: () => void
    }
  ) => void

  /**
   * 清理事件监听器
   */
  cleanupEventListeners: (deviceId: string) => void

  /**
   * 设置状态更新定时器
   */
  setStatusInterval: (deviceId: string, interval: NodeJS.Timeout | undefined) => void

  /**
   * 清理状态更新定时器
   */
  cleanupStatusInterval: (deviceId: string) => void

  /**
   * 开始抓包（设置抓包状态）
   */
  startCapturing: (deviceId: string) => void

  /**
   * 启动抓包事件监听（在设备连接后调用，支持后台持续接收）
   */
  startCaptureListeners: (deviceId: string, syncBackendStatus?: boolean) => void

  /**
   * 停止抓包（包含清理）
   */
  stopCapture: (deviceId: string) => Promise<void>

  /**
   * 获取抓包状态
   */
  getCaptureStatus: (deviceId: string) => Promise<CaptureStatus>

  /**
   * 同步后端状态
   */
  syncStatus: (deviceId: string) => Promise<void>

  /**
   * 设置搜索输入内容
   */
  setSearchQuery: (deviceId: string, query: string) => void

  /**
   * 设置正则模式
   */
  setIsRegexMode: (deviceId: string, isRegexMode: boolean) => void

  /**
   * 设置过滤模式
   */
  setIsFilterMode: (deviceId: string, isFilterMode: boolean) => void

  /**
   * 设置自动滚动状态
   */
  setAutoScrollEnabled: (deviceId: string, enabled: boolean) => void

  /**
   * 设置搜索匹配结果
   */
  setSearchMatches: (deviceId: string, matches: Map<string, SearchMatchResult>) => void

  /**
   * 设置选中的请求
   */
  setSelectedRequest: (deviceId: string, request: NetworkRequest | null) => void

  /**
   * 清理设备状态
   */
  cleanupDevice: (deviceId: string) => void

  /**
   * 设置心跳状态信息
   */
  setHeartbeatInfo: (deviceId: string, heartbeatInfo: ClientHeartbeatInfo[]) => void

  /**
   * 设置最后心跳检查时间
   */
  setLastHeartbeatCheck: (deviceId: string, timestamp: number | null) => void

  /**
   * 执行缓存清理
   */
  cleanupCache: (deviceId: string) => void

  /**
   * 获取缓存统计信息
   */
  getCacheStats: (deviceId: string) => { totalRequests: number; memoryUsage: 'low' | 'medium' | 'high' }

  /**
   * 全局缓存管理：启动后台清理定时器
   */
  startGlobalCacheManager: () => void

  /**
   * 全局缓存管理：停止后台清理定时器
   */
  stopGlobalCacheManager: () => void
}

/**
 * 网络抓包全局状态 Store
 * 用于管理所有设备的抓包状态，确保切换页面后后台继续抓包和收集数据
 */
export const useNetworkCaptureStore = create<NetworkCaptureState>((set, get) => ({
  deviceStates: new Map(),

  globalCacheManager: {
    isRunning: false
  },

  /**
   * 初始化设备状态
   */
  initializeDevice: (deviceId) => {
    const { deviceStates } = get()
    if (!deviceStates.has(deviceId)) {
      const newStates = new Map(deviceStates)
      newStates.set(deviceId, {
        isCapturing: false,
        requests: [],
        portForward: {
          configured: false,
          localPort: 6100,
          devicePort: 35201,
          status: 'not_configured'
        },
        startTime: null,
        successCount: 0,
        errorCount: 0,
        unsubscribeFunctions: {},
        searchQuery: '',
        isRegexMode: false,
        isFilterMode: false,
        autoScrollEnabled: loadAutoScrollEnabled(),
        searchMatches: new Map(),
        selectedRequest: null,
        heartbeatInfo: [],
        lastHeartbeatCheck: null,
        cacheStats: {
          totalRequests: 0,
          lastCleanupTime: null,
          memoryUsage: 'low'
        }
      })
      set({ deviceStates: newStates })
    }
  },

  /**
   * 获取设备状态
   */
  getDeviceState: (deviceId) => {
    const { deviceStates } = get()
    return deviceStates.get(deviceId) || null
  },

  /**
   * 设置抓包状态
   */
  setCapturing: (deviceId, isCapturing) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setCapturing(deviceId, isCapturing)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, isCapturing })
    set({ deviceStates: newStates })
  },

  /**
   * 添加请求（实现请求合并逻辑）
   */
  addRequest: (deviceId, request) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().addRequest(deviceId, request)
    }

    const newStates = new Map(deviceStates)

    // 实现请求合并逻辑
    const existingRequests = [...state.requests]
    let merged = false

    // 生成请求的唯一标识
    const key = getNetworkRequestKey(request)

    // 查找是否已存在相同的请求
    for (let i = 0; i < existingRequests.length; i++) {
      const existing = existingRequests[i]

      // 跳过边界标记
      if (existing.isSessionBoundary) continue

      // 生成现有请求的标识
      const existingKey = getNetworkRequestKey(existing)

      if (existingKey === key) {
        // 找到匹配的请求，进行合并
        if (request.statusCode && !existing.statusCode) {
          // 当前请求有响应，替换
          existingRequests[i] = {
            ...request,
            requestHeaders: request.requestHeaders || existing.requestHeaders,
            requestBody: request.requestBody || existing.requestBody,
            timestamp: Math.min(request.timestamp, existing.timestamp)
          }
        } else if (!request.statusCode && existing.statusCode) {
          // 已存在的有响应，当前是请求，合并请求信息
          existingRequests[i] = {
            ...existing,
            requestHeaders: request.requestHeaders || existing.requestHeaders,
            requestBody: request.requestBody || existing.requestBody,
            timestamp: Math.min(request.timestamp, existing.timestamp)
          }
        } else {
          // 都有响应或都没有响应，合并所有信息
          existingRequests[i] = {
            ...existing,
            requestHeaders: request.requestHeaders || existing.requestHeaders,
            requestBody: request.requestBody || existing.requestBody,
            responseHeaders: request.responseHeaders || existing.responseHeaders,
            responseBody: request.responseBody || existing.responseBody,
            statusCode: request.statusCode || existing.statusCode,
            timestamp: Math.min(request.timestamp, existing.timestamp)
          }
        }
        merged = true
        break
      }
    }

    // 如果没有找到匹配的请求，直接添加
    if (!merged) {
      existingRequests.push(request)
    }

    // 更新缓存统计
    const memoryUsage = existingRequests.length > CACHE_CONFIG.FORCE_CLEANUP_THRESHOLD ? 'high' :
                       existingRequests.length > CACHE_CONFIG.MEMORY_WARNING_THRESHOLD ? 'medium' : 'low'

    newStates.set(deviceId, {
      ...state,
      requests: existingRequests,
      cacheStats: {
        totalRequests: existingRequests.length,
        lastCleanupTime: state.cacheStats.lastCleanupTime,
        memoryUsage
      }
    })
    set({ deviceStates: newStates })

    // 如果是第一次添加请求，启动全局缓存管理器
    const { globalCacheManager } = get()
    if (!globalCacheManager.isRunning) {
      get().startGlobalCacheManager()
    }
  },

  /**
   * 添加边界标记
   */
  addBoundaryMarker: (deviceId, boundaryMarker) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().addBoundaryMarker(deviceId, boundaryMarker)
    }

    // 检查是否已存在相同的边界标记（基于时间戳和边界类型去重）
    const existingBoundaryIndex = state.requests.findIndex(request =>
      request.isSessionBoundary &&
      request.timestamp === boundaryMarker.timestamp &&
      request.boundaryType === boundaryMarker.boundaryType &&
      request.clientId === boundaryMarker.clientId
    )

    if (existingBoundaryIndex !== -1) {
      // 已存在相同的边界标记，跳过添加
      console.log('[NetworkCaptureStore] 跳过重复的边界标记:', boundaryMarker.boundaryMessage)
      return
    }

    const newStates = new Map(deviceStates)
    const newRequests = [...state.requests, boundaryMarker]

    // 更新缓存统计
    const memoryUsage = newRequests.length > CACHE_CONFIG.FORCE_CLEANUP_THRESHOLD ? 'high' :
                       newRequests.length > CACHE_CONFIG.MEMORY_WARNING_THRESHOLD ? 'medium' : 'low'

    newStates.set(deviceId, {
      ...state,
      requests: newRequests,
      cacheStats: {
        totalRequests: newRequests.length,
        lastCleanupTime: state.cacheStats.lastCleanupTime,
        memoryUsage
      }
    })
    set({ deviceStates: newStates })
  },

  /**
   * 设置请求列表
   */
  setRequests: (deviceId, requests) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setRequests(deviceId, requests)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, requests })
    set({ deviceStates: newStates })
  },

  /**
   * 清空请求列表
   */
  clearRequests: (deviceId) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) return

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, {
      ...state,
      requests: [],
      successCount: 0,
      errorCount: 0
    })
    set({ deviceStates: newStates })
  },

  /**
   * 设置端口转发状态
   */
  setPortForward: (deviceId, portForward) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setPortForward(deviceId, portForward)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, portForward })
    set({ deviceStates: newStates })
  },

  /**
   * 设置开始时间
   */
  setStartTime: (deviceId, startTime) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setStartTime(deviceId, startTime)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, startTime })
    set({ deviceStates: newStates })
  },

  /**
   * 增加成功计数
   */
  incrementSuccessCount: (deviceId) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) return

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, successCount: state.successCount + 1 })
    set({ deviceStates: newStates })
  },

  /**
   * 增加失败计数
   */
  incrementErrorCount: (deviceId) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) return

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, errorCount: state.errorCount + 1 })
    set({ deviceStates: newStates })
  },

  /**
   * 重置统计信息
   */
  resetStats: (deviceId) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) return

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, {
      ...state,
      successCount: 0,
      errorCount: 0,
      startTime: null
    })
    set({ deviceStates: newStates })
  },

  /**
   * 设置事件监听器
   */
  setEventListeners: (deviceId, listeners) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setEventListeners(deviceId, listeners)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, {
      ...state,
      unsubscribeFunctions: listeners
    })
    set({ deviceStates: newStates })
  },

  /**
   * 清理事件监听器
   */
  cleanupEventListeners: (deviceId) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) return

    // 执行取消函数
    if (state.unsubscribeFunctions.requestReceived) {
      state.unsubscribeFunctions.requestReceived()
    }
    if (state.unsubscribeFunctions.error) {
      state.unsubscribeFunctions.error()
    }
    if (state.unsubscribeFunctions.closed) {
      state.unsubscribeFunctions.closed()
    }
    if (state.unsubscribeFunctions.boundaryMarker) {
      state.unsubscribeFunctions.boundaryMarker()
    }
    if (state.unsubscribeFunctions.clientConnected) {
      state.unsubscribeFunctions.clientConnected()
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, {
      ...state,
      unsubscribeFunctions: {}
    })
    set({ deviceStates: newStates })
  },

  /**
   * 设置状态更新定时器
   */
  setStatusInterval: (deviceId, interval) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) return

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, statusInterval: interval })
    set({ deviceStates: newStates })
  },

  /**
   * 清理状态更新定时器
   */
  cleanupStatusInterval: (deviceId) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) return

    if (state.statusInterval) {
      clearInterval(state.statusInterval)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, statusInterval: undefined })
    set({ deviceStates: newStates })
  },

  /**
   * 开始抓包（设置抓包状态，在调用 startCaptureListeners 后调用）
   */
  startCapturing: (deviceId) => {
    get().setStartTime(deviceId, Date.now())
    get().setCapturing(deviceId, true)
  },

  /**
   * 启动抓包事件监听（在设备连接后调用，支持后台持续接收）
   */
  startCaptureListeners: (deviceId, syncBackendStatus = true) => {
    // 初始化设备状态
    get().initializeDevice(deviceId)

    // 清理旧的事件监听器（如果存在）
    get().cleanupEventListeners(deviceId)

    // 设置事件监听器
    const requestUnsubscribe = networkCaptureAPI.onRequestReceived((receivedDeviceId, request) => {
      if (receivedDeviceId === deviceId) {
        get().addRequest(deviceId, request)

        // 更新统计
        if (request.statusCode) {
          if (request.statusCode >= 200 && request.statusCode < 300) {
            get().incrementSuccessCount(deviceId)
          } else if (request.statusCode >= 400) {
            get().incrementErrorCount(deviceId)
          }
        }
      }
    })

    const errorUnsubscribe = networkCaptureAPI.onError((receivedDeviceId, _error) => {
      if (receivedDeviceId === deviceId) {
        // 错误处理
      }
    })

    const closedUnsubscribe = networkCaptureAPI.onClosed((receivedDeviceId) => {
      if (receivedDeviceId === deviceId) {
        get().setCapturing(deviceId, false)
      }
    })

    // 添加边界标记事件监听
    const boundaryMarkerUnsubscribe = networkCaptureAPI.onBoundaryMarker((receivedDeviceId, boundaryMarker) => {
      if (receivedDeviceId === deviceId) {
        get().addBoundaryMarker(deviceId, boundaryMarker)
      }
    })

    // 添加客户端连接事件监听
    const clientConnectedUnsubscribe = networkCaptureAPI.onClientConnected((serverDeviceId, clientDeviceId) => {
      if (serverDeviceId === deviceId) {
        console.log(`[NetworkCaptureStore] 客户端已连接: ${clientDeviceId}, 准备推送Mock配置`)
        // 推送Mock配置到客户端
        const { pushConfigToClient } = require('./mockStore').useMockStore.getState()
        console.log(`[NetworkCaptureStore] 获取到 pushConfigToClient 方法, 开始推送`)
        pushConfigToClient(deviceId).catch((err: Error) => {
          console.warn('[NetworkCaptureStore] Mock配置推送失败:', err)
        })
      }
    })

    get().setEventListeners(deviceId, {
      requestReceived: requestUnsubscribe,
      error: errorUnsubscribe,
      closed: closedUnsubscribe,
      boundaryMarker: boundaryMarkerUnsubscribe,
      clientConnected: clientConnectedUnsubscribe
    })

    // 清理旧的定时器（如果存在）
    get().cleanupStatusInterval(deviceId)

    if (syncBackendStatus) {
      // Sophon TCP Server 状态轮询不能用于 HiProfiler；HiProfiler 使用自己的会话状态事件。
      const interval = setInterval(() => {
        get().syncStatus(deviceId).catch((error) => {
          console.error('[NetworkCaptureStore] 同步状态失败:', error)
        })
      }, 1000)

      get().setStatusInterval(deviceId, interval)
    }
  },

  /**
   * 停止抓包（包含清理）- 使用新架构：TCP服务器模式
   */
  stopCapture: async (deviceId) => {
    try {
      await networkCaptureAPI.stopCaptureServer(deviceId)
    } catch (error) {
      console.error('[NetworkCaptureStore] 停止抓包失败:', error)
      if (error instanceof Error) {
        capturePostHogException(error, { feature: 'network_capture', action: 'stop' })
      }
    }

    // 重置抓包状态，但不清理事件监听器（支持后台持续接收）
    get().setCapturing(deviceId, false)
    get().setStartTime(deviceId, null)

    // 清理定时器
    get().cleanupStatusInterval(deviceId)

    // 同步状态
    await get().syncStatus(deviceId)
  },

  /**
   * 获取抓包状态（使用新架构：TCP服务器模式）
   */
  getCaptureStatus: async (deviceId) => {
    try {
      const status = await networkCaptureAPI.getCaptureServerStatus(deviceId)
      const state = get().getDeviceState(deviceId)

      // 更新本地状态
      if (state) {
        get().setCapturing(deviceId, status.isCapturing)
        get().setPortForward(deviceId, status.portForward)
      }

      return status
    } catch (error) {
      console.error('[NetworkCaptureStore] 获取抓包状态失败:', error)
      return {
        isCapturing: false,
        requestCount: 0,
        portForward: {
          configured: false,
          localPort: 0,
          devicePort: 0,
          status: 'not_configured'
        }
      }
    }
  },

  /**
   * 同步后端状态（使用新架构：仅同步状态信息，不同步请求数据）
   */
  syncStatus: async (deviceId) => {
    const status = await get().getCaptureStatus(deviceId)

    // 前端自主管理请求数据，不再从后端同步
    // 只更新状态相关的统计信息
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (state) {
      // 基于前端已有的请求数据重新统计成功和失败数量
      const success = state.requests.filter((r) => r.statusCode && r.statusCode >= 200 && r.statusCode < 300).length
      const error = state.requests.filter((r) => r.statusCode && r.statusCode >= 400).length

      const newStates = new Map(deviceStates)
      newStates.set(deviceId, {
        ...state,
        successCount: success,
        errorCount: error
      })
      set({ deviceStates: newStates })
    }

    // 更新心跳状态（从后端状态中提取）
    try {
      const serverStatus = await networkCaptureAPI.getCaptureServerStatus(deviceId)
      const sessions = (serverStatus as any).sessions
      // 空数组 [] 也要写入，否则会话全部断开后会残留上一轮心跳
      if (Array.isArray(sessions)) {
        const allHeartbeatInfo: ClientHeartbeatInfo[] = []
        sessions.forEach((session: any) => {
          if (session.heartbeatInfo) {
            allHeartbeatInfo.push(...session.heartbeatInfo)
          }
        })

        get().setHeartbeatInfo(deviceId, allHeartbeatInfo)
        get().setLastHeartbeatCheck(deviceId, Date.now())
      }
    } catch (error) {
      console.error('[NetworkCaptureStore] 获取心跳状态失败:', error)
    }
  },

  /**
   * 设置搜索输入内容
   */
  setSearchQuery: (deviceId, query) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setSearchQuery(deviceId, query)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, searchQuery: query })
    set({ deviceStates: newStates })
  },

  /**
   * 设置正则模式
   */
  setIsRegexMode: (deviceId, isRegexMode) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setIsRegexMode(deviceId, isRegexMode)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, isRegexMode })
    set({ deviceStates: newStates })
  },

  /**
   * 设置过滤模式
   */
  setIsFilterMode: (deviceId, isFilterMode) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setIsFilterMode(deviceId, isFilterMode)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, isFilterMode })
    set({ deviceStates: newStates })
  },

  /**
   * 设置自动滚动状态
   */
  setAutoScrollEnabled: (deviceId, enabled) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setAutoScrollEnabled(deviceId, enabled)
    }

    saveAutoScrollEnabled(enabled)

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, autoScrollEnabled: enabled })
    set({ deviceStates: newStates })
  },

  /**
   * 设置搜索匹配结果
   */
  setSearchMatches: (deviceId, matches) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setSearchMatches(deviceId, matches)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, searchMatches: matches })
    set({ deviceStates: newStates })
  },

  /**
   * 设置选中的请求
   */
  setSelectedRequest: (deviceId, request) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setSelectedRequest(deviceId, request)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, selectedRequest: request })
    set({ deviceStates: newStates })
  },

  /**
   * 清理设备状态
   */
  cleanupDevice: (deviceId) => {
    get().cleanupEventListeners(deviceId)
    get().cleanupStatusInterval(deviceId)

    const { deviceStates } = get()
    const newStates = new Map(deviceStates)
    newStates.delete(deviceId)
    set({ deviceStates: newStates })
  },

  /**
   * 设置心跳状态信息
   */
  setHeartbeatInfo: (deviceId, heartbeatInfo) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setHeartbeatInfo(deviceId, heartbeatInfo)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, heartbeatInfo })
    set({ deviceStates: newStates })
  },

  /**
   * 设置最后心跳检查时间
   */
  setLastHeartbeatCheck: (deviceId, timestamp) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) {
      get().initializeDevice(deviceId)
      return get().setLastHeartbeatCheck(deviceId, timestamp)
    }

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, { ...state, lastHeartbeatCheck: timestamp })
    set({ deviceStates: newStates })
  },

  /**
   * 执行缓存清理
   */
  cleanupCache: (deviceId) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    if (!state) return

    const now = Date.now()
    let requests = [...state.requests]

    // 清理过期请求（保留最近的请求和边界标记）
    const expiryTime = now - CACHE_CONFIG.REQUEST_EXPIRY_TIME
    requests = requests.filter(request => {
      // 保留边界标记
      if (request.isSessionBoundary) return true
      // 保留最近的请求
      return request.timestamp > expiryTime
    })

    // 如果仍然超过最大数量，保留最新的请求
    if (requests.length > CACHE_CONFIG.MAX_REQUESTS_PER_DEVICE) {
      // 排序：边界标记在前（按时间倒序），普通请求按时间倒序
      requests.sort((a, b) => {
        if (a.isSessionBoundary && !b.isSessionBoundary) return -1
        if (!a.isSessionBoundary && b.isSessionBoundary) return 1
        return b.timestamp - a.timestamp
      })

      requests = requests.slice(0, CACHE_CONFIG.MAX_REQUESTS_PER_DEVICE)
    }

    // 更新缓存统计
    const memoryUsage = requests.length > CACHE_CONFIG.FORCE_CLEANUP_THRESHOLD ? 'high' :
                       requests.length > CACHE_CONFIG.MEMORY_WARNING_THRESHOLD ? 'medium' : 'low'

    const newStates = new Map(deviceStates)
    newStates.set(deviceId, {
      ...state,
      requests,
      cacheStats: {
        totalRequests: requests.length,
        lastCleanupTime: now,
        memoryUsage
      }
    })
    set({ deviceStates: newStates })

    console.log(`[NetworkCaptureStore] 缓存清理完成: ${deviceId}, 剩余请求数: ${requests.length}`)
  },

  /**
   * 获取缓存统计信息
   */
  getCacheStats: (deviceId) => {
    const { deviceStates } = get()
    const state = deviceStates.get(deviceId)
    return state?.cacheStats || { totalRequests: 0, memoryUsage: 'low' }
  },

  /**
   * 全局缓存管理：启动后台清理定时器
   */
  startGlobalCacheManager: () => {
    const { globalCacheManager } = get()
    if (globalCacheManager.isRunning) return

    const cleanupTimer = setInterval(() => {
      const { deviceStates } = get()
      deviceStates.forEach((_, deviceId) => {
        const state = deviceStates.get(deviceId)
        if (state && state.requests.length > CACHE_CONFIG.MEMORY_WARNING_THRESHOLD) {
          get().cleanupCache(deviceId)
        }
      })
    }, CACHE_CONFIG.CLEANUP_INTERVAL)

    set({
      globalCacheManager: {
        cleanupTimer,
        isRunning: true
      }
    })

    console.log('[NetworkCaptureStore] 全局缓存管理器已启动')
  },

  /**
   * 全局缓存管理：停止后台清理定时器
   */
  stopGlobalCacheManager: () => {
    const { globalCacheManager } = get()
    if (!globalCacheManager.isRunning) return

    if (globalCacheManager.cleanupTimer) {
      clearInterval(globalCacheManager.cleanupTimer)
    }

    set({
      globalCacheManager: {
        isRunning: false
      }
    })

    console.log('[NetworkCaptureStore] 全局缓存管理器已停止')
  }
}))

/**
 * 获取特定设备状态的 selector hook
 * 使用此 hook 可以响应式地订阅特定设备的状态变化
 */
export const useDeviceCaptureState = (deviceId: string | null) => {
  return useNetworkCaptureStore((state) => {
    if (!deviceId) return null
    // 直接从 deviceStates Map 中获取，确保响应式更新
    return state.deviceStates.get(deviceId) || null
  })
}
