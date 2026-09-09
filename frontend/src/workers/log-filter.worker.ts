import type { LogEntry, LogLevel } from '@/types/hdc'

// ── Filter Types ──────────────────────────────────────────────────────────────

export interface FilterConfig {
  levelFilter: LogLevel[]
  tagFilter: string
  keywordFilter: string
  useRegex: boolean
  dedupEnabled: boolean
  suppressionRules: SuppressionRule[]
  aggregationEnabled: boolean
  aggregationWindowMs: number
}

export interface SuppressionRule {
  id: string
  tag: string
  level?: LogLevel
  enabled: boolean
}

export interface StageStats {
  inputCount: number
  outputCount: number
  removed: number
}

export interface FilterStats {
  totalInput: number
  totalOutput: number
  stageStats: Record<string, StageStats>
}

type WorkerRequest =
  | { type: 'filter'; entries: LogEntry[]; config: FilterConfig; requestId: number }
  | { type: 'updateConfig'; config: Partial<FilterConfig> }

type WorkerResponse =
  | { type: 'filter_result'; entries: LogEntry[]; stats: FilterStats; requestId: number }
  | { type: 'error'; message: string; requestId?: number }

// ── Filter Stage Interface ────────────────────────────────────────────────────

interface FilterStage {
  name: string
  apply: (entries: LogEntry[], config: FilterConfig) => LogEntry[]
  priority: number
}

// ── Stage 1: Level Filter ────────────────────────────────────────────────────

const levelFilter: FilterStage = {
  name: 'levelFilter',
  priority: 10,
  apply(entries, config) {
    if (!config.levelFilter || config.levelFilter.length === 0) return entries
    return entries.filter((e) => config.levelFilter.includes(e.level as LogLevel))
  },
}

// ── Stage 2: Tag Filter ──────────────────────────────────────────────────────

const tagFilter: FilterStage = {
  name: 'tagFilter',
  priority: 20,
  apply(entries, config) {
    if (!config.tagFilter.trim()) return entries
    const tags = config.tagFilter.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
    if (tags.length === 0) return entries
    return entries.filter((e) =>
      tags.some((t) => e.tag.toLowerCase().includes(t))
    )
  },
}

// ── Stage 3: Keyword Filter ──────────────────────────────────────────────────

const keywordFilter: FilterStage = {
  name: 'keywordFilter',
  priority: 30,
  apply(entries, config) {
    if (!config.keywordFilter.trim()) return entries
    const keyword = config.keywordFilter.toLowerCase()
    if (config.useRegex) {
      try {
        const regex = new RegExp(config.keywordFilter, 'i')
        return entries.filter(
          (e) => regex.test(e.tag) || regex.test(e.message) || regex.test(e.raw)
        )
      } catch {
        return entries // Invalid regex: passthrough
      }
    }
    return entries.filter(
      (e) =>
        e.tag.toLowerCase().includes(keyword) ||
        e.message.toLowerCase().includes(keyword) ||
        e.raw.toLowerCase().includes(keyword)
    )
  },
}

// ── Stage 4: Suppression Filter ──────────────────────────────────────────────

const suppressionFilter: FilterStage = {
  name: 'suppressionFilter',
  priority: 40,
  apply(entries, config) {
    const activeRules = config.suppressionRules.filter((r) => r.enabled)
    if (activeRules.length === 0) return entries
    return entries.filter((e) => {
      return !activeRules.some((rule) => {
        const tagMatch = e.tag.toLowerCase().includes(rule.tag.toLowerCase())
        const levelMatch = !rule.level || (e.level as string) === rule.level
        return tagMatch && levelMatch
      })
    })
  },
}

// ── Stage 5: Duplicate Merge Filter ──────────────────────────────────────────

const dedupFilter: FilterStage = {
  name: 'dedupFilter',
  priority: 50,
  apply(entries, config) {
    if (!config.dedupEnabled) return entries
    const result: LogEntry[] = []
    let dupCount = 0
    for (let i = 0; i < entries.length; i++) {
      const prev = result[result.length - 1]
      if (prev && prev.message === entries[i].message) {
        dupCount++
      } else {
        if (dupCount > 0 && result.length > 0) {
          const last = result[result.length - 1]
          result[result.length - 1] = {
            ...last,
            message: `${last.message} (×${dupCount + 1})`,
          }
          dupCount = 0
        }
        result.push(entries[i])
      }
    }
    if (dupCount > 0 && result.length > 0) {
      const last = result[result.length - 1]
      result[result.length - 1] = {
        ...last,
        message: `${last.message} (×${dupCount + 1})`,
      }
    }
    return result
  },
}

// ── Stage 6: Aggregation Filter ──────────────────────────────────────────────

const aggregationFilter: FilterStage = {
  name: 'aggregationFilter',
  priority: 60,
  apply(entries, config) {
    if (!config.aggregationEnabled) return entries
    const windowMs = Math.max(1, config.aggregationWindowMs || 1000)
    const groups = new Map<string, LogEntry[]>()

    for (const entry of entries) {
      const timestamp = entry.timestamp || 0
      const bucket = Math.floor(timestamp / windowMs)
      const key = `${bucket}:${entry.tag}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(entry)
    }

    const result: LogEntry[] = []
    for (const [, group] of groups) {
      if (group.length >= 3) {
        const first = group[0]
        result.push({
          ...first,
          message: `[${group.length} 条] ${first.tag} 日志已聚合`,
        })
      } else {
        result.push(...group)
      }
    }
    return result
  },
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

const stages: FilterStage[] = [
  levelFilter,
  tagFilter,
  keywordFilter,
  suppressionFilter,
  dedupFilter,
  aggregationFilter,
].sort((a, b) => a.priority - b.priority)

let currentConfig: FilterConfig = {
  levelFilter: [],
  tagFilter: '',
  keywordFilter: '',
  useRegex: false,
  dedupEnabled: false,
  suppressionRules: [],
  aggregationEnabled: false,
  aggregationWindowMs: 1000,
}

function runPipeline(entries: LogEntry[], config: FilterConfig): {
  filtered: LogEntry[]
  stats: FilterStats
} {
  const stageStats: Record<string, StageStats> = {}
  let current = entries

  for (const stage of stages) {
    const inputCount = current.length
    current = stage.apply(current, config)
    stageStats[stage.name] = {
      inputCount,
      outputCount: current.length,
      removed: inputCount - current.length,
    }
  }

  return {
    filtered: current,
    stats: {
      totalInput: entries.length,
      totalOutput: current.length,
      stageStats,
    },
  }
}

// ── Message Handler ───────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data

  if (msg.type === 'updateConfig') {
    currentConfig = { ...currentConfig, ...msg.config }
    return
  }

  if (msg.type === 'filter') {
    const { filtered, stats } = runPipeline(msg.entries, currentConfig)
    const response: WorkerResponse = {
      type: 'filter_result',
      entries: filtered,
      stats,
      requestId: msg.requestId,
    }
    self.postMessage(response)
  }
}
