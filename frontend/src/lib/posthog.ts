import posthog from 'posthog-js'
import { SetPosthogDistinctId } from '../../bindings/Hadice/backend/appservice'

const DISTINCT_ID_KEY = '__posthog_distinct_id__'

function getDistinctId(): string {
  let id = localStorage.getItem(DISTINCT_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DISTINCT_ID_KEY, id)
  }
  return id
}

export async function initPostHog(): Promise<void> {
  const apiKey = import.meta.env.VITE_POSTHOG_KEY
  const host = import.meta.env.VITE_POSTHOG_HOST
  if (!apiKey || !host) {
    return
  }

  const distinctId = getDistinctId()

  ;(posthog as any).init(apiKey, {
    api_host: host,
    persistence: 'localStorage',
    token: apiKey,
    identity: distinctId,
    session_recording: {
      maskAllInputs: true,
      blockClass: 'ph-block',
      maskTextClass: 'ph-mask',
    },
  })

  try {
    await SetPosthogDistinctId(distinctId)
  } catch (err) {
    console.warn('[PostHog] Failed to sync distinct ID to backend:', err)
  }
}

/**
 * 获取当前用户的 distinct_id
 */
export function getPostHogDistinctId(): string {
  return getDistinctId()
}

/**
 * 捕获一个 PostHog 事件
 */
export function captureEvent(event: string, properties?: Record<string, unknown>): void {
  if (!import.meta.env.VITE_POSTHOG_KEY) return
  posthog.capture(event, properties)
}

/**
 * 捕获一个异常到 PostHog
 */
export function capturePostHogException(error: unknown, additionalProperties?: Record<string, unknown>): void {
  if (!import.meta.env.VITE_POSTHOG_KEY) return
  if (error instanceof Error) {
    posthog.captureException(error, { additionalProperties })
  }
}

/**
 * 在应用退出前关闭 PostHog
 */
export function shutdownPostHog(): void {
  if (!import.meta.env.VITE_POSTHOG_KEY) return
  posthog.reset()
}
