/** 网页看看打开历史（任意入口共用 localStorage） */

export const WEB_PEEK_HISTORY_KEY = 'hadice-web-peek-history'
export const WEB_PEEK_HISTORY_MAX = 30
/** 其它入口写入后，主面板可监听刷新列表 */
export const WEB_PEEK_HISTORY_EVENT = 'hadice-web-peek-history-changed'

export function loadWebPeekHistory(): string[] {
  try {
    const raw = localStorage.getItem(WEB_PEEK_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .slice(0, WEB_PEEK_HISTORY_MAX)
  } catch {
    return []
  }
}

export function saveWebPeekHistory(list: string[]): void {
  try {
    localStorage.setItem(WEB_PEEK_HISTORY_KEY, JSON.stringify(list.slice(0, WEB_PEEK_HISTORY_MAX)))
  } catch {
    /* ignore */
  }
}

export function pushWebPeekHistory(prev: string[], url: string): string[] {
  return [url, ...prev.filter((u) => u !== url)].slice(0, WEB_PEEK_HISTORY_MAX)
}

/** 成功打开后记一条；并发入口也写同一份列表 */
export function rememberWebPeekUrl(url: string): string[] {
  const next = pushWebPeekHistory(loadWebPeekHistory(), url)
  saveWebPeekHistory(next)
  try {
    window.dispatchEvent(new CustomEvent(WEB_PEEK_HISTORY_EVENT, { detail: { url, list: next } }))
  } catch {
    /* ignore */
  }
  return next
}
