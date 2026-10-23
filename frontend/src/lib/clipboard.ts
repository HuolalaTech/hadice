import { Clipboard } from '@wailsio/runtime'

/** 使用 Wails 原生 API 复制文本到系统剪贴板。 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await Clipboard.SetText(text)
    return true
  } catch {
    return false
  }
}
