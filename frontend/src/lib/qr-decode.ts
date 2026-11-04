import jsQR from 'jsqr'

export function pickClipboardImage(event: ClipboardEvent): File | null {
  const file =
    event.clipboardData?.files?.[0] ??
    Array.from(event.clipboardData?.items ?? [])
      .find((item) => item.type.startsWith('image/'))
      ?.getAsFile() ??
    null
  if (!file || (file.type && !file.type.startsWith('image/'))) return null
  return file
}

/** 整段是链接则原样返回；否则取文本里第一段 http(s) URL。 */
export function extractHttpUrl(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed
  } catch {
    /* 二维码常夹说明文字，再扫一遍 */
  }
  const match = trimmed.match(/https?:\/\/[^\s<>"'，。；、【】（）]+/i)
  if (!match) return null
  return match[0].replace(/[)\].,;:]+$/u, '')
}

export async function decodeQrFromBlob(blob: Blob): Promise<string | null> {
  const src = await readAsDataUrl(blob)
  return decodeQrFromSrc(src)
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    // ponytail: WKWebView 下粘贴 blob: URL 会 onerror，DataURL 最稳
    reader.readAsDataURL(blob)
  })
}

export function decodeQrFromSrc(src: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error('图片加载失败'))
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth || image.width
      canvas.height = image.naturalHeight || image.height
      const ctx = canvas.getContext('2d')
      if (!ctx || canvas.width === 0 || canvas.height === 0) {
        resolve(null)
        return
      }
      ctx.drawImage(image, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(data.data, data.width, data.height)
      resolve(code?.data ?? null)
    }
    image.src = src
  })
}
