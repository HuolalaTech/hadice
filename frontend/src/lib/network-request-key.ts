import type { NetworkRequest } from '@/types/hdc'

export function getNetworkRequestKey(request: NetworkRequest): string {
  if (request.id) {
    return `request-${request.id}`
  }

  return request.extra?.id
    ? `id-${request.extra.id}-${request.extra.uid || ''}`
    : `url-${request.method}-${request.url}`
}
