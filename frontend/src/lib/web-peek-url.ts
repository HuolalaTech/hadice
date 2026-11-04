/**
 * 规范化并校验「网页看看」地址：无 scheme 时补 https://；仅允许 http/https。
 * 非法返回 ''。
 */
export function normalizeWebPeekUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''

  let candidate = trimmed
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
    candidate = `https://${candidate}`
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return ''
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
  return parsed.href
}
