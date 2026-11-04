/** 终端 ANSI（与列表 Tailwind 语义对齐：W 黄 / E 红 / I 绿 …） */
export const LOG_LEVEL_ANSI: Record<string, string> = {
  D: '\x1b[36m', // cyan
  I: '\x1b[32m', // green
  W: '\x1b[33m', // yellow
  E: '\x1b[31m', // red
  F: '\x1b[35m', // magenta
  V: '\x1b[37m', // white
}

export const LOG_LEVEL_ANSI_RESET = '\x1b[0m'

/** 列表视图 class */
export const LOG_LEVEL_TEXT_CLASS: Record<string, string> = {
  F: 'text-purple-400',
  E: 'text-red-400',
  W: 'text-yellow-400',
  I: 'text-green-400',
  D: 'text-cyan-400',
  V: 'text-muted-foreground/80',
}

const ANSI_RE = /\x1b\[[0-9;]*m/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

/** 归一化级别字母；兼容 hilog -v color 把 ANSI 掺进 level 字段的情况 */
export function normalizeLogLevel(level: string | undefined | null): string {
  if (!level) return ''
  const cleaned = stripAnsi(level).trim().toUpperCase()
  const m = cleaned.match(/[VDIWEF]/)
  return m ? m[0] : cleaned.slice(0, 1)
}

/** 空 levels = 不过滤（全显示）；与 worker levelFilter 语义一致 */
export function entryPassesLevelFilter(
  entry: { level?: string },
  levels: string[] | null | undefined
): boolean {
  if (!levels || levels.length === 0) return true
  const lv = normalizeLogLevel(entry.level)
  return levels.includes(lv)
}

const LEVEL_ORDER = ['V', 'D', 'I', 'W', 'E', 'F'] as const

/**
 * 传给后端的最低级别（含更高级）。
 * 例：选了 I,W → 后端 -L I，减少 D/V 回灌；前端再精确滤到 I,W。
 */
export function minLevelForBackend(
  levels: string[] | null | undefined
): string | null {
  if (!levels || levels.length === 0) return null
  const set = new Set(levels.map((l) => normalizeLogLevel(l)))
  for (const l of LEVEL_ORDER) {
    if (set.has(l)) return l
  }
  return null
}

/** 终端行：安卓/鸿蒙统一用前端配色，不透传设备自带 ANSI */
export function formatLogLineForTerminal(entry: {
  level?: string
  time?: string
  tag?: string
  pid?: number
  message?: string
  raw?: string
}): string {
  const level = normalizeLogLevel(entry.level)
  const color = LOG_LEVEL_ANSI[level] || '\x1b[37m'
  const time = entry.time || ''
  const tag = entry.tag || ''
  let message = entry.message || ''
  if (!message && entry.raw) {
    message = stripAnsi(entry.raw)
  }
  let line = `${time} ${color}[${level || '?'}]${LOG_LEVEL_ANSI_RESET}`
  if (tag) line += ` ${tag}`
  if (entry.pid) line += ` (${entry.pid})`
  if (message) line += ` ${message}`
  return line + '\r\n'
}
