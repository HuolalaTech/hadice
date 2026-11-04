import { toast } from 'sonner'
import { normalizeWebPeekUrl } from '@/lib/web-peek-url'
import { rememberWebPeekUrl } from '@/lib/web-peek-history'
import * as App from '../../bindings/Hadice/backend/appservice'

/**
 * 通用「网页看看」：任意链接先在应用内 WebView 窗口预览，并写入打开历史。
 * 非法 URL 会 toast 并返回 false。
 */
export async function openWebPeek(rawUrl: string): Promise<boolean> {
  const url = normalizeWebPeekUrl(rawUrl)
  if (!url) {
    toast.error('无法打开：不是有效的 http/https 链接')
    return false
  }
  try {
    await App.OpenWebPeekWindow(url)
    rememberWebPeekUrl(url)
    return true
  } catch (err) {
    console.error('[openWebPeek] failed:', err)
    toast.error(err instanceof Error ? err.message : '打开网页窗口失败')
    return false
  }
}

/** 系统浏览器打开；网页看看相关入口也会记入历史 */
export async function openSystemBrowser(rawUrl: string): Promise<boolean> {
  const url = normalizeWebPeekUrl(rawUrl)
  if (!url) {
    toast.error('无法打开：不是有效的 http/https 链接')
    return false
  }
  try {
    await App.OpenBrowser(url)
    rememberWebPeekUrl(url)
    return true
  } catch (err) {
    console.error('[openSystemBrowser] failed:', err)
    toast.error('打开系统浏览器失败')
    return false
  }
}
