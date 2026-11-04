import type { AndroidApp, HarmonyDebuggableApp } from '@/types/hdc'

/** 持久化只记身份；PID 每次从进程列表回填 */
export interface SavedCaptureApp {
  packageName: string
  processName: string
  appName: string
}

export function toSavedCaptureApp(
  app: {
    packageName?: string
    bundleName?: string
    processName?: string
    appName?: string
    name?: string
  } | null
): SavedCaptureApp | null {
  if (!app) return null
  const packageName = (app.packageName || app.bundleName || '').trim()
  const processName = (app.processName || packageName).trim()
  if (!packageName && !processName) return null
  return {
    packageName: packageName || processName,
    processName: processName || packageName,
    appName: (app.appName || app.name || packageName || processName).trim(),
  }
}

/** catalog 空：返回无 PID 占位（列表加载中）；非空且找不到：null（已卸载） */
export function hydrateHarmonyCaptureApp(
  saved: SavedCaptureApp | null,
  catalog: HarmonyDebuggableApp[]
): HarmonyDebuggableApp | null {
  if (!saved) return null
  if (catalog.length === 0) {
    return {
      bundleName: saved.packageName,
      appName: saved.appName,
      processName: saved.processName,
      pid: 0,
    }
  }
  // 只按 processName：同 bundle 多进程时不能用 bundleName（会命中列表第一项）
  const hit = catalog.find((a) => a.processName === saved.processName)
  if (!hit) return null
  return { ...hit }
}

export function hydrateAndroidCaptureApp(
  saved: SavedCaptureApp | null,
  catalog: AndroidApp[]
): AndroidApp | null {
  if (!saved) return null
  if (catalog.length === 0) {
    return {
      packageName: saved.packageName,
      processName: saved.processName,
      name: saved.appName,
      pid: 0,
      debuggable: true,
    }
  }
  // 只按 processName：同包名 :remote / :pushservice / 主进程 不能用 packageName 抢第一项
  const hit = catalog.find((a) => a.processName === saved.processName)
  if (!hit) return null
  return { ...hit }
}

/** 列表刷新后对齐 value；找不到则清除（仅 catalog 已成功拉取时调用） */
export function reconcileHarmonyCaptureApp(
  value: HarmonyDebuggableApp | null,
  catalog: HarmonyDebuggableApp[]
): HarmonyDebuggableApp | null {
  if (!value) return null
  const hit = catalog.find((a) => a.processName === value.processName)
  return hit ? { ...hit } : null
}

export function reconcileAndroidCaptureApp(
  value: AndroidApp | null,
  catalog: AndroidApp[]
): AndroidApp | null {
  if (!value) return null
  const hit = catalog.find((a) => a.processName === value.processName)
  return hit ? { ...hit } : null
}

export function captureAppsEqual(
  a: SavedCaptureApp | null,
  b: SavedCaptureApp | null
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.packageName === b.packageName &&
    a.processName === b.processName &&
    a.appName === b.appName
  )
}
