import { Clipboard } from '@wailsio/runtime'

/**
 * 复制文本到系统剪贴板。
 *
 * 桌面端优先使用 Wails 原生剪贴板，避免 WebView 中 navigator.clipboard
 * 因权限或安全上下文限制失效；浏览器预览环境再依次使用 Web API 和兼容回退。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await Clipboard.SetText(text)
    return true
  } catch {
    // 非 Wails 浏览器环境继续尝试 Web Clipboard API。
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续使用 execCommand 兼容回退。
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}
