import * as App from '../../../bindings/Hadice/backend/appservice.js'
import { EventsOn } from '../../../wailsjs/runtime/runtime'

export interface TrackLogEvent {
  id: string
  event: string
  json: string
  timestamp: number
  pushSign?: string
  pushClient?: string
}

export interface TrackLogStatus {
  running: boolean
  port: number
  hostHint: string
  deviceId?: string
  clientCount: number
  eventCount: number
  received?: number
  parsed?: number
  error?: string
}

function unwrapError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

function asStatus(status: unknown): TrackLogStatus {
  const s = (status || {}) as Partial<TrackLogStatus> & { DeviceID?: string }
  const deviceId = s.deviceId || s.DeviceID || undefined
  return {
    running: Boolean(s.running),
    port: Number(s.port) || 8888,
    hostHint: s.hostHint || '127.0.0.1:8888',
    deviceId: deviceId || undefined,
    clientCount: Number(s.clientCount) || 0,
    eventCount: Number(s.eventCount) || 0,
    received: Number(s.received) || 0,
    parsed: Number(s.parsed) || 0,
    error: s.error || undefined,
  }
}

function coerceJsonField(value: unknown): string {
  if (typeof value === 'string') return value || '{}'
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return '{}'
    }
  }
  return '{}'
}

function asEvent(data: unknown): TrackLogEvent | null {
  if (!data || typeof data !== 'object') return null
  const row = data as Partial<TrackLogEvent> & { JSON?: unknown }
  if (!row.event && !row.id) return null
  return {
    id: row.id || '',
    event: row.event || '(unknown)',
    json: coerceJsonField(row.json ?? row.JSON),
    timestamp: Number(row.timestamp) || Date.now(),
    pushSign: row.pushSign,
    pushClient: row.pushClient,
  }
}

function asEventList(data: unknown): TrackLogEvent[] {
  // Go 发 { events: [...] }；兼容误发裸数组
  let rows: unknown[] = []
  if (Array.isArray(data)) {
    rows = data
  } else if (data && typeof data === 'object' && Array.isArray((data as { events?: unknown }).events)) {
    rows = (data as { events: unknown[] }).events
  }
  const out: TrackLogEvent[] = []
  for (const row of rows) {
    const ev = asEvent(row)
    if (ev) out.push(ev)
  }
  return out
}

export const trackLogAPI = {
  start: async (deviceId: string, port = 8888): Promise<TrackLogStatus> => {
    try {
      return asStatus(await App.StartTrackLogServer(deviceId, port))
    } catch (error) {
      throw new Error(unwrapError(error))
    }
  },

  stop: async (deviceId: string): Promise<TrackLogStatus> => {
    try {
      return asStatus(await App.StopTrackLogServer(deviceId))
    } catch (error) {
      throw new Error(unwrapError(error))
    }
  },

  status: async (): Promise<TrackLogStatus> => {
    try {
      return asStatus(await App.GetTrackLogStatus())
    } catch {
      return asStatus(null)
    }
  },

  clear: async (): Promise<void> => {
    try {
      await App.ClearTrackLogs()
    } catch (error) {
      throw new Error(unwrapError(error))
    }
  },

  onEvent: (callback: (event: TrackLogEvent) => void): (() => void) => {
    return EventsOn('trackLog:received', (data: unknown) => {
      const event = asEvent(data)
      if (event) callback(event)
    })
  },

  onSnapshot: (callback: (events: TrackLogEvent[]) => void): (() => void) => {
    return EventsOn('trackLog:snapshot', (data: unknown) => {
      callback(asEventList(data))
    })
  },

  onStatus: (callback: (status: TrackLogStatus) => void): (() => void) => {
    return EventsOn('trackLog:status', (data: unknown) => {
      callback(asStatus(data))
    })
  },

  errorMessage: unwrapError,
}
