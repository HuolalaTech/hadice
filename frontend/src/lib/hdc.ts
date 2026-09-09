/**
 * 检查 HDC API 是否可用
 */
export function isHdcAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.hdc !== 'undefined'
}

/**
 * 检查 ADB API 是否可用
 */
export function isAdbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.hdc !== 'undefined'
}

/**
 * 判断设备是否为安卓平台
 */
export function isAndroidDevice(platform: string | undefined): boolean {
  return platform === 'android'
}

/**
 * 判断设备是否为鸿蒙平台
 */
export function isHarmonyOSDevice(platform: string | undefined): boolean {
  return platform === 'harmonyos' || !platform
}