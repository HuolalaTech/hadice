import { create } from 'zustand'
import { trackLogAPI, type TrackLogEvent, type TrackLogStatus } from '@/lib/hdc-api/track-log'

interface TrackLogState {
  events: TrackLogEvent[]
  selectedId: string | null
  searchQuery: string
  status: TrackLogStatus
  unsubscribers: Array<() => void>
  start: (deviceId: string, port?: number) => Promise<TrackLogStatus>
  stop: (deviceId: string) => Promise<TrackLogStatus>
  clear: () => Promise<void>
  select: (id: string | null) => void
  setSearchQuery: (query: string) => void
  listen: () => void
  unlisten: () => void
}

const idleStatus: TrackLogStatus = {
  running: false,
  port: 8888,
  hostHint: '127.0.0.1:8888',
  clientCount: 0,
  eventCount: 0,
  received: 0,
  parsed: 0,
}

function normalizeStatus(status: TrackLogStatus | null | undefined): TrackLogStatus {
  if (!status || typeof status !== 'object') return { ...idleStatus }
  return {
    running: Boolean(status.running),
    port: Number(status.port) || idleStatus.port,
    hostHint: status.hostHint || idleStatus.hostHint,
    deviceId: status.deviceId || undefined,
    clientCount: Number(status.clientCount) || 0,
    eventCount: Number(status.eventCount) || 0,
    received: Number(status.received) || 0,
    parsed: Number(status.parsed) || 0,
    error: status.error || undefined,
  }
}

export const useTrackLogStore = create<TrackLogState>((set, get) => ({
  events: [],
  selectedId: null,
  searchQuery: '',
  status: idleStatus,
  unsubscribers: [],

  listen: () => {
    if (get().unsubscribers.length > 0) return
    try {
      // 快照为准；单条 received 作增量，防抖快照到达前先能看见
      const offSnap = trackLogAPI.onSnapshot((events) => {
        set({ events })
      })
      const offEvent = trackLogAPI.onEvent((event) => {
        set((state) => {
          if (event.id && state.events.some((row) => row.id === event.id)) {
            return {
              events: state.events.map((row) => {
                if (row.id !== event.id) return row
                const next = (event.json || '').trim()
                const prev = (row.json || '').trim()
                const nextEmpty = !next || next === '{}' || next === '{\n}'
                const prevEmpty = !prev || prev === '{}' || prev === '{\n}'
                if (nextEmpty) return row
                if (prevEmpty || next.length > prev.length) return event
                return row
              }),
            }
          }
          return { events: [...state.events, event] }
        })
      })
      const offStatus = trackLogAPI.onStatus((status) => {
        set({ status: normalizeStatus(status) })
      })
      set({
        unsubscribers: [offSnap, offEvent, offStatus].filter(
          (fn) => typeof fn === 'function'
        ),
      })
    } catch (err) {
      console.error('[TrackLog] listen failed:', err)
    }
    // GetTrackLogStatus 会副作用推 snapshot
    void trackLogAPI
      .status()
      .then((status) => set({ status: normalizeStatus(status) }))
      .catch(() => {})
  },

  unlisten: () => {
    for (const off of get().unsubscribers) {
      try {
        off()
      } catch {
        /* ignore */
      }
    }
    set({ unsubscribers: [] })
  },

  start: async (deviceId, port = 8888) => {
    get().listen()
    const status = normalizeStatus(await trackLogAPI.start(deviceId, port))
    set({ status })
    if (status.error && !status.running) throw new Error(status.error)
    return status
  },

  stop: async (deviceId) => {
    const status = normalizeStatus(await trackLogAPI.stop(deviceId))
    set({ status })
    return status
  },

  clear: async () => {
    await trackLogAPI.clear()
    set({ events: [], selectedId: null })
  },

  select: (id) => set({ selectedId: id }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),
}))
