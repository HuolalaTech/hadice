import { create } from 'zustand'
import type { Device } from '@/types/hdc'
import * as App from '../../bindings/Hadice/backend/appservice'
import { captureEvent, capturePostHogException } from '@/lib/posthog'
import {
  loadLastDeviceConnectKey,
  loadLastDeviceSnapshot,
  resolveSelectedDevice,
  saveLastDeviceConnectKey,
  saveLastDeviceSnapshot,
} from '@/lib/device-selection'

/** 跨主窗/独立窗同步当前设备；payload 为 connectKey（后端 SetSelectedConnectKey 广播） */
export const DEVICE_SELECTED_EVENT = 'device-selected'

interface DeviceState {
  /** 设备列表（鸿蒙 + 安卓） */
  devices: Device[]
  /** 当前选中的设备 */
  selectedDevice: Device | null
  /**
   * 偏好 connectKey（独立窗 URL / 跨窗事件写入）。
   * setDevices 优先选它，避免独立窗落到列表第一台安卓设备。
   */
  preferredConnectKey: string | null
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
  /** 仅写入偏好（不改 selected；用于独立窗启动早于设备列表） */
  setPreferredConnectKey: (key: string | null) => void
  /** 应用远端同步的设备选择（不二次广播） */
  applyRemoteDeviceKey: (key: string) => void
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

function initialPreferredKey(): string | null {
  if (typeof localStorage === 'undefined') return null
  return loadLastDeviceConnectKey()
}

function initialSelectedDevice(): Device | null {
  if (typeof localStorage === 'undefined') return null
  // ponytail: 秒开顶栏；列表回来后 setDevices 会校正/清空
  const snap = loadLastDeviceSnapshot()
  return snap ? (snap as Device) : null
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  selectedDevice: initialSelectedDevice(),
  preferredConnectKey: initialPreferredKey(),
  isLoading: false,
  isRefreshing: false,
  error: null,
  hdcVersion: 'Unknown',
  adbVersion: 'Unknown',
  serverStatus: 'unknown',

  setDevices: (devices) => {
    const preferred =
      get().preferredConnectKey ?? get().selectedDevice?.connectKey ?? null
    // 上次设备仍在 → 选它；已拔掉/不在列表 → 回退第一台 Connected（刷新后不再卡在「无设备」）
    // 独立窗 URL 偏好若在列表里仍会优先命中；不在则同样回退
    const selectedDevice = resolveSelectedDevice(devices, preferred, {
      fallbackToFirst: true,
    })
    set({
      devices,
      selectedDevice,
      // 空列表保留 preferred，方便之后插回原机；有列表则跟当前选中对齐
      preferredConnectKey:
        selectedDevice?.connectKey ?? (devices.length === 0 ? preferred : null),
    })
    if (selectedDevice) saveLastDeviceSnapshot(selectedDevice)
    else if (devices.length > 0) saveLastDeviceConnectKey(null)
  },

  setPreferredConnectKey: (key) => {
    set({ preferredConnectKey: key })
    if (key) saveLastDeviceConnectKey(key)
  },

  applyRemoteDeviceKey: (key) => {
    if (!key) return
    const { selectedDevice, devices } = get()
    if (selectedDevice?.connectKey === key) {
      set({ preferredConnectKey: key })
      saveLastDeviceConnectKey(key)
      return
    }
    const match = devices.find((d) => d.connectKey === key && d.status === 'Connected')
    set({
      preferredConnectKey: key,
      ...(match ? { selectedDevice: match } : {}),
    })
    if (match) saveLastDeviceSnapshot(match)
    else saveLastDeviceConnectKey(key)
  },

  selectDevice: (device) => {
    const next = device?.connectKey ?? null
    if (device) {
      captureEvent('device selected', {
        connection_type: device.connectionType,
        device_status: device.status,
        platform: device.platform || 'harmony',
      })
    }
    set({ selectedDevice: device, preferredConnectKey: next })
    saveLastDeviceSnapshot(device)
    // ponytail: 真相在后端；独立窗 OpenPanelWindow 读 selectedConnectKey 写进 URL
    void App.SetSelectedConnectKey(next ?? '').catch(() => {})
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
    // 版本探测不挡设备列表：先认出上次设备，再后台填版本
    const probeMeta = async (): Promise<void> => {
      try {
        const version = await App.GetHdcVersion()
        set({ hdcVersion: version })
      } catch {
        set({ hdcVersion: 'Unknown' })
      }
      try {
        const version = await App.GetAdbVersion()
        set({ adbVersion: version })
      } catch {
        set({ adbVersion: 'Unknown' })
      }
      try {
        const serverInfo = await App.CheckServer()
        if (serverInfo.client && serverInfo.client !== 'Unknown') {
          set({ serverStatus: 'running' })
        } else {
          set({ serverStatus: 'unknown' })
        }
      } catch {
        set({ serverStatus: 'unknown' })
      }
    }
    void probeMeta()

    try {
      await get().refreshDevices()
      const sel = get().selectedDevice
      if (sel?.connectKey) {
        void App.SetSelectedConnectKey(sel.connectKey).catch(() => {})
      }
    } catch (error) {
      console.error('[DeviceStore] ❌ initialize 失败')
      if (error instanceof Error) {
        capturePostHogException(error, { feature: 'device', action: 'initialize' })
      }
      set({ error: error instanceof Error ? error.message : 'Initialization failed' })
    } finally {
      set({ isLoading: false })
    }
  }
}))
