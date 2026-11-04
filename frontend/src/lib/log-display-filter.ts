import { entryPassesLevelFilter, normalizeLogLevel } from '@/lib/log-level-style'

/** 与列表 Worker 前四级过滤对齐（级别 / Tag / 关键字 / 抑制）；不含去重与聚合 */
export interface LogDisplayFilter {
  levels?: string[] | null
  tagFilter?: string
  keywordFilter?: string
  useRegex?: boolean
  suppressionRules?: Array<{
    tag: string
    level?: string
    enabled: boolean
  }>
}

function passesTagFilter(tag: string, tagFilter: string | undefined): boolean {
  if (!tagFilter?.trim()) return true
  const tags = tagFilter
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  if (tags.length === 0) return true
  const lower = (tag || '').toLowerCase()
  return tags.some((t) => lower.includes(t))
}

function passesKeywordFilter(
  entry: { tag?: string; message?: string; raw?: string },
  keywordFilter: string | undefined,
  useRegex: boolean | undefined
): boolean {
  if (!keywordFilter?.trim()) return true
  if (useRegex) {
    try {
      const regex = new RegExp(keywordFilter, 'i')
      return (
        regex.test(entry.tag || '') ||
        regex.test(entry.message || '') ||
        regex.test(entry.raw || '')
      )
    } catch {
      return true
    }
  }
  const keyword = keywordFilter.toLowerCase()
  return (
    (entry.tag || '').toLowerCase().includes(keyword) ||
    (entry.message || '').toLowerCase().includes(keyword) ||
    (entry.raw || '').toLowerCase().includes(keyword)
  )
}

function passesSuppression(
  entry: { tag?: string; level?: string },
  rules: LogDisplayFilter['suppressionRules']
): boolean {
  if (!rules || rules.length === 0) return true
  const tag = entry.tag || ''
  const level = normalizeLogLevel(entry.level)
  for (const rule of rules) {
    if (!rule.enabled) continue
    const tagMatch = tag.toLowerCase().includes(rule.tag.toLowerCase())
    const levelMatch = !rule.level || level === normalizeLogLevel(rule.level)
    if (tagMatch && levelMatch) return false
  }
  return true
}

export function entryPassesDisplayFilter(
  entry: {
    level?: string
    tag?: string
    message?: string
    raw?: string
  },
  filter: LogDisplayFilter
): boolean {
  if (!entryPassesLevelFilter(entry, filter.levels)) return false
  if (!passesTagFilter(entry.tag || '', filter.tagFilter)) return false
  if (!passesKeywordFilter(entry, filter.keywordFilter, filter.useRegex))
    return false
  if (!passesSuppression(entry, filter.suppressionRules)) return false
  return true
}
