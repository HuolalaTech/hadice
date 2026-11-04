/**
 * 进程列表缓存。
 * 切回面板：有缓存就直接用、不打设备；打开下拉再强制刷新。
 */

const FRESH_TTL_MS = 60_000

interface CacheEntry<T> {
  apps: T[]
  at: number
}

const androidCache = new Map<string, CacheEntry<unknown>>()
const harmonyCache = new Map<string, CacheEntry<unknown>>()

function peekCached<T>(
  map: Map<string, CacheEntry<unknown>>,
  deviceId: string
): { apps: T[]; fresh: boolean } | null {
  const key = (deviceId || '').trim()
  if (!key) return null
  const hit = map.get(key) as CacheEntry<T> | undefined
  if (!hit || !hit.apps) return null
  return {
    apps: hit.apps,
    fresh: Date.now() - hit.at <= FRESH_TTL_MS,
  }
}

function setCached<T>(
  map: Map<string, CacheEntry<unknown>>,
  deviceId: string,
  apps: T[]
): void {
  const key = (deviceId || '').trim()
  if (!key) return
  map.set(key, { apps, at: Date.now() })
}

/** 切回用：有就返回（含过期），避免空白 */
export function peekAndroidProcessListCache<T>(
  deviceId: string
): { apps: T[]; fresh: boolean } | null {
  return peekCached<T>(androidCache, deviceId)
}

export function setAndroidProcessListCache<T>(deviceId: string, apps: T[]): void {
  setCached(androidCache, deviceId, apps)
}

export function peekHarmonyProcessListCache<T>(
  deviceId: string
): { apps: T[]; fresh: boolean } | null {
  return peekCached<T>(harmonyCache, deviceId)
}

export function setHarmonyProcessListCache<T>(deviceId: string, apps: T[]): void {
  setCached(harmonyCache, deviceId, apps)
}

/** @deprecated 兼容旧调用：仅返回未过期缓存 */
export function getAndroidProcessListCache<T>(deviceId: string): T[] | null {
  const hit = peekAndroidProcessListCache<T>(deviceId)
  return hit?.fresh ? hit.apps : null
}

/** @deprecated 兼容旧调用 */
export function getHarmonyProcessListCache<T>(deviceId: string): T[] | null {
  const hit = peekHarmonyProcessListCache<T>(deviceId)
  return hit?.fresh ? hit.apps : null
}
