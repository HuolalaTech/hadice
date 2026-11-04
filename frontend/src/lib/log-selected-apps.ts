/** 持久化只记包名/展示名；PID 每次从当前应用列表回填（重启会变） */
export interface SavedLogApp {
  packageName: string
  appName: string
}

export interface HydratedLogApp extends SavedLogApp {
  pid?: number
}

export function toSavedLogApps(
  apps: Array<{ packageName: string; appName: string; pid?: number }>
): SavedLogApp[] {
  const out: SavedLogApp[] = []
  const seen = new Set<string>()
  for (const a of apps) {
    const pkg = (a.packageName || '').trim()
    if (!pkg || seen.has(pkg)) continue
    seen.add(pkg)
    out.push({
      packageName: pkg,
      appName: (a.appName || pkg).trim() || pkg,
    })
  }
  return out
}

/**
 * 用当前设备应用列表回填 pid。
 * catalog 为空：仍保留 saved（列表还在加载，不能误删）。
 * catalog 非空：不在列表里的视为已卸载，丢弃。
 */
export function hydrateLogApps(
  saved: SavedLogApp[],
  catalog: Array<{ packageName: string; appName: string; pid?: number }>
): HydratedLogApp[] {
  if (!saved.length) return []
  if (catalog.length === 0) {
    return saved.map((s) => ({
      packageName: s.packageName,
      appName: s.appName,
    }))
  }
  const byPkg = new Map(
    catalog.map((a) => [a.packageName, a] as const)
  )
  const out: HydratedLogApp[] = []
  for (const s of saved) {
    const hit = byPkg.get(s.packageName)
    if (!hit) continue // 已卸载 / 不在本机
    out.push({
      packageName: hit.packageName,
      appName: hit.appName || s.appName,
      pid: hit.pid && hit.pid > 0 ? hit.pid : undefined,
    })
  }
  return out
}

/**
 * 应用列表到达或刷新时：回填 pid；catalog 非空时剔除已卸载项。
 * catalog 仍为空时不改选择（避免加载中被清空）。
 */
export function refreshLogAppsPids(
  selected: HydratedLogApp[],
  catalog: Array<{ packageName: string; appName: string; pid?: number }>
): HydratedLogApp[] {
  if (!selected.length) return selected
  if (catalog.length === 0) return selected
  const byPkg = new Map(
    catalog.map((a) => [a.packageName, a] as const)
  )
  const next: HydratedLogApp[] = []
  let changed = false
  for (const s of selected) {
    const hit = byPkg.get(s.packageName)
    if (!hit) {
      changed = true
      continue
    }
    const pid = hit.pid && hit.pid > 0 ? hit.pid : undefined
    const appName = hit.appName || s.appName
    if (pid !== s.pid || appName !== s.appName) changed = true
    next.push({ packageName: s.packageName, appName, pid })
  }
  return changed ? next : selected
}
