export function sanitizeOutputComponent(value: string | undefined, fallback: string): string {
  const sanitized = (value || '')
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
  return sanitized || fallback
}

export function formatOutputTimestamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function normalizeOutputPlatform(platform: string | undefined): 'android' | 'harmony' {
  return platform === 'android' ? 'android' : 'harmony'
}

export function getOutputDeviceName(device: {
  productName?: string
  model?: string
  deviceName?: string
  connectKey?: string
} | null | undefined): string {
  return sanitizeOutputComponent(
    device?.productName || device?.model || device?.deviceName || device?.connectKey,
    'device'
  )
}
