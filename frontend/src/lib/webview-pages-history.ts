/** 抓包「网页」面板：最近网址记录上限（localStorage） */

import type { HarmonyWebViewPage } from '@/types/hdc'

export const WEBVIEW_PAGES_MAX_KEY = 'hadice-webview-pages-history-max'
/** 按设备 + 包名缓存网址历史（不含 pid，进程重启仍可恢复） */
export const WEBVIEW_PAGES_CACHE_PREFIX = 'hadice-webview-pages-history:'
export const WEBVIEW_PAGES_DEFAULT_MAX = 10
export const WEBVIEW_PAGES_ABS_MIN = 1
export const WEBVIEW_PAGES_ABS_MAX = 100

export interface WebViewPageRow extends HarmonyWebViewPage {
  seenAt: number
}

export function webViewPagesCacheKey(deviceId: string, packageName: string): string {
  return `${WEBVIEW_PAGES_CACHE_PREFIX}${encodeURIComponent(deviceId)}::${encodeURIComponent(packageName)}`
}

export function clampWebViewPagesMax(n: number): number {
  if (!Number.isFinite(n)) return WEBVIEW_PAGES_DEFAULT_MAX
  return Math.min(WEBVIEW_PAGES_ABS_MAX, Math.max(WEBVIEW_PAGES_ABS_MIN, Math.floor(n)))
}

export function loadWebViewPagesMax(): number {
  try {
    const raw = localStorage.getItem(WEBVIEW_PAGES_MAX_KEY)
    if (raw == null || raw.trim() === '') return WEBVIEW_PAGES_DEFAULT_MAX
    return clampWebViewPagesMax(Number(raw))
  } catch {
    return WEBVIEW_PAGES_DEFAULT_MAX
  }
}

export function saveWebViewPagesMax(n: number): number {
  const next = clampWebViewPagesMax(n)
  try {
    localStorage.setItem(WEBVIEW_PAGES_MAX_KEY, String(next))
  } catch {
    /* ignore */
  }
  return next
}

/** 按网址去重；无 URL 时退回 id（about:blank 等） */
export function webViewPageKey(page: Pick<HarmonyWebViewPage, 'id' | 'url'>): string {
  const url = (page.url || '').trim()
  if (url) return `url:${url}`
  return `id:${page.id}`
}

/**
 * 展示用标题：CDP 常在未设 document.title 时把整段 URL 填进 title，
 * 与 URL 列重复且极长，视为无标题。
 */
export function displayWebViewTitle(title: string, pageUrl: string): string {
  const t = (title || '').trim()
  if (!t) return '(无标题)'
  const u = (pageUrl || '').trim()
  if (u) {
    if (t === u) return '(无标题)'
    try {
      const parsed = new URL(u)
      const noHash = `${parsed.origin}${parsed.pathname}${parsed.search}`
      if (t === noHash || t === parsed.href || t === parsed.host + parsed.pathname + parsed.search) {
        return '(无标题)'
      }
      // title 实为「无 scheme 的 host/path?query」（截图常见）
      if (t === parsed.host + parsed.pathname + parsed.search + parsed.hash) return '(无标题)'
      if (t.startsWith(parsed.host + '/') || t.startsWith(parsed.host + '?')) return '(无标题)'
    } catch {
      /* ignore */
    }
  }
  if (/^https?:\/\//i.test(t)) return '(无标题)'
  if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(t)) return '(无标题)'
  return t
}

/**
 * 合并实时扫描进历史。
 * - 新网址：seenAt = now（排到前面）
 * - 已在历史上的网址：只刷新标题等字段，**不改 seenAt**（避免每 2s 重排闪烁）
 * - 扫描里暂时消失的网址：保留在历史中，直到被上限挤掉或用户清空
 */
export function mergeWebViewHistory(
  prev: WebViewPageRow[],
  next: HarmonyWebViewPage[],
  now: number,
  maxRecords: number
): WebViewPageRow[] {
  const max = clampWebViewPagesMax(maxRecords)
  const byKey = new Map<string, WebViewPageRow>()
  for (const page of prev) {
    byKey.set(webViewPageKey(page), page)
  }
  for (const page of next) {
    const key = webViewPageKey(page)
    const old = byKey.get(key)
    byKey.set(key, {
      ...page,
      faviconUrl: '',
      seenAt: old?.seenAt ?? now
    })
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.seenAt - a.seenAt || a.url.localeCompare(b.url))
    .slice(0, max)
}

function isWebViewPageRow(value: unknown): value is WebViewPageRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.url === 'string' &&
    typeof row.title === 'string' &&
    typeof row.type === 'string' &&
    typeof row.seenAt === 'number'
  )
}

