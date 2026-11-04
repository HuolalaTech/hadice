import * as App from '../../../bindings/Hadice/backend/appservice'
import type { LayoutAppRow, LayoutDumpResult, LayoutPageInfo } from './types'

function mapDump(raw: any): LayoutDumpResult {
  return {
    platform: raw?.platform ?? '',
    packageName: raw?.packageName ?? '',
    pageName: raw?.pageName ?? '',
    nodeCount: raw?.nodeCount ?? 0,
    root: raw?.root ?? null,
    screenshotB64: raw?.screenshotB64 ?? '',
    screenshotMime: raw?.screenshotMime ?? 'image/png',
    width: raw?.width ?? 0,
    height: raw?.height ?? 0,
    rawHint: raw?.rawHint ?? ''
  }
}

export async function listApps(
  connectKey: string,
  platform: string,
  filter: 'thirdParty' | 'system' | 'all' = 'thirdParty'
): Promise<LayoutAppRow[]> {
  const result = await App.GetAppListByPlatform(connectKey, filter, false, platform)
  const apps = result?.apps ?? []
  return apps.map((a: any) => ({
    packageName: a.packageName,
    appName: a.appName || a.packageName,
    icon: a.icon
  }))
}

export async function listPages(
  connectKey: string,
  platform: string,
  packageName: string
): Promise<LayoutPageInfo[]> {
  const pages = await App.AppLayoutListPages(connectKey, platform, packageName)
  return (pages ?? []).map((p: any) => ({
    name: p.name,
    label: p.label
  }))
}

export async function inspectLayout(
  connectKey: string,
  platform: string,
  packageName: string,
  pageName: string
): Promise<LayoutDumpResult> {
  const raw = await App.AppLayoutInspect(connectKey, platform, packageName, pageName)
  return mapDump(raw)
}
