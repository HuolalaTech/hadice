import React, { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { copyTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

function parseTrackJson(raw: string): unknown {
  const text = (raw || '').replace(/^\uFEFF/, '').trim()
  if (!text) return null
  try {
    let parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'string') {
      const inner = parsed.trim()
      if (
        (inner.startsWith('{') && inner.endsWith('}')) ||
        (inner.startsWith('[') && inner.endsWith(']'))
      ) {
        try {
          parsed = JSON.parse(inner)
        } catch {
          /* keep string */
        }
      }
    }
    return parsed
  } catch {
    return text
  }
}

function stringifyNode(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function previewScalar(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') {
    const s = value.length > 80 ? `${value.slice(0, 80)}…` : value
    return JSON.stringify(s)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function isExpandable(value: unknown): boolean {
  return value !== null && typeof value === 'object'
}

interface JsonNodeProps {
  name?: string
  value: unknown
  depth: number
  defaultOpen?: boolean
}

function JsonNode({ name, value, depth, defaultOpen = depth < 2 }: JsonNodeProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const [copied, setCopied] = useState(false)
  const expandable = isExpandable(value)

  const handleCopy = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const ok = await copyTextToClipboard(stringifyNode(value))
    if (ok) {
      setCopied(true)
      toast.success(name ? `已复制 ${name}` : '已复制节点')
      window.setTimeout(() => setCopied(false), 1200)
    } else {
      toast.error('复制失败')
    }
  }

  const copyBtn = (
    <button
      type="button"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 opacity-0 group-hover/node:opacity-100 hover:bg-muted hover:text-foreground"
      title="复制此节点"
      aria-label={name ? `复制 ${name}` : '复制节点'}
      onClick={(e) => void handleCopy(e)}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-700 dark:text-green-400" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  )

  if (!expandable) {
    return (
      <div
        className="group/node flex items-start gap-1 py-0.5 font-mono text-[12px] leading-5"
        style={{ paddingLeft: depth * 14 }}
      >
        {name != null && (
          <span className="shrink-0 text-sky-800 dark:text-sky-300">{name}</span>
        )}
        {name != null && <span className="text-muted-foreground dark:text-white/40">: </span>}
        <span
          className={cn(
            'min-w-0 break-all',
            typeof value === 'string' && 'text-amber-800 dark:text-amber-300',
            typeof value === 'number' && 'text-violet-800 dark:text-violet-300',
            typeof value === 'boolean' && 'text-rose-800 dark:text-rose-300',
            value === null && 'text-muted-foreground dark:text-white/45'
          )}
        >
          {previewScalar(value)}
        </span>
        {copyBtn}
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((item, i) => [String(i), item] as const)
    : Object.entries(value as Record<string, unknown>)
  const bracketOpen = Array.isArray(value) ? '[' : '{'
  const bracketClose = Array.isArray(value) ? ']' : '}'
  const summary = Array.isArray(value)
    ? `${value.length} items`
    : `${entries.length} keys`

  return (
    <div>
      <div
        className="group/node flex items-center gap-0.5 py-0.5 font-mono text-[12px] leading-5 cursor-pointer select-none"
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        {name != null && (
          <span className="shrink-0 text-sky-800 dark:text-sky-300">{name}</span>
        )}
        {name != null && <span className="text-muted-foreground dark:text-white/40">: </span>}
        <span className="text-muted-foreground dark:text-white/50">{bracketOpen}</span>
        {!open && (
          <span className="ml-1 text-[10px] text-muted-foreground/80 dark:text-white/40">{summary}</span>
        )}
        {!open && <span className="text-muted-foreground dark:text-white/50">{bracketClose}</span>}
        {copyBtn}
      </div>
      {open && (
        <>
          {entries.map(([key, child]) => (
            <JsonNode key={key} name={key} value={child} depth={depth + 1} />
          ))}
          <div
            className="font-mono text-[12px] leading-5 text-muted-foreground"
            style={{ paddingLeft: depth * 14 + 14 }}
          >
            {bracketClose}
          </div>
        </>
      )}
    </div>
  )
}

export interface TrackLogJsonViewProps {
  raw: string
  className?: string
}

function isEmptyParsed(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') {
    const t = value.trim()
    return !t || t === '{}' || t === '[]' || t === 'null'
  }
  if (typeof value !== 'object') return false
  if (Array.isArray(value)) return value.length === 0
  return Object.keys(value as Record<string, unknown>).length === 0
}

export function TrackLogJsonView({ raw, className }: TrackLogJsonViewProps): React.JSX.Element {
  const parsed = useMemo(() => parseTrackJson(raw), [raw])
  const pretty = useMemo(() => stringifyNode(parsed ?? raw), [parsed, raw])
  const empty = isEmptyParsed(parsed)

  const handleCopyAll = async (): Promise<void> => {
    const ok = await copyTextToClipboard(pretty)
    if (ok) toast.success('已复制全部 JSON')
    else toast.error('复制失败')
  }

  if (parsed === null || typeof parsed !== 'object') {
    return (
      <div className={cn('space-y-2', className)}>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => void handleCopyAll()}>
            <Copy className="h-3 w-3" />
            复制全部
          </Button>
        </div>
        <pre className="rounded-md border bg-muted p-3 text-xs font-mono whitespace-pre-wrap break-all">
          {pretty || '(空)'}
        </pre>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => void handleCopyAll()}>
          <Copy className="h-3 w-3" />
          复制全部
        </Button>
        <span className="text-[10px] text-muted-foreground">悬停节点可复制单字段</span>
      </div>
      {empty ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground space-y-1">
          <p>镜像包未带上 JSON（`log_data.data` 为空），左侧名称来自 url。</p>
          <p>正常应有 `event` / `properties` / `preset_properties`。若同条在其它日志站有内容，把该帧原文发我。</p>
        </div>
      ) : (
        <div className="rounded-md border bg-muted/40 p-2 overflow-auto">
          <JsonNode value={parsed} depth={0} defaultOpen />
        </div>
      )}
    </div>
  )
}
