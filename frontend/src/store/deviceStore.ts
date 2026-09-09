import { create } from 'zustand'
import type { Device } from '@/types/hdc'
import * as App from '../../bindings/Hadice/backend/appservice'
import type { HdcDevice } from '@/types/hdc'
import { isHdcAvailable } from '@/lib/hdc'
import { captureEvent, capturePostHogException } from '@/lib/posthog'

interface DeviceState {
  /** 设备列表（鸿蒙 + 安卓） */
  devices: Device[]
  /** 当前选中的设备 */
  selectedDevice: Device | null
  /** 是否正在加载设备列表（初始化时） */
  isLoading: boolean
  /** 是否正在刷新设备列表 */
  isRefreshing: boolean
  /** 错误信息 */
  error: string | null
  /** HDC 版本 */
  hdcVersion: string
  /** ADB 版本 */
  adbVersion: string
  /** HDC 服务状态 */
  serverStatus: 'running' | 'stopped' | 'unknown'

  /** 设置设备列表 */
  setDevices: (devices: Device[]) => void
  /** 选择设备 */
  selectDevice: (device: Device | null) => void
  /** 设置加载状态 */
  setLoading: (loading: boolean) => void
  /** 设置刷新状态 */
  setRefreshing: (refreshing: boolean) => void
  /** 设置错误 */
  setError: (error: string | null) => void
  /** 设置 HDC 版本 */
  setHdcVersion: (version: string) => void
  /** 设置 ADB 版本 */
  setAdbVersion: (version: string) => void
  /** 设置服务状态 */
  setServerStatus: (status: 'running' | 'stopped' | 'unknown') => void

  /** 刷新设备列表（同时获取鸿蒙和安卓设备） */
  refreshDevices: () => Promise<void>
  /** 初始化 */
  initialize: () => Promise<void>
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  selectedDevice: null,
  isLoading: false,
  isRefreshing: false,
  error: null,
  hdcVersion: 'Unknown',
  adbVersion: 'Unknown',
  serverStatus: 'unknown',

  setDevices: (devices) => {
    set({ devices })
    const currentSelected = get().selectedDevice
    
    // 如果当前选中的设备不在列表中，清除选择
    if (currentSelected && !devices.find((d) => d.connectKey === currentSelected.connectKey)) {
      set({ selectedDevice: null })
    }
    
    // 如果当前选中的设备状态变为非 Connected，清除选择
    if (currentSelected) {
      const deviceInList = devices.find((d) => d.connectKey === currentSelected.connectKey)
      if (deviceInList && deviceInList.status !== 'Connected') {
        set({ selectedDevice: null })
      }
    }
    
    // 如果没有选中设备但有设备可用，自动选择第一个已连接的设备
    if (!get().selectedDevice && devices.length > 0) {
      const connectedDevice = devices.find((d) => d.status === 'Connected')
      if (connectedDevice) {
        set({ selectedDevice: connectedDevice })
      }
    }
  },

  selectDevice: (device) => {
    if (device) {
      captureEvent('device selected', {
        connection_type: device.connectionType,
        device_status: device.status,
        platform: device.platform || 'harmony',
      })
    }
    set({ selectedDevice: device })
  },
  setLoading: (isLoading) => set({ isLoading }),
  setRefreshing: (isRefreshing) => set({ isRefreshing }),
  setError: (error) => set({ error }),
  setHdcVersion: (hdcVersion) => set({ hdcVersion }),
  setAdbVersion: (adbVersion) => set({ adbVersion }),
  setServerStatus: (serverStatus) => set({ serverStatus }),

  refreshDevices: async () => {
    set({ isRefreshing: true, error: null })
    try {
      // 使用新的 ListAllDevices API 同时获取鸿蒙和安卓设备
      const devices = await App.ListAllDevices(true)
      console.log('[DeviceStore] 设备数量:', devices.length)
      console.log('[DeviceStore] 设备列表详情:', devices.map(d => ({
        connectKey: d.connectKey,
        connectionType: d.connectionType,
        status: d.status,
        platform: d.platform,
        productName: d.productName,
        model: d.model
      })))
      get().setDevices(devices)
    } catch (error) {
      console.error('[DeviceStore] ❌ ListAllDevices 失败')
      console.error('[DeviceStore] 错误详情:', {
        message: error instanceof Error ? error.message : '未知错误',
        stack: error instanceof Error ? error.stack : undefined,
        error
      })
      if (error instanceof Error) {
        capturePostHogException(error, { feature: 'device', action: 'refresh_devices' })
      }
      set({ error: error instanceof Error ? error.message : 'Failed to list devices' })
    } finally {
      set({ isRefreshing: false })
    }
  },

  initialize: async () => {
    set({ isLoading: true, error: null })
    try {
      // 获取 HDC 版本
      try {
        const version = await App.GetHdcVersion()
        set({ hdcVersion: version })
        if (version === 'Unknown') {
          console.warn('[DeviceStore] ⚠️ HDC 版本为 Unknown，可能存在问题')
        }
      } catch (versionError) {
        console.error('[DeviceStore] ❌ GetHdcVersion 失败:', versionError)
        set({ hdcVersion: 'Unknown' })
      }

      // 获取 ADB 版本
      try {
        const version = await App.GetAdbVersion()
        set({ adbVersion: version })
        if (version === 'Unknown') {
          console.warn('[DeviceStore] ⚠️ ADB 版本为 Unknown，可能存在问题')
        }
      } catch (versionError) {
        console.error('[DeviceStore] ❌ GetAdbVersion 失败:', versionError)
        set({ adbVersion: 'Unknown' })
      }

      // 检查服务状态
      try {
        const serverInfo = await App.CheckServer()
        console.log('[DeviceStore] Server info:', serverInfo, serverInfo.client, serverInfo.server)
        if (serverInfo.client && serverInfo.client !== 'Unknown') {
          set({ serverStatus: 'running' })
        } else {
          set({ serverStatus: 'unknown' })
          console.warn('[DeviceStore] ⚠️ 无法检测到 Client 版本，服务状态设为 unknown')
        }
      } catch (serverError) {
        console.error('[DeviceStore] ❌ CheckServer 失败:', serverError)
        set({ serverStatus: 'unknown' })
      }

      // 刷新设备列表
      await get().refreshDevices()
      
    } catch (error) {
      console.error('[DeviceStore] ❌ initialize 失败')
      console.error('[DeviceStore] 错误详情:', {
        message: error instanceof Error ? error.message : '未知错误',
        stack: error instanceof Error ? error.stack : undefined,
        error
      })
      if (error instanceof Error) {
        capturePostHogException(error, { feature: 'device', action: 'initialize' })
      }
      set({ error: error instanceof Error ? error.message : 'Initialization failed' })
    } finally {
      set({ isLoading: false })
    }
  }
}))