/** 读取某设备+包名下的网址历史；无则 [] */
export function loadWebViewPagesHistory(
  deviceId: string,
  packageName: string,
  maxRecords: number = WEBVIEW_PAGES_DEFAULT_MAX
): WebViewPageRow[] {
  if (!deviceId || !packageName) return []
  try {
    const raw = localStorage.getItem(webViewPagesCacheKey(deviceId, packageName))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const rows = parsed.filter(isWebViewPageRow)
    return mergeWebViewHistory(rows, [], Date.now(), maxRecords)
  } catch {
    return []
  }
}

/** 写入缓存；空列表则删除 key */
export function saveWebViewPagesHistory(
  deviceId: string,
  packageName: string,
  pages: WebViewPageRow[],
  maxRecords: number = WEBVIEW_PAGES_DEFAULT_MAX
): void {
  if (!deviceId || !packageName) return
  const key = webViewPagesCacheKey(deviceId, packageName)
  try {
    const trimmed = mergeWebViewHistory(pages, [], Date.now(), maxRecords)
    if (trimmed.length === 0) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(
      key,
      JSON.stringify(
        trimmed.map((page) => ({
          id: page.id,
          type: page.type,
          url: page.url,
          title: page.title,
          seenAt: page.seenAt
        }))
      )
    )
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearWebViewPagesHistory(deviceId: string, packageName: string): void {
  if (!deviceId || !packageName) return
  try {
    localStorage.removeItem(webViewPagesCacheKey(deviceId, packageName))
  } catch {
    /* ignore */
  }
}

/** 列表是否需要更新（避免无变化时 setState 触发闪烁） */
export function webViewHistoryUnchanged(prev: WebViewPageRow[], next: WebViewPageRow[]): boolean {
  if (prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i]
    const b = next[i]
    if (
      webViewPageKey(a) !== webViewPageKey(b) ||
      a.title !== b.title ||
      a.type !== b.type ||
      a.seenAt !== b.seenAt ||
      a.id !== b.id
    ) {
      return false
    }
  }
  return true
}

/** ponytail: 最小自检 */
export function selfCheckWebViewPagesHistory(): void {
  const assert = (cond: boolean, msg: string): void => {
    if (!cond) throw new Error(`webview-pages-history: ${msg}`)
  }
  assert(clampWebViewPagesMax(0) === 1, 'min clamp')
  assert(clampWebViewPagesMax(999) === 100, 'max clamp')

  const a = mergeWebViewHistory(
    [],
    [{ id: '1', title: 'A', url: 'https://a.example', type: 'page' }],
    1000,
    2
  )
  const ab = mergeWebViewHistory(
    a,
    [{ id: '2', title: 'B', url: 'https://b.example', type: 'page' }],
    2000,
    2
  )
  assert(ab.length === 2, 'seed 2')
  assert(ab[0].url === 'https://b.example', 'newer first')

  // 同 URL 再扫：seenAt 不变、标题更新
  const same = mergeWebViewHistory(
    ab,
    [{ id: '9', title: 'B2', url: 'https://b.example', type: 'page' }],
    9999,
    2
  )
  assert(same[0].url === 'https://b.example', 'url stable')
  assert(same[0].seenAt === 2000, 'seenAt not bumped')
  assert(same[0].title === 'B2', 'title updated')
  assert(same[0].id === '9', 'id refreshed')

  const capped = mergeWebViewHistory(
    same,
    [{ id: '3', title: 'C', url: 'https://c.example', type: 'page' }],
    3000,
    2
  )
  assert(capped.length === 2, 'cap 2')
  assert(capped[0].url === 'https://c.example', 'newest first')
  assert(!capped.some((p) => p.url === 'https://a.example'), 'oldest dropped')
  assert(webViewHistoryUnchanged(capped, capped), 'unchanged self')

  const longTitle =
    'act2-pre.huolala.cn/van/act3-shop?user_md5=x&channel=huolala'
  const pageUrl =
    'https://act2-pre.huolala.cn/van/act3-shop?user_md5=x&channel=huolala'
  assert(displayWebViewTitle(longTitle, pageUrl) === '(无标题)', 'url-like title')
  assert(displayWebViewTitle('秒杀商城', pageUrl) === '秒杀商城', 'real title')
  assert(displayWebViewTitle(pageUrl, pageUrl) === '(无标题)', 'title equals url')

  // 缓存 round-trip（Node 无 localStorage 则跳过）
  if (typeof localStorage !== 'undefined') {
    const device = 'dev-1'
    const pkg = 'com.example.app'
    clearWebViewPagesHistory(device, pkg)
    saveWebViewPagesHistory(device, pkg, capped, 2)
    const loaded = loadWebViewPagesHistory(device, pkg, 2)
    assert(loaded.length === capped.length, 'cache load size')
    assert(loaded[0].url === capped[0].url, 'cache load order')
    clearWebViewPagesHistory(device, pkg)
    assert(loadWebViewPagesHistory(device, pkg, 2).length === 0, 'cache cleared')
  }
}
