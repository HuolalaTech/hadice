/** 主窗冷启动恢复「上次所选」设备（仅当仍 Connected 时生效） */
export const LAST_DEVICE_CONNECT_KEY = 'hadice-last-device-connect-key'
export const LAST_DEVICE_SNAPSHOT_KEY = 'hadice-last-device-snapshot'

/** 仅 UI 秒开用的轻量快照；真选中仍以列表里 Connected 为准 */
export interface LastDeviceSnapshot {
  connectKey: string
  connectionType: string
  status: string
  deviceName?: string
  productName?: string
  model?: string
  displayName?: string
  platform: string
}

export function loadLastDeviceConnectKey(): string | null {
  try {
    const key = localStorage.getItem(LAST_DEVICE_CONNECT_KEY)
    return key && key.length > 0 ? key : null
  } catch {
    return null
  }
}

export function saveLastDeviceConnectKey(key: string | null | undefined): void {
  try {
    if (!key) {
      localStorage.removeItem(LAST_DEVICE_CONNECT_KEY)
      localStorage.removeItem(LAST_DEVICE_SNAPSHOT_KEY)
    } else {
      localStorage.setItem(LAST_DEVICE_CONNECT_KEY, key)
    }
  } catch {
    /* ignore */
  }
}

export function loadLastDeviceSnapshot(): LastDeviceSnapshot | null {
  try {
    const raw = localStorage.getItem(LAST_DEVICE_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastDeviceSnapshot>
    if (!parsed || typeof parsed.connectKey !== 'string' || !parsed.connectKey) return null
    return {
      connectKey: parsed.connectKey,
      connectionType: parsed.connectionType || 'USB',
      status: 'Connected',
      deviceName: parsed.deviceName,
      productName: parsed.productName,
      model: parsed.model,
      displayName: parsed.displayName,
      platform: parsed.platform || 'harmonyos',
    }
  } catch {
    return null
  }
}

export function saveLastDeviceSnapshot(device: LastDeviceSnapshot | null | undefined): void {
  try {
    if (!device?.connectKey) {
      localStorage.removeItem(LAST_DEVICE_SNAPSHOT_KEY)
      localStorage.removeItem(LAST_DEVICE_CONNECT_KEY)
      return
    }
    localStorage.setItem(LAST_DEVICE_CONNECT_KEY, device.connectKey)
    localStorage.setItem(
      LAST_DEVICE_SNAPSHOT_KEY,
      JSON.stringify({
        connectKey: device.connectKey,
        connectionType: device.connectionType,
        status: device.status,
        deviceName: device.deviceName,
        productName: device.productName,
        model: device.model,
        displayName: device.displayName,
        platform: device.platform,
      })
    )
  } catch {
    /* ignore */
  }
}

export interface ResolveSelectedDeviceOptions {
  /**
   * 有 preferredKey 但列表里找不到时，是否回退到第一台已连接设备。
   * 独立窗必须 false，否则会落到列表第一台安卓（vangogh）。
   */
  fallbackToFirst?: boolean
}

/**
 * 在设备列表中解析应选中的设备。
 * preferredKey 优先（主窗 → 独立窗继承）；否则可回退到第一台已连接设备。
 */
export function resolveSelectedDevice<T extends { connectKey: string; status: string }>(
  devices: T[],
  preferredKey: string | null | undefined,
  options?: ResolveSelectedDeviceOptions
): T | null {
  const fallbackToFirst = options?.fallbackToFirst !== false
  if (preferredKey) {
    const preferred = devices.find(
      (d) => d.connectKey === preferredKey && d.status === 'Connected'
    )
    if (preferred) return preferred
    if (!fallbackToFirst) return null
  }
  return devices.find((d) => d.status === 'Connected') ?? null
}

/** 独立窗 URL 上的 device 参数；主窗打开面板时应写入。 */
export function readPreferredDeviceKeyFromSearch(
  search: string
): string | null {
  const key = new URLSearchParams(search).get('device')
  return key && key.length > 0 ? key : null
}

export function buildPanelWindowPath(
  menuId: string,
  deviceKey: string | null | undefined
): string {
  const sp = new URLSearchParams()
  sp.set('page', menuId)
  sp.set('standalone', '1')
  if (deviceKey) sp.set('device', deviceKey)
  return `/?${sp.toString()}`
}
