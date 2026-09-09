import type { NetworkRequest } from '@/types/hdc'

function stringifyQueryValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 构建请求实际展示的完整 URL。
 * Sophon 上报的 Axios 配置通常把域名、路径和 query params 分开放置。
 */
export function buildNetworkRequestUrl(request: NetworkRequest): string {
  const requestUrl = request.fullUrl || request.url || ''
  let fullUrl = requestUrl

  if (
    request.baseURL &&
    requestUrl &&
    !requestUrl.startsWith('http://') &&
    !requestUrl.startsWith('https://')
  ) {
    const base = request.baseURL.replace(/\/+$/, '')
    const path = requestUrl.startsWith('/') || requestUrl.startsWith('?')
      ? requestUrl
      : `/${requestUrl}`
    fullUrl = `${base}${path}`
  }

  const params = request.requestParams
  if (!params || Object.keys(params).length === 0) return fullUrl || '-'

  const hashIndex = fullUrl.indexOf('#')
  const hash = hashIndex >= 0 ? fullUrl.slice(hashIndex) : ''
  const urlWithoutHash = hashIndex >= 0 ? fullUrl.slice(0, hashIndex) : fullUrl
  const queryIndex = urlWithoutHash.indexOf('?')
  const basePart = queryIndex >= 0 ? urlWithoutHash.slice(0, queryIndex) : urlWithoutHash
  const searchParams = new URLSearchParams(queryIndex >= 0 ? urlWithoutHash.slice(queryIndex + 1) : '')

  for (const [key, value] of Object.entries(params)) {
    if (!searchParams.has(key)) {
      searchParams.set(key, stringifyQueryValue(value))
    }
  }

  const query = searchParams.toString()
  return `${basePart}${query ? `?${query}` : ''}${hash}` || '-'
}

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
