import React, { useEffect, useMemo, useState } from 'react'
import {
  Wrench, Braces, GitCompare, Globe, Regex, Binary, Palette, QrCode, Clock3, KeyRound, Timer, Copy, Play, Pause, Fingerprint,
  Image as ImageIcon, PanelLeftClose, PanelLeftOpen, ChevronDown, ChevronRight, ChevronsUpDown, ChevronsDownUp, X, Trash2, History, FileCode2, GripVertical
} from 'lucide-react'
import { toast } from 'sonner'
import QRCodeLib from 'qrcode'
import jsQR from 'jsqr'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { cn, NAV_HIGHLIGHT_CLS, NAV_HIGHLIGHT_EASE, NAV_HIGHLIGHT_MS } from '@/lib/utils'
import * as App from '../../bindings/Hadice/backend/appservice'
import { EventsOn } from '../../wailsjs/runtime/runtime'

// ponytail: 全部工具收在单文件，用户已确认；超 ~1200 行或需单测时再拆 modules/handyTools
function useStored(key: string, init: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => { try { return localStorage.getItem(key) ?? init } catch { return init } })
  return [v, (next: string) => { setV(next); try { localStorage.setItem(key, next) } catch { /* ignore */ } }]
}
function copyText(text: string): void {
  if (!text) return
  const done = (): void => { toast.success('已复制') }
  const fallback = (): void => {
    // ponytail: Wails WebView 下 navigator.clipboard 常无权限/不可用，execCommand 兜底
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.focus(); ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      if (ok) done(); else toast.error('复制失败')
    } catch { toast.error('复制失败') }
  }
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback)
  else fallback()
}
function CopyBtn({ text }: { text: string }): React.JSX.Element {
  return <Button size="icon" variant="outline" title="复制" className="h-6 w-6 shrink-0 self-center" onClick={() => copyText(text)}><Copy className="h-3 w-3" /></Button>
}
function XInput(props: React.ComponentProps<typeof Input>): React.JSX.Element {
  const { value, onChange, className, ...rest } = props
  const show = value !== undefined && value !== null && String(value).length > 0
  return (
    <div className={cn('relative', className)}>
      <Input {...rest} value={value} onChange={onChange} className="w-full pr-7" />
      {show && onChange && <button type="button" title="清除" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-40 transition-opacity hover:opacity-100" onClick={() => onChange({ target: { value: '' } } as React.ChangeEvent<HTMLInputElement>)}><X className="h-3.5 w-3.5" /></button>}
    </div>
  )
}
function XTextarea(props: React.ComponentProps<typeof Textarea>): React.JSX.Element {
  const { value, onChange, className, ...rest } = props
  const show = value !== undefined && value !== null && String(value).length > 0
  return (
    <div className={cn('relative flex flex-col', className)}>
      <Textarea {...rest} value={value} onChange={onChange} className={cn(className, 'min-h-0 w-full flex-1 pr-7')} />
      {show && onChange && <button type="button" title="清除" className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground opacity-40 transition-opacity hover:opacity-100" onClick={() => onChange({ target: { value: '' } } as React.ChangeEvent<HTMLTextAreaElement>)}><X className="h-3.5 w-3.5" /></button>}
    </div>
  )
}
function parseList(s: string): string[] { try { const v: unknown = JSON.parse(s); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] } }
function HistoryList({ title, items, onDelete, onClear, onPick, fill }: { title: string; items: string[]; onDelete: (i: number) => void; onClear: () => void; onPick?: (item: string) => void; fill?: boolean }): React.JSX.Element {
  if (!items.length) return <></>
  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col' : undefined}>
      <div className="mb-1 flex items-center gap-2"><Label>{title}（{items.length}）</Label><Button size="sm" variant="ghost" className="h-6 gap-1 text-xs text-muted-foreground" onClick={onClear}><Trash2 className="h-3 w-3" />清空</Button></div>
      <div className={fill ? 'min-h-0 flex-1 space-y-1 overflow-auto' : 'max-h-40 space-y-1 overflow-auto'}>
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2 rounded border border-border px-2 py-1">
            {onPick
              ? <button type="button" title="点击恢复" className="min-w-0 flex-1 truncate text-left font-mono text-xs hover:text-primary" onClick={() => onPick(it)}>{it}</button>
              : <code className="min-w-0 flex-1 truncate font-mono text-xs">{it}</code>}
            <CopyBtn text={it} />
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" title="删除" onClick={() => onDelete(i)}><X className="h-3 w-3" /></Button>
          </div>
        ))}
      </div>
    </div>
  )
}
function Label({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mb-1 text-xs font-medium text-muted-foreground">{children}</div>
}
const taCls = 'font-mono text-xs min-h-[120px]'
/** 拖入高亮反馈：计数器防子元素 dragleave 闪烁；Wails 原生拖放也先触发 HTML5 dragenter/over */
function useDropHighlight(): { dragging: boolean; bind: Record<string, (e: React.DragEvent) => void> } {
  const [dragging, setDragging] = useState(false)
  const count = React.useRef(0)
  // macOS/Windows 原生拖拽不进 DOM，后端 WindowFileDraggingEntered/Exited 转发事件兜底亮框
  useEffect(() => {
    const offEnter = EventsOn('file-drag-enter', () => setDragging(true))
    const offExit = EventsOn('file-drag-exit', () => setDragging(false))
    const offDrop = EventsOn('files-dropped', () => setDragging(false))
    return () => { for (const off of [offEnter, offExit, offDrop]) if (typeof off === 'function') off() }
  }, [])
  const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  return {
    dragging,
    bind: {
      onDragEnter: (e) => { if (!hasFiles(e)) return; e.preventDefault(); count.current++; setDragging(true) },
      onDragOver: (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragging(true) },
      onDragLeave: (e) => { if (!hasFiles(e)) return; count.current--; if (count.current <= 0) { count.current = 0; setDragging(false) } },
      onDrop: () => { count.current = 0; setDragging(false) }
    }
  }
}

/* ---------------- JSON ---------------- */
function JsonNode({ name, value, signal }: { name?: string; value: unknown; signal: { seq: number; open: boolean } }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  useEffect(() => { if (signal.seq) setOpen(signal.open) }, [signal])
  const isObj = value !== null && typeof value === 'object'
  if (!isObj) {
    return (
      <div className="group flex items-center gap-1 rounded py-0.5 pl-4 hover:bg-primary/5">
        <span>{name !== undefined && <span className="text-primary">"{name}": </span>}<span className={typeof value === 'string' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}>{typeof value === 'string' ? `"${value}"` : String(value)}</span></span>
        <button type="button" title="复制该节点值" className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100" onClick={() => copyText(typeof value === 'string' ? value : JSON.stringify(value))}><Copy className="h-3 w-3" /></button>
      </div>
    )
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>)
  const bracket = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  return (
    <div className="pl-4">
      <div className="group flex items-center gap-1">
        <button type="button" className="flex items-center gap-1 py-0.5 hover:text-primary" onClick={() => setOpen(!open)}>
          <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform duration-300 [transition-timing-function:cubic-bezier(0.22,1.15,0.36,1)]', !open && '-rotate-90')} />
          {name !== undefined && <span className="text-primary">"{name}": </span>}<span>{bracket[0]}{!open && ` … ${entries.length} 项 ${bracket[1]}`}</span>
        </button>
        <button type="button" title="复制该节点 JSON" className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100" onClick={() => copyText(JSON.stringify(value, null, 2))}><Copy className="h-3 w-3" /></button>
      </div>
      <div className={cn('grid transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1.15,0.36,1)]', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <div className="min-h-0 overflow-hidden">
          {entries.map(([k, v]) => <JsonNode key={k} name={k} value={v} signal={signal} />)}
          <div className="py-0.5 pl-4">{bracket[1]}</div>
        </div>
      </div>
    </div>
  )
}
function JsonExpandButtons({ hasData, expanded, onExpand, onCollapse }: { hasData: boolean; expanded: boolean; onExpand: () => void; onCollapse: () => void }): React.JSX.Element {
  // 单按钮形变：已展开显示折叠图标、已折叠显示展开图标，点击后图标旋转缩放互转；无数据置灰
  return (
    <Button size="icon" variant="outline" disabled={!hasData} title={expanded ? '全部折叠' : '全部展开'}
      className={cn('h-7 w-7 overflow-hidden transition-transform duration-200 hover:scale-105 active:scale-90', !hasData && 'opacity-40')} onClick={expanded ? onCollapse : onExpand}>
      <span key={expanded ? 'collapse' : 'expand'} className="icon-morph flex">
        {expanded ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
      </span>
    </Button>
  )
}
function JsonTool(): React.JSX.Element {
  const [input, setInput] = useStored('hadice-handy-json', '{\n  "name": "Hadice",\n  "ok": true\n}')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState('')
  const [treeSignal, setTreeSignal] = useState({ seq: 0, open: true })
  const treeValue = useMemo(() => {
    for (const s of [output, input]) { try { return JSON.parse(s) as unknown } catch { /* try next */ } }
    return undefined
  }, [output, input])
  const run = (fn: (v: unknown) => string): void => {
    try { setOutput(fn(JSON.parse(input))); setErr('') } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => run((v) => JSON.stringify(v, null, 2))}>格式化</Button>
        <Button size="sm" variant="secondary" onClick={() => run((v) => JSON.stringify(v))}>压缩</Button>
        <Button size="sm" variant="secondary" onClick={() => run((v) => JSON.stringify(JSON.stringify(v)))}>转义</Button>
        <Button size="sm" variant="secondary" onClick={() => { try { const v: unknown = JSON.parse(input); setOutput(typeof v === 'string' ? v : JSON.stringify(v, null, 2)); setErr('') } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } }}>去转义</Button>
        <Button size="sm" variant="outline" onClick={() => run((v) => { setErr('JSON 合法'); return JSON.stringify(v, null, 2) })}>校验</Button>
        <CopyBtn text={output || (treeValue !== undefined ? JSON.stringify(treeValue, null, 2) : '')} />
      </div>
      {err && <div className={cn('text-xs', err === 'JSON 合法' ? 'text-green-600' : 'text-red-500')}>{err}</div>}
      <div className="grid min-h-0 flex-1 items-stretch gap-3 md:grid-cols-2">
        <div className="flex min-h-0 flex-col"><Label>输入</Label><XTextarea className={cn(taCls, 'min-h-0 flex-1 resize-none')} value={input} onChange={(e) => setInput(e.target.value)} /></div>
        <div className="flex min-h-0 flex-col">
          <div className="mb-1 flex items-center gap-2">
            <Label>输出（折叠视图，优先格式化结果）</Label>
            <JsonExpandButtons hasData={treeValue !== undefined} expanded={treeSignal.open} onExpand={() => setTreeSignal((s) => ({ seq: s.seq + 1, open: true }))} onCollapse={() => setTreeSignal((s) => ({ seq: s.seq + 1, open: false }))} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded border border-border p-2 font-mono text-xs">
            {treeValue !== undefined ? <JsonNode value={treeValue} signal={treeSignal} /> : <span className="text-muted-foreground">输入合法 JSON 后在此显示，压缩/转义结果请点上方「复制」取文本</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Diff（行级 LCS） ---------------- */
type DiffRow = { type: 'same' | 'add' | 'del'; text: string }
function lineDiff(a: string[], b: string[]): DiffRow[] {
  // ponytail: DP LCS O(n·m)，>2000 行直接拦截；大文件 diff 需换 Myers 时再升级
  const n = a.length, m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const rows: DiffRow[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ type: 'same', text: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', text: a[i] }); i++ }
    else { rows.push({ type: 'add', text: b[j] }); j++ }
  }
  while (i < n) rows.push({ type: 'del', text: a[i++] })
  while (j < m) rows.push({ type: 'add', text: b[j++] })
  return rows
}
function DiffTool(): React.JSX.Element {
  const [left, setLeft] = useStored('hadice-handy-diff-a', 'hello\nworld')
  const [right, setRight] = useStored('hadice-handy-diff-b', 'hello\nHadice\nworld')
  const tooBig = left.split('\n').length > 2000 || right.split('\n').length > 2000
  const rows = useMemo(() => (tooBig ? [] : lineDiff(left.split('\n'), right.split('\n'))), [left, right, tooBig])
  const add = rows.filter((r) => r.type === 'add').length, del = rows.filter((r) => r.type === 'del').length
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div><Label>原文</Label><XTextarea className={taCls} value={left} onChange={(e) => setLeft(e.target.value)} /></div>
        <div><Label>新文</Label><XTextarea className={taCls} value={right} onChange={(e) => setRight(e.target.value)} /></div>
      </div>
      <div className="text-xs text-muted-foreground">+{add} / -{del}{tooBig ? ' · 超过 2000 行已停止对比' : ''}</div>
      <div className="overflow-auto rounded border border-border font-mono text-xs">
        {rows.map((r, i) => (
          <div key={i} className={cn('whitespace-pre-wrap px-2 py-0.5', r.type === 'add' && 'bg-green-500/10 text-green-700 dark:text-green-400', r.type === 'del' && 'bg-red-500/10 text-red-600 dark:text-red-400')}>
            {r.type === 'add' ? '+ ' : r.type === 'del' ? '- ' : '  '}{r.text}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- 简易 Postman（走 Go 后端绕 CORS） ---------------- */
/** 折叠动画：快→慢 + 轻微过冲阻尼 */
const foldWrap = (open: boolean): string => cn('grid transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1.15,0.36,1)]', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')
interface HttpHistItem { method: string; url: string; headers: string; body: string; status: string; elapsed: number; respBody: string; respHeaders: Record<string, string>; time: string; ok: boolean }
function parseHttpHist(raw: string): HttpHistItem[] { try { const v: unknown = JSON.parse(raw); return Array.isArray(v) ? (v as HttpHistItem[]) : [] } catch { return [] } }
function PostmanTool(): React.JSX.Element {
  const [method, setMethod] = useStored('hadice-handy-http-method', 'GET')
  const [url, setUrl] = useStored('hadice-handy-http-url', 'https://httpbin.org/get')
  const [headers, setHeaders] = useStored('hadice-handy-http-headers', '{\n  "Content-Type": "application/json"\n}')
  const [body, setBody] = useStored('hadice-handy-http-body', '')
  const [resp, setResp] = useState<{ statusText: string; elapsed: number; headers: Record<string, string>; body: string } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [respOpen, setRespOpen] = useState(true)
  const [reqOpen, setReqOpen] = useState(true)
  const [reqHeadersOpen, setReqHeadersOpen] = useState(true)
  const [reqBodyOpen, setReqBodyOpen] = useState(true)
  const [headersOpen, setHeadersOpen] = useState(false)
  const [bodySignal, setBodySignal] = useState({ seq: 0, open: true })
  const [histRaw, setHistRaw] = useStored('hadice-handy-http-history', '[]')
  const [histOpen, setHistOpen] = useState(false)
  const httpHistory = parseHttpHist(histRaw)
  const pushHist = (item: HttpHistItem): void => setHistRaw(JSON.stringify([item, ...httpHistory].slice(0, 20)))
  const bodyJson = useMemo(() => { if (!resp) return undefined; try { return JSON.parse(resp.body) as unknown } catch { return undefined } }, [resp])
  const copyResp = resp ? JSON.stringify(resp.headers, null, 2) + '\n\n' + (bodyJson !== undefined ? JSON.stringify(bodyJson, null, 2) : resp.body) : error
  const send = async (): Promise<void> => {
    setLoading(true); setError('')
    try {
      const r = await App.HandySendHTTPRequest(method, url, headers, body)
      const item: HttpHistItem = { method, url, headers, body, status: r?.statusText ?? '', elapsed: r?.elapsedMs ?? 0, respBody: r?.body ?? '', respHeaders: (r?.headers ?? {}) as Record<string, string>, time: new Date().toLocaleString(), ok: true }
      setResp({ statusText: item.status, elapsed: item.elapsed, headers: item.respHeaders, body: item.respBody })
      pushHist(item); setRespOpen(true)
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); setResp(null); setError(msg); pushHist({ method, url, headers, body, status: '失败', elapsed: 0, respBody: msg, respHeaders: {}, time: new Date().toLocaleString(), ok: false }); setRespOpen(true) } finally { setLoading(false) }
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <XInput className="flex-1 font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        <Button size="sm" disabled={loading} onClick={() => void send()}><Play className="mr-1 h-3 w-3" />{loading ? '发送中' : '发送'}</Button>
        <CopyBtn text={copyResp} />
        <Button size="sm" variant={histOpen ? 'secondary' : 'outline'} className="gap-1" aria-expanded={histOpen} onClick={() => setHistOpen(!histOpen)}><History className="h-3.5 w-3.5" />请求历史{httpHistory.length > 0 && <Badge variant="secondary">{httpHistory.length}</Badge>}</Button>
      </div>
      <div className={foldWrap(histOpen)}><div className="min-h-0 overflow-hidden">
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center justify-between bg-muted/40 px-3 py-2">
            <span className="text-xs font-medium">请求历史</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={!httpHistory.length} onClick={() => setHistRaw('[]')}><Trash2 className="h-3 w-3" />清空</Button>
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setHistOpen(false)}><X className="h-3 w-3" />关闭</Button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto">
            {!httpHistory.length && <div className="p-4 text-center text-xs text-muted-foreground">暂无请求记录</div>}
            {httpHistory.map((h, i) => (
              <div key={i} className="flex items-center gap-2 border-t border-border px-3 py-2 first:border-t-0">
                <Badge variant={h.ok ? 'success' : 'destructive'}>{h.ok ? h.status.split(' ')[0] || 'OK' : '失败'}</Badge>
                <span className="w-14 shrink-0 font-mono text-xs font-medium">{h.method}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={h.url}>{h.url}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{h.time} · {h.elapsed}ms</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setMethod(h.method); setUrl(h.url); setHeaders(h.headers); setBody(h.body); setError(h.ok ? '' : h.respBody); setResp(h.ok ? { statusText: h.status, elapsed: h.elapsed, headers: h.respHeaders, body: h.respBody } : null); setRespOpen(true) }}>恢复</Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="删除" onClick={() => setHistRaw(JSON.stringify(httpHistory.filter((_, x) => x !== i)))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </div>
            ))}
          </div>
        </div>
      </div></div>
      <div className="overflow-hidden rounded-lg border border-border">
        <button type="button" className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left text-xs font-medium hover:bg-muted/60" aria-expanded={reqOpen} onClick={() => setReqOpen(!reqOpen)}>
          {reqOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}请求（Headers + Body）
          <span className="font-normal text-muted-foreground">整体折叠不影响内部单面板状态</span>
        </button>
        <div className={foldWrap(reqOpen)}><div className="min-h-0 overflow-hidden"><div className="p-2">
      <div className="grid items-start gap-3 md:grid-cols-2">
        {([
          { title: 'Headers（JSON）', open: reqHeadersOpen, toggle: () => setReqHeadersOpen(!reqHeadersOpen), value: headers, onChange: setHeaders, placeholder: '' },
          { title: 'Body', open: reqBodyOpen, toggle: () => setReqBodyOpen(!reqBodyOpen), value: body, onChange: setBody, placeholder: '' }
        ] as const).map((p) => (
          <div key={p.title} className="overflow-hidden rounded-lg border border-border">
            <button type="button" className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left text-xs font-medium hover:bg-muted/60" aria-expanded={p.open} onClick={p.toggle}>
              {p.open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{p.title}
            </button>
            <div className={foldWrap(p.open)}><div className="min-h-0 overflow-hidden"><div className="p-2"><XTextarea className={cn(taCls, 'border-0 shadow-none focus-visible:ring-0')} value={p.value} onChange={(e) => p.onChange(e.target.value)} /></div></div></div>
          </div>
        ))}
      </div>
        </div></div></div>
      </div>
      {(resp || error) && (
        <div className="overflow-hidden rounded-lg border border-border">
          <button type="button" className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left text-xs font-medium hover:bg-muted/60" onClick={() => setRespOpen(!respOpen)}>
            {respOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            响应 {resp ? <span className="font-mono text-muted-foreground">{resp.statusText} · {resp.elapsed}ms{bodyJson !== undefined ? ' · JSON 已自动美化' : ''}</span> : <span className="text-red-500">请求失败</span>}
          </button>
          <div className={foldWrap(respOpen)}><div className="min-h-0 overflow-hidden"><div className="space-y-3 p-3">
            {error && <div className="whitespace-pre-wrap font-mono text-xs text-red-500">{error}</div>}
            {resp && <>
              <div className="overflow-hidden rounded border border-border">
                <button type="button" className="flex w-full items-center gap-2 bg-muted/30 px-2 py-1.5 text-left text-xs hover:bg-muted/50" onClick={() => setHeadersOpen(!headersOpen)}>
                  {headersOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}Headers（{Object.keys(resp.headers).length}）
                </button>
                <div className={foldWrap(headersOpen)}><div className="min-h-0 overflow-hidden"><pre className="max-h-48 overflow-auto p-2 font-mono text-xs">{JSON.stringify(resp.headers, null, 2)}</pre></div></div>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <Label>Body</Label>
                  {bodyJson !== undefined && <>
                    <JsonExpandButtons hasData={bodyJson !== undefined} expanded={bodySignal.open} onExpand={() => setBodySignal((s) => ({ seq: s.seq + 1, open: true }))} onCollapse={() => setBodySignal((s) => ({ seq: s.seq + 1, open: false }))} />
                  </>}
                </div>
                {bodyJson !== undefined
                  ? <div className="max-h-[420px] overflow-auto rounded border border-border p-2 font-mono text-xs"><JsonNode value={bodyJson} signal={bodySignal} /></div>
                  : <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded border border-border p-2 font-mono text-xs">{resp.body}</pre>}
              </div>
            </>}
          </div></div></div>
        </div>
      )}
    </div>
  )
}

/* ---------------- 正则 ---------------- */
const REGEX_PRESETS: { name: string; pattern: string; sample: string }[] = [
  { name: '邮箱', sample: 'test@example.com', pattern: '^[\\w.-]+@[\\w-]+(\\.[\\w-]+)+$' },
  { name: '手机号(国内)', sample: '13800138000', pattern: '^1[3-9]\\d{9}$' },
  { name: 'URL', sample: 'https://example.com/path?id=1', pattern: '^https?://[\\w.-]+(:\\d+)?(/\\S*)?$' },
  { name: 'IPv4', sample: '192.168.1.1', pattern: '^((25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1?\\d?\\d)$' },
  { name: '日期 YYYY-MM-DD', sample: '2026-10-20', pattern: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$' },
  { name: '时间 HH:mm:ss', sample: '09:46:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d$' },
  { name: '身份证(18位)', sample: '11010119900101123X', pattern: '^[1-9]\\d{5}(18|19|20)\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]$' },
  { name: '十六进制颜色', sample: '#43ad7f', pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' },
  { name: '用户名(字母开头4-16)', sample: 'hadice_01', pattern: '^[a-zA-Z][a-zA-Z0-9_]{3,15}$' },
  { name: '强密码(大小写+数字8+)', sample: 'Hadice123', pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$' },
  { name: '纯中文', sample: '便捷工具', pattern: '^[\\u4e00-\\u9fa5]+$' },
  { name: '邮编', sample: '518000', pattern: '^[1-9]\\d{5}$' },
  { name: 'QQ号', sample: '12345678', pattern: '^[1-9][0-9]{4,10}$' },
  { name: '版本号 semver', sample: '1.2.3-beta.1', pattern: '^\\d+\\.\\d+\\.\\d+(-[\\w.]+)?$' },
  { name: 'UUID', sample: '85a6f86e-8114-4e33-b0e2-caf94ed85507', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' },
  { name: 'MAC地址', sample: '00:1A:2B:3C:4D:5E', pattern: '^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$' }
]
const REGEX_CHEATS: [string, string][] = [
  ['\\d / \\D', '数字 / 非数字'], ['\\w / \\W', '字母数字下划线 / 非'], ['\\s / \\S', '空白 / 非空白'],
  ['. * + ?', '任意 / 0+ / 1+ / 0或1'], ['{n,m}', '重复 n~m 次'], ['^ $', '行首 / 行尾'],
  ['[a-z] [^a-z]', '字符集 / 取反'], ['(?=...) (?!...)', '正向 / 负向预查'], ['\\b', '单词边界']
]
function RegexTool(): React.JSX.Element {
  const [pattern, setPattern] = useStored('hadice-handy-regex', '\\d+')
  const [flags, setFlags] = useStored('hadice-handy-regex-flags', 'g')
  const [text, setText] = useStored('hadice-handy-regex-text', 'Hadice 2026 build 42')
  const { matches, err } = useMemo(() => {
    try {
      const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g')
      const out: { text: string; index: number }[] = []
      let m: RegExpExecArray | null
      let guard = 0
      while ((m = re.exec(text)) !== null && guard++ < 500) { out.push({ text: m[0], index: m.index }); if (m[0] === '') re.lastIndex++ }
      return { matches: out, err: '' }
    } catch (e) { return { matches: [], err: e instanceof Error ? e.message : String(e) } }
  }, [pattern, flags, text])
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <XInput className="flex-1 font-mono text-xs" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="正则，如 \d+" />
        <XInput className="w-24 font-mono text-xs" value={flags} onChange={(e) => setFlags(e.target.value)} placeholder="flags" />
      </div>
      {err ? <div className="text-xs text-red-500">正则无效：{err}</div> : <div className="text-xs text-green-600 dark:text-green-400">即时验证：命中 {matches.length} 处（输入即验证，无需点按钮）</div>}
      <div><Label>测试文本</Label><XTextarea className={taCls} value={text} onChange={(e) => setText(e.target.value)} /></div>
      <div className="flex flex-wrap gap-1">{matches.map((m, i) => <span key={i} className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary">{m.text}@{m.index}</span>)}</div>
      <div>
        <Label>常用正则（点击同时切换示例测试文本）</Label>
        <div className="flex flex-wrap gap-1">{REGEX_PRESETS.map((p) => <Button key={p.name} size="sm" variant="outline" className="h-7 text-xs" title={p.pattern} onClick={() => { setPattern(p.pattern); setText(p.sample) }}>{p.name}</Button>)}</div>
      </div>
      <div>
        <Label>语法速查（点击整体替换到正则输入框）</Label>
        <div className="grid gap-1 md:grid-cols-3">{REGEX_CHEATS.map(([k, v]) => <button key={k} type="button" title={`替换为 ${k.split(' ')[0]}`} className="rounded border border-border px-2 py-1 text-left text-xs transition-colors hover:border-primary/50 hover:bg-primary/5" onClick={() => setPattern(k.split(' ')[0])}><span className="font-mono text-primary">{k}</span> <span className="text-muted-foreground">{v}</span></button>)}</div>
      </div>
    </div>
  )
}

/* ---------------- 编码 / 哈希 ---------------- */
function bytesToB64(bytes: Uint8Array): string { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b) }); return btoa(s) }
function b64ToBytes(s: string): Uint8Array { const bin = atob(s.trim().replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.trim().length / 4) * 4, '=')); return Uint8Array.from(bin, (c) => c.charCodeAt(0)) }
async function sha(algo: string, text: string): Promise<string> {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** 纯 JS MD5（WebCrypto 不支持）；按 RFC 1321 处理 UTF-8 字节 */
function md5Hex(text: string): string {
  const src = new TextEncoder().encode(text)
  const buf = new Uint8Array((((src.length + 8) >> 6) + 1) << 6)
  buf.set(src); buf[src.length] = 0x80
  const dv = new DataView(buf.buffer); dv.setUint32(buf.length - 8, src.length * 8, true); dv.setUint32(buf.length - 4, Math.floor(src.length / 536870912), true)
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0)
  let A = 0x67452301, B = 0xefcdab89, C = 0x98badcfe, D = 0x10325476
  for (let off = 0; off < buf.length; off += 64) {
    const M = Array.from({ length: 16 }, (_, i) => dv.getUint32(off + i * 4, true))
    let [a, b, c, d] = [A, B, C, D]
    for (let i = 0; i < 64; i++) {
      let f: number, g: number
      if (i < 16) { f = (b & c) | (~b & d); g = i } else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 } else { f = c ^ (b | ~d); g = (7 * i) % 16 }
      f = (f + a + K[i] + M[g]) >>> 0
      const rot = ((f << S[i]) | (f >>> (32 - S[i]))) >>> 0
      const tmp = d; d = c; c = b; b = (b + rot) >>> 0; a = tmp
    }
    A = (A + a) >>> 0; B = (B + b) >>> 0; C = (C + c) >>> 0; D = (D + d) >>> 0
  }
  return [A, B, C, D].map((w) => [0, 8, 16, 24].map((s) => ((w >>> s) & 0xff).toString(16).padStart(2, '0')).join('')).join('')
}
const unicodeEncode = (s: string): string => Array.from(s).map((c) => '\\u' + (c.codePointAt(0) ?? 0).toString(16).padStart(4, '0')).join('')
const utf16Encode = (s: string): string => Array.from({ length: s.length }, (_, i) => '\\u' + s.charCodeAt(i).toString(16).padStart(4, '0')).join('')
const unicodeDecode = (s: string): string => s.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (_, a: string, b: string) => String.fromCodePoint(parseInt(a ?? b, 16)))
const hexEncode = (s: string): string => Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, '0')).join('')
function hexToBytes(s: string): Uint8Array {
  const hex = s.replace(/0x/gi, '').replace(/[\s,;]/g, '')
  if (!hex || hex.length % 2 || /[^0-9a-fA-F]/.test(hex)) throw new Error('十六进制格式无效（需偶数位 0-9/a-f）')
  return Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))
}
const htmlEncode = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
function htmlDecode(s: string): string { const ta = document.createElement('textarea'); ta.innerHTML = s; return ta.value }
const stringEscape = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/[\b]/g, '\\b').replace(/\f/g, '\\f')
function stringUnescape(s: string): string {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e: string) => {
    if (e.startsWith('u{')) return String.fromCodePoint(parseInt(e.slice(2, -1), 16))
    if (e.startsWith('u')) return String.fromCharCode(parseInt(e.slice(1), 16))
    if (e.startsWith('x')) return String.fromCharCode(parseInt(e.slice(1), 16))
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' } as Record<string, string>)[e] ?? e
  })
}
async function gzipCompress(s: string): Promise<string> {
  if (typeof CompressionStream === 'undefined') throw new Error('当前 WebView 不支持 CompressionStream，无法 Gzip 压缩')
  const buf = await new Response(new Blob([new TextEncoder().encode(s)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  return bytesToB64(new Uint8Array(buf))
}
async function gzipDecompress(s: string): Promise<string> {
  if (typeof DecompressionStream === 'undefined') throw new Error('当前 WebView 不支持 DecompressionStream，无法 Gzip 解压')
  const bytes = b64ToBytes(s); if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('不是 Gzip 数据（缺少 1f 8b 魔数，需 Base64 编码的 Gzip）')
  const buf = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  return new TextDecoder().decode(buf)
}
/** 无 schema 的 Protobuf 线格式通用解析：varint / i64 / len / i32，len 优先尝试嵌套消息，其次 UTF-8 文本 */
function parseProtoBytes(bytes: Uint8Array, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const push = (k: string, v: unknown): void => { if (k in out) out[k] = [...(Array.isArray(out[k]) ? out[k] as unknown[] : [out[k]]), v]; else out[k] = v }
  const readVarint = (pos: number): [bigint, number] => { let v = 0n, shift = 0n; for (let i = 0; i < 10; i++) { if (pos >= bytes.length) throw new Error('varint 越界'); const b = bytes[pos++]; v |= BigInt(b & 0x7f) << shift; if (!(b & 0x80)) return [v, pos]; shift += 7n } throw new Error('varint 过长') }
  let pos = 0
  while (pos < bytes.length) {
    const [key, p1] = readVarint(pos); pos = p1
    const field = Number(key >> 3n), wire = Number(key & 7n)
    if (!field) throw new Error(`字段号 0 无效（偏移 ${pos}）`)
    const name = String(field)
    if (wire === 0) { const [v, p] = readVarint(pos); pos = p; push(name, { wire: 'varint', value: v.toString() }) }
    else if (wire === 1) { if (pos + 8 > bytes.length) throw new Error('i64 越界'); push(name, { wire: 'i64', hex: Array.from(bytes.slice(pos, pos + 8)).map((b) => b.toString(16).padStart(2, '0')).join('') }); pos += 8 }
    else if (wire === 5) { if (pos + 4 > bytes.length) throw new Error('i32 越界'); push(name, { wire: 'i32', value: new DataView(bytes.buffer, bytes.byteOffset + pos, 4).getUint32(0, true) }); pos += 4 }
    else if (wire === 2) {
      const [len, p] = readVarint(pos); pos = p; const n = Number(len); if (n < 0 || pos + n > bytes.length) throw new Error('len 字段越界')
      const chunk = bytes.slice(pos, pos + n); pos += n
      let value: unknown
      if (depth < 3 && n > 0) { try { value = { wire: 'message', value: parseProtoBytes(chunk, depth + 1) } } catch { /* 非嵌套消息，走文本/十六进制 */ } }
      if (value === undefined) {
        try { const t = new TextDecoder('utf-8', { fatal: true }).decode(chunk); value = /[^\x20-\x7e\n\r\t\u00a0-\uffff]/.test(t) ? { wire: 'bytes', hex: Array.from(chunk).map((b) => b.toString(16).padStart(2, '0')).join('') } : { wire: 'string', value: t } }
        catch { value = { wire: 'bytes', hex: Array.from(chunk).map((b) => b.toString(16).padStart(2, '0')).join(''), base64: bytesToB64(chunk) } }
      }
      push(name, value)
    } else throw new Error(`不支持的 wire type ${wire}（字段 ${field}）`)
  }
  return out
}
function jwtDecode(s: string): string {
  const parts = s.trim().split('.'); if (parts.length !== 3) throw new Error('JWT 需 3 段（header.payload.signature）')
  const dec = (p: string): unknown => { const t = new TextDecoder().decode(b64ToBytes(p)); try { return JSON.parse(t) as unknown } catch { return t } }
  return JSON.stringify({ header: dec(parts[0]), payload: dec(parts[1]), signature: parts[2] }, null, 2)
}
interface EncMode { id: string; label: string; hint: string; dir: 'enc' | 'dec'; run: (s: string) => string | Promise<string> }
const ENC_MODES: EncMode[] = [
  { id: 'unicode-enc', label: 'Unicode编码', hint: '\\u开头', dir: 'enc', run: unicodeEncode },
  { id: 'url-enc', label: 'URL编码', hint: '%开头', dir: 'enc', run: (s) => encodeURIComponent(s) },
  { id: 'utf16-enc', label: 'UTF16编码', hint: '\\u开头', dir: 'enc', run: utf16Encode },
  { id: 'base64-enc', label: 'Base64编码', hint: 'A-Za-z0-9+/', dir: 'enc', run: (s) => bytesToB64(new TextEncoder().encode(s)) },
  { id: 'md5', label: 'MD5计算', hint: '32位摘要', dir: 'enc', run: md5Hex },
  { id: 'hex-enc', label: '十六进制编码', hint: 'Hex', dir: 'enc', run: hexEncode },
  { id: 'sha1', label: 'Sha1加密', hint: '40位摘要', dir: 'enc', run: (s) => sha('SHA-1', s) },
  { id: 'sha256', label: 'SHA-256加密', hint: '64位摘要', dir: 'enc', run: (s) => sha('SHA-256', s) },
  { id: 'html-enc', label: 'HTML普通编码', hint: '&lt;实体', dir: 'enc', run: htmlEncode },
  { id: 'html-deep', label: 'HTML深度编码', hint: '&#数字;', dir: 'enc', run: (s) => Array.from(s).map((c) => `&#${c.codePointAt(0) ?? 0};`).join('') },
  { id: 'html-to-js', label: 'HTML转JS', hint: 'document.writeln', dir: 'enc', run: (s) => s.split('\n').map((l) => `document.writeln(${JSON.stringify(l)});`).join('\n') },
  { id: 'gzip-enc', label: 'Gzip压缩', hint: '输出Base64', dir: 'enc', run: gzipCompress },
  { id: 'escape', label: '字符串转义', hint: '\\n \\t \\"', dir: 'enc', run: stringEscape },
  { id: 'unicode-dec', label: 'Unicode解码', hint: '\\u开头', dir: 'dec', run: unicodeDecode },
  { id: 'url-dec', label: 'URL解码', hint: '%开头', dir: 'dec', run: (s) => decodeURIComponent(s.trim()) },
  { id: 'utf16-dec', label: 'UTF16解码', hint: '\\u开头', dir: 'dec', run: unicodeDecode },
  { id: 'base64-dec', label: 'Base64解码', hint: 'UTF-8文本', dir: 'dec', run: (s) => new TextDecoder().decode(b64ToBytes(s)) },
  { id: 'hex-dec', label: 'Hex(ASCII)解码', hint: 'Hex→文本', dir: 'dec', run: (s) => new TextDecoder().decode(hexToBytes(s)) },
  { id: 'proto-hex', label: 'Proto Hex解析', hint: '转JSON', dir: 'dec', run: (s) => JSON.stringify(parseProtoBytes(hexToBytes(s), 0), null, 2) },
  { id: 'html-dec', label: 'HTML实体解码', hint: '&lt;→<', dir: 'dec', run: htmlDecode },
  { id: 'url-params', label: 'URL参数解析', hint: '转JSON', dir: 'dec', run: (s) => { const q = s.includes('?') ? s.slice(s.indexOf('?') + 1) : s; const o: Record<string, string | string[]> = {}; new URLSearchParams(q).forEach((v, k) => { o[k] = k in o ? [...(Array.isArray(o[k]) ? o[k] as string[] : [o[k] as string]), v] : v }); return JSON.stringify(o, null, 2) } },
  { id: 'jwt-dec', label: 'JWT解码', hint: 'Header/Payload', dir: 'dec', run: jwtDecode },
  { id: 'cookie-format', label: 'Cookie格式化', hint: '每行一条', dir: 'dec', run: (s) => s.replace(/^cookie:\s*/i, '').split(';').map((p) => p.trim()).filter(Boolean).map((p) => { const i = p.indexOf('='); return i < 0 ? p : `${p.slice(0, i).trim()} = ${p.slice(i + 1).trim()}` }).join('\n') },
  { id: 'gzip-dec', label: 'Gzip解压', hint: '输入Base64', dir: 'dec', run: gzipDecompress },
  { id: 'unescape', label: '字符串去转义', hint: '\\n→换行', dir: 'dec', run: stringUnescape }
]
const ENC_LEGACY: Record<string, string> = { base64: 'base64-enc', url: 'url-enc', unicode: 'unicode-enc', hex: 'hex-enc', sha1: 'sha1', sha256: 'sha256' }
const ENC_PANEL_DEFAULT = 304
function EncodeTool(): React.JSX.Element {
  const [rawMode, setMode] = useStored('hadice-handy-enc-mode', 'unicode-dec')
  const [input, setInput] = useStored('hadice-handy-enc', 'Hadice 便捷工具')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // 左右分栏拖宽：同应用布局页（document 级 mousemove/mouseup + 双击还原 + 本地持久化）
  const [panelWStr, setPanelWStr] = useStored('hadice-handy-enc-leftw', String(ENC_PANEL_DEFAULT))
  const panelW = Math.min(520, Math.max(232, Number(panelWStr) || ENC_PANEL_DEFAULT))
  const [splitResizing, setSplitResizing] = useState(false)
  const splitRef = React.useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!splitResizing) return
    const onMove = (e: MouseEvent): void => {
      const el = splitRef.current; if (!el) return
      const r = el.getBoundingClientRect()
      setPanelWStr(String(Math.round(Math.min(Math.min(520, r.width * 0.6), Math.max(232, e.clientX - r.left)))))
    }
    const onUp = (): void => setSplitResizing(false)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize'
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.userSelect = ''; document.body.style.cursor = '' }
  }, [splitResizing, setPanelWStr])
  const mode = ENC_MODES.find((m) => m.id === rawMode) ?? ENC_MODES.find((m) => m.id === ENC_LEGACY[rawMode]) ?? ENC_MODES.find((m) => m.id === 'unicode-dec')!
  // 点功能卡即直接处理（含输入为空：按该功能对空串的规则出结果/报错），不再设单独「转换」按钮
  const runWith = async (fn: () => Promise<string> | string): Promise<void> => {
    setBusy(true); setErr('')
    try { setOutput(await fn()) } catch (e) { setOutput(''); setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const section = (dir: 'enc' | 'dec', title: string, sub: string): React.JSX.Element => (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between px-0.5"><span className="text-sm font-semibold">{title}</span><span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{sub}</span></div>
      <div className="grid grid-cols-2 gap-2">
        {ENC_MODES.filter((m) => m.dir === dir).map((m) => (
          <button key={m.id} type="button" title={`${m.label}（${m.hint}）`} onClick={() => { setMode(m.id); void runWith(() => m.run(input)) }}
            className={cn('rounded-md border px-2.5 py-2 text-left transition-colors', mode.id === m.id ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'border-border bg-background/60 hover:border-primary/40 hover:bg-primary/5')}>
            <div className={cn('truncate text-[13px] font-medium leading-5', mode.id === m.id && 'text-primary')}>{m.label}</div>
            <div className="truncate text-[11px] leading-4 text-muted-foreground">{m.hint}</div>
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <div ref={splitRef} className="flex h-full min-h-0">
      {/* 左：转换方式（参考图：分组双列卡片，点卡直接转换） */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card/40" style={{ width: panelW }}>
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <div><div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Toolbox</div><div className="text-base font-semibold leading-6">转换方式</div></div>
          <Badge variant="secondary" className="rounded-full">{busy ? '转换中…' : `${ENC_MODES.length} 种`}</Badge>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-2.5">
          {section('enc', '加密', 'Encode')}
          {section('dec', '解密', 'Decode')}
        </div>
      </div>
      {/* 拖动分栏：同应用布局页（常显握把条，拖动高亮，双击还原） */}
      <div role="separator" aria-orientation="vertical" aria-label="拖动调整转换方式与内容区宽度" title="拖动调整大小，双击还原"
        className={cn('group relative z-10 flex w-3 shrink-0 cursor-col-resize items-center justify-center transition-colors', splitResizing ? 'bg-primary/15' : 'hover:bg-primary/10')}
        onMouseDown={() => setSplitResizing(true)} onDoubleClick={() => setPanelWStr(String(ENC_PANEL_DEFAULT))}>
        <div className={cn('flex h-20 w-2.5 items-center justify-center rounded-full border shadow-sm transition-colors', splitResizing ? 'border-primary/50 bg-primary/20 text-primary' : 'border-border bg-muted text-muted-foreground group-hover:border-primary/40 group-hover:text-primary')}>
          <GripVertical className="h-4 w-4 shrink-0" />
        </div>
      </div>
      {/* 右：输入 / 输出上下分栏 */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card/40">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-baseline gap-2"><span className="text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Source</span><span className="text-xs font-semibold">输入内容</span><span className="text-[10px] text-muted-foreground">{input.length} 字符</span></div>
            <Badge variant="outline" className="rounded-full text-[9px]">TEXT</Badge>
          </div>
          <XTextarea className={cn(taCls, 'min-h-0 flex-1 resize-none rounded-none border-0 shadow-none focus-visible:ring-0')} placeholder="粘贴需要进行转换的字符串" value={input} onChange={(e) => setInput(e.target.value)} />
        </section>
        {err && <div className="shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">{err}</div>}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card/40">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-baseline gap-2"><span className="text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Output</span><span className="text-xs font-semibold">转换结果</span><span className="text-[10px] text-muted-foreground">{mode.label}{output ? ` · ${output.length} 字符` : ''}</span></div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={!output} onClick={() => { setInput(output); setOutput('') }}>用作输入</Button>
              <CopyBtn text={output} />
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <Textarea readOnly className="h-full min-h-0 resize-none rounded-none border-0 font-mono text-xs shadow-none focus-visible:ring-0" value={output} placeholder="" />
            {!output && <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground">{err ? '转换失败，详见上方提示' : '等待转换'}</div>}
          </div>
        </section>
      </div>
    </div>
  )
}

/* ---------------- 颜色 ---------------- */
function ColorTool(): React.JSX.Element {
  const [hex, setHex] = useStored('hadice-handy-color', '#43ad7f')
  const parsed = useMemo(() => {
    const m = hex.trim().replace('#', '')
    const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
    const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16)
    const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255
    let h = 0; const d = mx - mn
    if (d) { const rn = r / 255, gn = g / 255, bn = b / 255; if (mx === rn) h = ((gn - bn) / d) % 6; else if (mx === gn) h = (bn - rn) / d + 2; else h = (rn - gn) / d + 4; h *= 60; if (h < 0) h += 360 }
    const l = (mx + mn) / 2, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0
    return { hex: '#' + full.toLowerCase(), rgb: `rgb(${r}, ${g}, ${b})`, hsl: `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)` }
  }, [hex])
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input type="color" className="h-10 w-14 cursor-pointer rounded border border-border bg-transparent" value={parsed?.hex ?? '#000000'} onChange={(e) => setHex(e.target.value)} />
        <XInput className="w-40 font-mono text-xs" value={hex} onChange={(e) => setHex(e.target.value)} />
        <div className="h-10 flex-1 rounded border border-border" style={{ background: parsed?.hex ?? 'transparent' }} />
      </div>
      {!parsed && <div className="text-xs text-red-500">HEX 格式无效，如 #43ad7f</div>}
      {parsed && ['hex', 'rgb', 'hsl'].map((k) => (
        <div key={k} className="flex items-center gap-2"><span className="w-10 text-xs uppercase text-muted-foreground">{k}</span><code className="flex-1 rounded bg-muted px-2 py-1 font-mono text-xs">{parsed[k as 'hex' | 'rgb' | 'hsl']}</code><CopyBtn text={parsed[k as 'hex' | 'rgb' | 'hsl']} /></div>
      ))}
    </div>
  )
}

/* ---------------- 二维码 ---------------- */
function QrTool(): React.JSX.Element {
  const [text, setText] = useStored('hadice-handy-qr', 'https://example.com')
  const [img, setImg] = useState('')
  const [decoded, setDecoded] = useState('')
  const [srcName, setSrcName] = useState('')
  const { dragging, bind: dropBind } = useDropHighlight()
  const [qrHistRaw, setQrHistRaw] = useStored('hadice-handy-qr-history', '[]')
  const qrHistory = parseList(qrHistRaw)
  useEffect(() => { QRCodeLib.toDataURL(text || ' ', { width: 512, margin: 1 }).then(setImg).catch(() => setImg('')) }, [text])
  // 生成历史：输入停顿 800ms 后自动记录（去重，上限 50）
  useEffect(() => {
    const v = text.trim(); if (!v || qrHistory[0] === v) return
    const t = setTimeout(() => setQrHistRaw(JSON.stringify([v, ...qrHistory.filter((x) => x !== v)].slice(0, 50))), 800)
    return () => clearTimeout(t)
  }, [text, qrHistory, setQrHistRaw])
  // 三路共用：手动选择 / Ctrl+V 粘贴 / 拖拽，统一走 decodeBlob
  const decodeBlob = (blob: Blob | undefined | null, name: string): void => {
    if (!blob) return
    if (blob.type && !blob.type.startsWith('image/')) { toast.error('仅支持图片文件'); return }
    // ponytail: 不用 URL.createObjectURL——WKWebView 下粘贴的 blob: 图片会 onerror，DataURL 最稳
    const reader = new FileReader()
    reader.onerror = () => toast.error('图片读取失败')
    reader.onload = () => decodeSrc(String(reader.result ?? ''), name)
    reader.readAsDataURL(blob)
  }
  const decodeSrc = (src: string, name: string): void => {
    const image = new Image()
    image.onerror = () => toast.error('图片加载失败')
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height
      const ctx = canvas.getContext('2d'); if (!ctx) return
      ctx.drawImage(image, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(data.data, data.width, data.height)
      setDecoded(code?.data ?? ''); setSrcName(name)
      if (code?.data) toast.success('解码成功'); else toast.error('未识别到二维码')
    }
    image.src = src
  }
  const pickImage = async (): Promise<void> => {
    try { const f = await App.HandySelectImageFile(); if (f?.dataUrl) decodeSrc(f.dataUrl, f.name || '选择图片') }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const file = e.clipboardData?.files?.[0] ?? Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))?.getAsFile()
      if (!file || (file.type && !file.type.startsWith('image/'))) return
      e.preventDefault(); decodeBlob(file, '粘贴图片')
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])
  // Wails 原生拖放：HTML5 drop 拿不到系统文件，靠 data-wails-dropzone + 后端 files-dropped 事件（回传路径）
  useEffect(() => {
    const unlisten = EventsOn('files-dropped', (data: { files: string[] }) => {
      const path = data?.files?.[0]; if (!path) return
      App.HandyReadImageFile(path).then((f) => { if (f?.dataUrl) decodeSrc(f.dataUrl, f.name || '拖拽图片') }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
    })
    return () => { if (typeof unlisten === 'function') unlisten() }
  }, [])
  return (
    <div className="space-y-3">
      <div><Label>生成内容</Label><XTextarea className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} /></div>
      <div className="flex items-start gap-4">
        {img && <img src={img} alt="二维码" className="h-48 w-48 rounded border border-border" />}
        <div className="flex-1 space-y-4">
          {img && <a className="mb-2 inline-block" href={img} download="qrcode.png"><Button size="sm" variant="outline">下载 PNG</Button></a>}
          <div
            data-wails-dropzone
            className={cn('rounded-lg border-2 border-dashed p-4 text-center text-xs text-muted-foreground transition-all duration-200', dragging ? 'scale-[1.01] border-primary bg-primary/15 font-medium text-primary shadow-[0_0_0_4px] shadow-primary/20' : 'border-border')}
            {...dropBind}
            onDrop={(e) => { e.preventDefault(); dropBind.onDrop(e); decodeBlob(e.dataTransfer.files?.[0], e.dataTransfer.files?.[0]?.name ?? '拖拽图片') }}
          >
            {dragging ? '松开鼠标，释放图片开始解码' : '拖图片到此处解码，或在本工具页按 Ctrl+V 粘贴截图'}
            <div className="mt-3"><Button size="sm" variant="outline" onClick={() => void pickImage()}>选择图片</Button></div>
          </div>
          {srcName && <div className="text-xs text-muted-foreground">来源：{srcName}</div>}
          {decoded && <div className="flex items-center gap-2"><code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{decoded}</code><CopyBtn text={decoded} /></div>}
          <HistoryList title="生成历史（点击恢复）" items={qrHistory} onPick={setText} onDelete={(i) => setQrHistRaw(JSON.stringify(qrHistory.filter((_, x) => x !== i)))} onClear={() => setQrHistRaw('[]')} />
        </div>
      </div>
    </div>
  )
}

/* ---------------- 图片转 Base64 ---------------- */
function formatBytes(n: number): string { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB` }
function ImageBase64Tool(): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState('')
  const [info, setInfo] = useState('')
  const [mode, setMode] = useStored('hadice-handy-imgb64-mode', 'datauri')
  const { dragging, bind: dropBind } = useDropHighlight()
  const loadBlob = (blob: Blob | undefined | null, name: string): void => {
    if (!blob) return
    if (blob.type && !blob.type.startsWith('image/')) { toast.error('仅支持图片文件'); return }
    const reader = new FileReader()
    reader.onerror = () => toast.error('图片读取失败')
    reader.onload = () => {
      const url = String(reader.result ?? ''); setDataUrl(url)
      const image = new Image()
      image.onload = () => setInfo(`${name} · ${blob.type || 'image'} · 原始 ${formatBytes(blob.size)} · ${image.naturalWidth}×${image.naturalHeight}`)
      image.src = url
    }
    reader.readAsDataURL(blob)
  }
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const file = e.clipboardData?.files?.[0] ?? Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))?.getAsFile()
      if (!file || (file.type && !file.type.startsWith('image/'))) return
      e.preventDefault(); loadBlob(file, '粘贴图片')
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])
  useEffect(() => {
    const unlisten = EventsOn('files-dropped', (data: { files: string[] }) => {
      const path = data?.files?.[0]; if (!path) return
      App.HandyReadImageFile(path).then((f) => { if (!f?.dataUrl) return; setDataUrl(f.dataUrl); const image = new Image(); image.onload = () => setInfo(`${f.name} · ${f.mime} · 原始 ${formatBytes(f.size)} · ${image.naturalWidth}×${image.naturalHeight}`); image.src = f.dataUrl }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
    })
    return () => { if (typeof unlisten === 'function') unlisten() }
  }, [])
  const output = mode === 'datauri' ? dataUrl : dataUrl.split(',')[1] ?? ''
  return (
    <div className="space-y-3">
      <div
        data-wails-dropzone
        className={cn('rounded-lg border-2 border-dashed p-6 text-center text-xs text-muted-foreground transition-all duration-200', dragging ? 'scale-[1.01] border-primary bg-primary/15 font-medium text-primary shadow-[0_0_0_4px] shadow-primary/20' : 'border-border')}
        {...dropBind}
        onDrop={(e) => { e.preventDefault(); dropBind.onDrop(e); loadBlob(e.dataTransfer.files?.[0], e.dataTransfer.files?.[0]?.name ?? '拖拽图片') }}
      >
        {dragging ? '松开鼠标，释放图片开始转换' : '拖图片到此处，或在本工具页按 Ctrl+V 粘贴截图/图片'}
        <div className="mt-3"><Button size="sm" variant="outline" onClick={() => void (async () => { try { const f = await App.HandySelectImageFile(); if (!f?.dataUrl) return; setDataUrl(f.dataUrl); const image = new Image(); image.onload = () => setInfo(`${f.name} · ${f.mime} · 原始 ${formatBytes(f.size)} · ${image.naturalWidth}×${image.naturalHeight}`); image.src = f.dataUrl } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } })()}>选择图片</Button></div>
      </div>
      {info && <div className="text-xs text-muted-foreground">{info} · DataUri 大小：{formatBytes(dataUrl.length)}</div>}
      {dataUrl && <img src={dataUrl} alt="预览" className="max-h-64 rounded border border-border" />}
      <div className="flex items-center gap-2">
        <Select value={mode} onValueChange={setMode}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="datauri">Data URI</SelectItem><SelectItem value="raw">纯 Base64</SelectItem></SelectContent></Select>
        <CopyBtn text={output} />
      </div>
      <Textarea className={cn(taCls, 'min-h-[180px]')} value={output} readOnly placeholder="内容会自动生成…" />
    </div>
  )
}

/* ---------------- Crontab ---------------- */
function cronFieldOk(field: string, min: number, max: number): boolean {
  return field.split(',').every((part) => {
    const [range, stepStr] = part.split('/')
    if (stepStr !== undefined && (!/^\d+$/.test(stepStr) || Number(stepStr) < 1)) return false
    if (range === '*') return true
    const m = range.match(/^(\d+)(?:-(\d+))?$/); if (!m) return false
    const a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2])
    return a >= min && b <= max && a <= b
  })
}
function cronMatch(field: string, v: number): boolean {
  return field.split(',').some((part) => {
    const [range, stepStr] = part.split('/'); const step = stepStr ? Number(stepStr) : 1
    if (range === '*') return v % step === 0
    const m = range.match(/^(\d+)(?:-(\d+))?$/); if (!m) return false
    const a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2])
    return v >= a && v <= b && (v - a) % step === 0
  })
}
function CronTool(): React.JSX.Element {
  const [expr, setExpr] = useStored('hadice-handy-cron', '*/5 * * * *')
  const { next, err } = useMemo(() => {
    const f = expr.trim().split(/\s+/)
    if (f.length !== 5) return { next: [] as string[], err: '需要 5 段：分 时 日 月 周' }
    const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
    for (let i = 0; i < 5; i++) if (!cronFieldOk(f[i], ranges[i][0], ranges[i][1])) return { next: [], err: `第 ${i + 1} 段无效：${f[i]}` }
    const out: string[] = []
    const d = new Date(); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1)
    // ponytail: 逐分钟暴力扫 1 年，够用；高频/复杂 cron 需专门库时再升级
    for (let i = 0; i < 366 * 24 * 60 && out.length < 5; i++) {
      if (cronMatch(f[0], d.getMinutes()) && cronMatch(f[1], d.getHours()) && cronMatch(f[2], d.getDate()) && cronMatch(f[3], d.getMonth() + 1) && cronMatch(f[4], d.getDay())) out.push(d.toLocaleString())
      d.setMinutes(d.getMinutes() + 1)
    }
    return { next: out, err: out.length ? '' : '未来 1 年无执行时间' }
  }, [expr])
  return (
    <div className="space-y-3">
      <XInput className="font-mono text-sm" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="*/5 * * * *" />
      <div className="flex flex-wrap gap-1">{[['每分钟', '* * * * *'], ['每小时', '0 * * * *'], ['每天 0 点', '0 0 * * *'], ['每周一 9 点', '0 9 * * 1'], ['每月 1 号', '0 0 1 * *']].map(([l, v]) => <Button key={v + l} size="sm" variant="outline" className="h-7 text-xs" onClick={() => setExpr(v)}>{l}</Button>)}</div>
      <div className="text-xs text-muted-foreground">分 时 日 月 周（周：0/7=周日）</div>
      {err && <div className="text-xs text-red-500">{err}</div>}
      {next.length > 0 && <div><Label>下 5 次执行</Label>{next.map((t) => <div key={t} className="font-mono text-xs">{t}</div>)}</div>}
    </div>
  )
}

/* ---------------- 随机密码 ---------------- */
function PasswordTool(): React.JSX.Element {
  const [lenStr, setLenStr] = useStored('hadice-handy-pwd-len', '16')
  const [opts, setOpts] = useStored('hadice-handy-pwd-opts', 'lower,upper,digits')
  const [pwds, setPwds] = useState<string[]>([])
  const [countStr, setCountStr] = useStored('hadice-handy-pwd-count', '1')
  const [historyRaw, setHistoryRaw] = useStored('hadice-handy-pwd-history', '[]')
  const history = parseList(historyRaw)
  const toggle = (k: string): void => { const arr = opts.split(',').filter(Boolean); setOpts((arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]).join(',')) }
  const gen = (record = true): void => {
    const sets: Record<string, string> = { lower: 'abcdefghijkmnopqrstuvwxyz', upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', digits: '23456789', symbols: '!@#$%^&*()-_=+' }
    const pool = opts.split(',').filter(Boolean).map((k) => sets[k]).join('')
    if (!pool) { toast.error('至少选一种字符'); return }
    const len = Math.min(64, Math.max(4, Number(lenStr) || 16))
    const buf = new Uint32Array(len); crypto.getRandomValues(buf)
    // ponytail: 取模有微小分布偏差，密码场景可接受；严格均匀需拒绝采样
    const makeOne = (): string => { const b = new Uint32Array(len); crypto.getRandomValues(b); return Array.from(b).map((n) => pool[n % pool.length]).join('') }
    const list = Array.from({ length: Math.min(20, Math.max(1, Number(countStr) || 1)) }, makeOne)
    setPwds(list)
    if (record) setHistoryRaw(JSON.stringify([...list, ...history].slice(0, 20)))
  }
  useEffect(() => { gen(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span>长度</span><XInput className="w-20" type="number" min={4} max={64} value={lenStr} onChange={(e) => setLenStr(e.target.value)} />
        {[['lower', '小写'], ['upper', '大写'], ['digits', '数字'], ['symbols', '符号']].map(([k, l]) => (
          <label key={k} className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={opts.split(',').includes(k)} onChange={() => toggle(k)} />{l}</label>
        ))}
        <span>数量</span><XInput className="w-20" type="number" min={1} max={20} value={countStr} onChange={(e) => setCountStr(e.target.value)} />
        <Button size="sm" onClick={() => gen()}>生成</Button><CopyBtn text={pwds.join('\n')} />
      </div>
      {pwds.length > 0 && <Textarea readOnly className={cn(taCls, 'min-h-[90px] shrink-0')} value={pwds.join('\n')} />}
      <HistoryList fill title="历史记录" items={history} onDelete={(i) => setHistoryRaw(JSON.stringify(history.filter((_, x) => x !== i)))} onClear={() => setHistoryRaw('[]')} />
    </div>
  )
}

/* ---------------- 时间戳 ---------------- */
// 智能识别：秒/毫秒/微秒/纳秒时间戳、YYYYMMDD[HHmmss]、ISO、2026-10-20 09:46:00、2026年10月20日、2026/10/20 等
function parseSmartTime(rawInput: string): { ms: number; kind: string } | null {
  const raw = rawInput.trim(); if (!raw) return null
  const kw = raw.toLowerCase()
  if (kw === 'now') return { ms: Date.now(), kind: '关键字 now' }
  if (kw === 'today' || kw === 'yesterday' || kw === 'tomorrow') {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    if (kw === 'yesterday') d.setDate(d.getDate() - 1)
    if (kw === 'tomorrow') d.setDate(d.getDate() + 1)
    return { ms: d.getTime(), kind: `关键字 ${kw}（当天开始）` }
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    if (raw.includes('.')) return { ms: Math.round(Number(raw) * 1000), kind: '秒级浮点时间戳' }
    const digits = raw.replace('-', '').length, n = Number(raw)
    if (digits <= 10) return { ms: n * 1000, kind: '秒级时间戳' }
    if (digits === 16) return { ms: Math.round(n / 1000), kind: '微秒时间戳' }
    if (digits >= 19) return { ms: Math.round(n / 1e6), kind: '纳秒时间戳' }
    return { ms: n, kind: '毫秒时间戳' }
  }
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/)
  if (compact) {
    const [, y, mo, d, h = '0', mi = '0', s = '0'] = compact
    return { ms: new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime(), kind: '紧凑日期 YYYYMMDD' }
  }
  const normalized = raw.replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-').replace(/(\d)-(\d)-(\d)\s+/, '$1-$2-$3 ')
  for (const candidate of [raw, normalized]) {
    const ms = Date.parse(candidate)
    if (!Number.isNaN(ms)) return { ms, kind: '日期字符串' }
  }
  return null
}
function relTime(ms: number): string {
  const diff = Date.now() - ms, abs = Math.abs(diff), suffix = diff >= 0 ? '前' : '后'
  if (abs < 60e3) return `${Math.round(abs / 1e3)} 秒${suffix}`
  if (abs < 3600e3) return `${Math.round(abs / 60e3)} 分钟${suffix}`
  if (abs < 86400e3) return `${Math.round(abs / 3600e3)} 小时${suffix}`
  return `${Math.round(abs / 86400e3)} 天${suffix}`
}
function TimestampTool(): React.JSX.Element {
  const [ts, setTs] = useStored('hadice-handy-ts', '')
  const [now, setNow] = useState(() => Date.now())
  const [paused, setPaused] = useState(false)
  const [tz, setTz] = useStored('hadice-handy-ts-tz', 'Asia/Shanghai')
  const [, setParseNonce] = useState(0)
  const [calcOpen, setCalcOpen] = useState(false)
  const [diffFrom, setDiffFrom] = useStored('hadice-handy-diff-from', '')
  const [diffTo, setDiffTo] = useStored('hadice-handy-diff-to', '')
  // 时间差默认填当前时间（每次进入面板刷新）
  useEffect(() => {
    const d = new Date(), pad = (n: number): string => String(n).padStart(2, '0')
    const nowStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    setDiffFrom(nowStr); setDiffTo(nowStr)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [diffResult, setDiffResult] = useState('')
  const [baseTime, setBaseTime] = useStored('hadice-handy-calc-base', '2024-01-01 10:00:00')
  const [calcOp, setCalcOp] = useStored('hadice-handy-calc-op', 'add')
  const [calcAmount, setCalcAmount] = useStored('hadice-handy-calc-amount', '1')
  const [calcUnit, setCalcUnit] = useStored('hadice-handy-calc-unit', 'day')
  const [calcResult, setCalcResult] = useState('')
  const calcDiff = (): void => {
    const a = parseSmartTime(diffFrom), b = parseSmartTime(diffTo)
    if (!a || !b) { setDiffResult('开始或结束时间无法识别'); return }
    const ms = b.ms - a.ms, abs = Math.abs(ms), sec = Math.floor(abs / 1000)
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), secR = sec % 60
    setDiffResult(`${ms < 0 ? '结束早于开始，' : ''}相差 ${d} 天 ${h} 小时 ${m} 分 ${secR} 秒 · 共 ${sec.toLocaleString()} 秒 / ${(sec / 60).toFixed(1)} 分钟 / ${(sec / 3600).toFixed(2)} 小时 / ${(sec / 86400).toFixed(3)} 天`)
  }
  const calcAddSub = (): void => {
    const base = parseSmartTime(baseTime)
    if (!base) { setCalcResult('基准时间无法识别'); return }
    const n = Number(calcAmount); if (!Number.isFinite(n)) { setCalcResult('数量无效'); return }
    const d = new Date(base.ms), sign = calcOp === 'add' ? 1 : -1
    if (calcUnit === 'month') d.setMonth(d.getMonth() + sign * n)
    else if (calcUnit === 'year') d.setFullYear(d.getFullYear() + sign * n)
    else { const unitMs: Record<string, number> = { second: 1e3, minute: 60e3, hour: 3600e3, day: 86400e3, week: 604800e3 }; d.setTime(d.getTime() + sign * n * (unitMs[calcUnit] ?? 86400e3)) }
    setCalcResult(`${d.toLocaleString()}（周${'日一二三四五六'[d.getDay()]}） · ISO ${d.toISOString()} · 毫秒 ${d.getTime()}`)
  }
  useEffect(() => {
    if (paused) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [paused])
  const parsed = useMemo(() => {
    const r = parseSmartTime(ts); if (!r) return null
    const d = new Date(r.ms)
    return { ...r, local: d.toLocaleString(), iso: d.toISOString(), sec: Math.floor(r.ms / 1000), weekday: '周' + '日一二三四五六'[d.getDay()], rel: relTime(r.ms) }
  }, [ts])
  const tzTime = useMemo(() => new Date(now).toLocaleString('zh-CN', { timeZone: tz === 'local' ? undefined : tz, hour12: false }), [now, tz])
  const startOf = (offsetDays: number): number => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays); return d.getTime() }
  const monday = (): number => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() }
  const monthStart = (): number => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime() }
  const quick: { label: string; cls: string; value: () => number }[] = [
    { label: '当前时间', cls: 'border-blue-400 text-blue-500 hover:bg-blue-500/10', value: () => Date.now() },
    { label: '今天开始', cls: 'border-green-400 text-green-600 hover:bg-green-500/10', value: () => startOf(0) },
    { label: '昨天', cls: 'border-teal-400 text-teal-600 hover:bg-teal-500/10', value: () => startOf(-1) },
    { label: '本周开始', cls: 'border-amber-400 text-amber-600 hover:bg-amber-500/10', value: monday },
    { label: '本月开始', cls: 'border-border text-muted-foreground hover:bg-muted', value: monthStart }
  ]
  const card = 'rounded-lg border border-border bg-card/40 p-4'
  const resultRow = (label: string, value: string, copy = false): React.JSX.Element => (
    <div key={label} className="flex items-center gap-2 border-b border-border/60 py-1.5 last:border-0">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 break-all font-mono">{value}</code>
      {copy && <CopyBtn text={value} />}
    </div>
  )
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {/* 左：当前时间 + 快捷操作 */}
      <div className="space-y-4">
        <section className={cn(card, 'flex h-[204px] flex-col')}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold">当前时间</span>
            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => { if (paused) setNow(Date.now()); setPaused(!paused) }}>
              {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}{paused ? '继续' : '暂停'}
            </Button>
          </div>
          <div className="mb-3 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">模拟时区</span>
            <Select value={tz} onValueChange={setTz}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Asia/Shanghai">北京 (GMT+8)</SelectItem>
                <SelectItem value="local">本地时区</SelectItem>
                <SelectItem value="UTC">UTC</SelectItem>
                <SelectItem value="Asia/Tokyo">东京 (GMT+9)</SelectItem>
                <SelectItem value="Europe/London">伦敦</SelectItem>
                <SelectItem value="America/New_York">纽约</SelectItem>
              </SelectContent>
            </Select>
            <span className={cn('h-2 w-2 rounded-full', paused ? 'bg-amber-500' : 'animate-pulse bg-green-500')} />
            <span className="text-muted-foreground">{paused ? '已暂停' : '每秒刷新中'}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><Label>当前选择时区时间</Label><div className="flex h-9 items-center justify-center rounded border border-border bg-background px-2 font-mono text-xs font-semibold text-primary">{tzTime}</div></div>
            <div><Label>Unix 时间戳（秒）</Label><div className="flex h-9 items-center justify-center rounded border border-border bg-background px-2 font-mono text-xs">{Math.floor(now / 1000)}</div></div>
            <div><Label>Unix 时间戳（毫秒）</Label><div className="flex h-9 items-center justify-center gap-1 rounded border border-border bg-background px-2 font-mono text-xs">{now}<CopyBtn text={String(now)} /></div></div>
          </div>
        </section>
        <section className={card}>
          <div className="mb-3 text-sm font-semibold">快捷操作</div>
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => <Button key={q.label} size="sm" variant="outline" className={q.cls} onClick={() => setTs(String(q.value()))}>{q.label}</Button>)}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">点击后填入右侧输入框并自动解析</div>
        </section>
        <section className={card}>
          <div className="mb-2 text-sm font-semibold">日期 → 时间戳</div>
          <Input type="datetime-local" className="w-64 text-xs" onChange={(e) => { if (e.target.value) setTs(String(new Date(e.target.value).getTime())) }} />
        </section>
      </div>
      {/* 右：输入解析 + 结果 */}
      <div className="space-y-4">
        <section className={cn(card, 'flex h-[204px] flex-col')}>
          <div className="mb-3 text-sm font-semibold">输入时间（支持多种格式）</div>
          <div className="flex min-h-0 flex-1 items-start gap-2">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col self-stretch">
              <XTextarea className={cn(taCls, 'min-h-0 flex-1')} value={ts} onChange={(e) => setTs(e.target.value)} placeholder={'试试输入：\n· 1749722690（时间戳）\n· 2025-06-12 18:06:25\n· now / today / yesterday\n· 2025/06/12\n· Jun 12, 2025'} />
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <Button size="sm" onClick={() => setParseNonce((n) => n + 1)}>解析</Button>
              <Button size="sm" variant="outline" onClick={() => setTs('')}>清空</Button>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">支持秒/毫秒/微秒/纳秒、浮点秒、ISO、中文日期、紧凑日期与 now/today/yesterday，按本地时区解析无时区字符串（输入即自动解析）</div>
          {ts.trim() && !parsed && <div className="mt-2 text-xs text-red-500">无法识别该时间格式</div>}
        </section>
        <section className={card}>
          <div className="mb-2 text-sm font-semibold">解析结果</div>
          {parsed ? (
            <div className="text-xs">
              {resultRow('识别类型', `${parsed.kind} · ${parsed.rel}`)}
              {resultRow('本地时间', `${parsed.local}（${parsed.weekday}）`)}
              {resultRow('ISO 时间', parsed.iso, true)}
              {resultRow('Unix（秒）', String(parsed.sec), true)}
              {resultRow('Unix（毫秒）', String(parsed.ms), true)}
            </div>
          ) : <div className="py-6 text-center text-xs text-muted-foreground">在上方输入时间后，解析结果将显示在这里</div>}
        </section>
      </div>
      <section className={cn(card, 'p-0 overflow-hidden lg:col-span-2')}>
        <button type="button" aria-expanded={calcOpen} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold hover:bg-muted/40" onClick={() => setCalcOpen(!calcOpen)}>
          <ChevronDown className={cn('h-4 w-4 transition-transform duration-300 [transition-timing-function:cubic-bezier(0.22,1.15,0.36,1)]', !calcOpen && '-rotate-90')} />
          时间计算器
          <span className="text-xs font-normal text-muted-foreground">时间差 / 时间加减（支持任意格式输入）</span>
        </button>
        <div className={foldWrap(calcOpen)}><div className="min-h-0 overflow-hidden"><div className="grid gap-4 p-4 pt-0 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="text-xs font-medium text-muted-foreground">时间差计算</div>
            <div className="flex items-center gap-2">
              <span className="text-xs">从</span><XInput className="flex-1 font-mono text-xs" value={diffFrom} onChange={(e) => setDiffFrom(e.target.value)} placeholder="如：2024-01-01 10:00:00" />
              <span className="text-xs">到</span><XInput className="flex-1 font-mono text-xs" value={diffTo} onChange={(e) => setDiffTo(e.target.value)} placeholder="如：2024-01-02 15:30:00" />
            </div>
            <Button className="w-full" onClick={calcDiff}>计算时间差</Button>
            {diffResult && <div className="flex items-center gap-2 rounded bg-muted px-3 py-2 text-xs"><span className="flex-1 font-mono">{diffResult}</span><CopyBtn text={diffResult} /></div>}
          </div>
          <div className="space-y-3">
            <div className="text-xs font-medium text-muted-foreground">时间加减运算</div>
            <div className="flex items-center gap-2">
              <XInput className="flex-1 font-mono text-xs" value={baseTime} onChange={(e) => setBaseTime(e.target.value)} placeholder="基准时间（如：2024-01-01 10:00:00）" />
              <Select value={calcOp} onValueChange={setCalcOp}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="add">增加</SelectItem><SelectItem value="sub">减少</SelectItem></SelectContent></Select>
              <XInput className="w-24" type="number" value={calcAmount} onChange={(e) => setCalcAmount(e.target.value)} placeholder="数量" />
              <Select value={calcUnit} onValueChange={setCalcUnit}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="second">秒</SelectItem><SelectItem value="minute">分</SelectItem><SelectItem value="hour">时</SelectItem><SelectItem value="day">天</SelectItem><SelectItem value="week">周</SelectItem><SelectItem value="month">月</SelectItem><SelectItem value="year">年</SelectItem></SelectContent></Select>
            </div>
            <Button className="w-full" onClick={calcAddSub}>计算结果</Button>
            {calcResult && <div className="flex items-center gap-2 rounded bg-muted px-3 py-2 text-xs"><span className="flex-1 break-all font-mono">{calcResult}</span><CopyBtn text={calcResult} /></div>}
          </div>
        </div></div></div>
      </section>
    </div>
  )
}

/* ---------------- UUID / ID ---------------- */
const SNOW_EPOCH = 1288834974657n
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function randFrom(alphabet: string, len: number): string {
  const buf = new Uint32Array(len); crypto.getRandomValues(buf)
  return Array.from(buf).map((n) => alphabet[n % alphabet.length]).join('')
}
function genUlid(): string {
  let t = Date.now(), time = ''
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32) }
  const bytes = new Uint8Array(10); crypto.getRandomValues(bytes)
  let v = 0n; bytes.forEach((b) => { v = (v << 8n) | BigInt(b) })
  let rand = ''; for (let i = 0; i < 16; i++) { rand = CROCKFORD[Number(v % 32n)] + rand; v /= 32n }
  return time + rand
}
function OutLines({ lines }: { lines: string[] }): React.JSX.Element {
  if (!lines.length) return <></>
  return <div className="flex items-start gap-2"><Textarea readOnly className={cn(taCls, 'min-h-[90px]')} value={lines.join('\n')} /><CopyBtn text={lines.join('\n')} /></div>
}
function IdTool(): React.JSX.Element {
  const [uuidCount, setUuidCount] = useStored('hadice-handy-uuid-count', '5')
  const [uuidFmt, setUuidFmt] = useStored('hadice-handy-uuid-fmt', 'standard')
  const [uuids, setUuids] = useState<string[]>([])
  const [uuidHistRaw, setUuidHistRaw] = useStored('hadice-handy-uuid-history', '[]')
  const uuidHistory = parseList(uuidHistRaw)
  const [worker, setWorker] = useStored('hadice-handy-snow-worker', '1')
  const [dc, setDc] = useStored('hadice-handy-snow-dc', '1')
  const [snowCount, setSnowCount] = useStored('hadice-handy-snow-count', '5')
  const [snows, setSnows] = useState<string[]>([])
  const [snowHistRaw, setSnowHistRaw] = useStored('hadice-handy-snow-history', '[]')
  const snowHistory = parseList(snowHistRaw)
  const [snowInput, setSnowInput] = useStored('hadice-handy-snow-parse', '')
  const [snowParsed, setSnowParsed] = useState('')
  const [nanoLen, setNanoLen] = useStored('hadice-handy-nano-len', '21')
  const [nanoCount, setNanoCount] = useStored('hadice-handy-nano-count', '5')
  const [nanos, setNanos] = useState<string[]>([])
  const [nanoHistRaw, setNanoHistRaw] = useStored('hadice-handy-nano-history', '[]')
  const nanoHistory = parseList(nanoHistRaw)
  const [ulidCount, setUlidCount] = useStored('hadice-handy-ulid-count', '5')
  const [ulids, setUlids] = useState<string[]>([])
  const [ulidHistRaw, setUlidHistRaw] = useStored('hadice-handy-ulid-history', '[]')
  const ulidHistory = parseList(ulidHistRaw)
  const clampCount = (s: string): number => Math.min(100, Math.max(1, Number(s) || 1))
  const genUuid = (): void => {
    const list = Array.from({ length: clampCount(uuidCount) }, () => {
      const u = crypto.randomUUID() // 原生实现，不引 uuid 库
      return uuidFmt === 'nohyphen' ? u.replace(/-/g, '') : uuidFmt === 'upper' ? u.toUpperCase() : uuidFmt === 'braces' ? `{${u}}` : u
    })
    setUuids(list); setUuidHistRaw(JSON.stringify([...list, ...uuidHistory].slice(0, 100)))
  }
  const genSnow = (): void => {
    const w = BigInt(Math.min(31, Math.max(0, Number(worker) || 0))), d = BigInt(Math.min(31, Math.max(0, Number(dc) || 0)))
    let seq = 0, last = -1
    const list = Array.from({ length: clampCount(snowCount) }, () => {
      let now = Date.now()
      if (now === last) { seq = (seq + 1) & 4095; if (!seq) { while (now <= last) now = Date.now() } } else seq = 0
      last = now
      return (((BigInt(now) - SNOW_EPOCH) << 22n) | (d << 17n) | (w << 12n) | BigInt(seq)).toString()
    })
    setSnows(list); setSnowHistRaw(JSON.stringify([...list, ...snowHistory].slice(0, 100)))
  }
  const parseSnow = (): void => {
    try {
      const id = BigInt(snowInput.trim())
      const ms = Number((id >> 22n) + SNOW_EPOCH)
      setSnowParsed(`时间 ${new Date(ms).toLocaleString()}（${ms}） · 数据中心 ${(id >> 17n) & 31n} · 机器 ${(id >> 12n) & 31n} · 序列 ${id & 4095n}`)
    } catch { setSnowParsed('无效的雪花 ID（需十进制整数）') }
  }
  const numRow = (label: string, val: string, set: (v: string) => void, width = 'w-20'): React.JSX.Element => (
    <label className="flex items-center gap-1 text-xs">{label}<XInput type="number" className={width} value={val} onChange={(e) => set(e.target.value)} /></label>
  )
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="text-sm font-semibold">UUID v4 生成器</div>
        <div className="flex flex-wrap items-center gap-2">
          {numRow('生成数量', uuidCount, setUuidCount)}
          <Select value={uuidFmt} onValueChange={setUuidFmt}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="standard">标准（带连字符）</SelectItem><SelectItem value="nohyphen">无连字符</SelectItem><SelectItem value="upper">大写</SelectItem><SelectItem value="braces">带大括号</SelectItem></SelectContent></Select>
          <Button size="sm" onClick={genUuid}>生成</Button>
        </div><OutLines lines={uuids} />
        <HistoryList title="UUID 历史" items={uuidHistory} onDelete={(i) => setUuidHistRaw(JSON.stringify(uuidHistory.filter((_, x) => x !== i)))} onClear={() => setUuidHistRaw('[]')} />
      </section>
      <section className="space-y-2">
        <div className="text-sm font-semibold">雪花 ID (Snowflake) 生成器</div>
        <div className="flex flex-wrap items-center gap-2">{numRow('机器ID', worker, setWorker)}{numRow('数据中心', dc, setDc)}{numRow('数量', snowCount, setSnowCount)}<Button size="sm" onClick={genSnow}>生成</Button></div>
        <OutLines lines={snows} />
        <HistoryList title="雪花历史" items={snowHistory} onDelete={(i) => setSnowHistRaw(JSON.stringify(snowHistory.filter((_, x) => x !== i)))} onClear={() => setSnowHistRaw('[]')} />
        <div className="flex gap-2"><XInput className="max-w-sm font-mono text-xs" value={snowInput} onChange={(e) => setSnowInput(e.target.value)} placeholder="输入雪花ID进行解析" /><Button size="sm" variant="secondary" onClick={parseSnow}>解析</Button></div>
        {snowParsed && <div className="text-xs text-muted-foreground">{snowParsed}</div>}
      </section>
      <section className="space-y-2">
        <div className="text-sm font-semibold">NanoID 生成器</div>
        <div className="flex flex-wrap items-center gap-2">{numRow('长度', nanoLen, setNanoLen)}{numRow('数量', nanoCount, setNanoCount)}<Button size="sm" onClick={() => { const list = Array.from({ length: clampCount(nanoCount) }, () => randFrom('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-', Math.min(64, Math.max(4, Number(nanoLen) || 21)))); setNanos(list); setNanoHistRaw(JSON.stringify([...list, ...nanoHistory].slice(0, 100))) }}>生成</Button></div>
        <OutLines lines={nanos} />
        <HistoryList title="NanoID 历史" items={nanoHistory} onDelete={(i) => setNanoHistRaw(JSON.stringify(nanoHistory.filter((_, x) => x !== i)))} onClear={() => setNanoHistRaw('[]')} />
      </section>
      <section className="space-y-2">
        <div className="text-sm font-semibold">ULID 生成器 <span className="text-xs font-normal text-muted-foreground">26 位 Crockford Base32，按毫秒时间有序</span></div>
        <div className="flex flex-wrap items-center gap-2">{numRow('数量', ulidCount, setUlidCount)}<Button size="sm" onClick={() => { const list = Array.from({ length: clampCount(ulidCount) }, genUlid); setUlids(list); setUlidHistRaw(JSON.stringify([...list, ...ulidHistory].slice(0, 100))) }}>生成</Button></div>
        <OutLines lines={ulids} />
        <HistoryList title="ULID 历史" items={ulidHistory} onDelete={(i) => setUlidHistRaw(JSON.stringify(ulidHistory.filter((_, x) => x !== i)))} onClear={() => setUlidHistRaw('[]')} />
      </section>
    </div>
  )
}

/* ---------------- TOML / YAML / JSON 互转 ---------------- */
type DataFmt = 'json' | 'yaml' | 'toml'
const FMT_NAME: Record<DataFmt, string> = { json: 'JSON', yaml: 'YAML', toml: 'TOML' }
const DATA_CONVERSIONS: { id: string; from: DataFmt; to: DataFmt }[] = [
  { id: 'yaml-json', from: 'yaml', to: 'json' },
  { id: 'yaml-toml', from: 'yaml', to: 'toml' },
  { id: 'json-yaml', from: 'json', to: 'yaml' },
  { id: 'json-toml', from: 'json', to: 'toml' },
  { id: 'toml-json', from: 'toml', to: 'json' },
  { id: 'toml-yaml', from: 'toml', to: 'yaml' }
]
function parseByFmt(fmt: DataFmt, text: string): unknown {
  if (!text.trim()) throw new Error('输入为空')
  const v: unknown = fmt === 'json' ? JSON.parse(text) : fmt === 'yaml' ? parseYaml(text) : parseToml(text)
  if (v === undefined || v === null) throw new Error('解析结果为空，请检查输入内容')
  return v
}
/** 所有输出统一美化：JSON 2 空格、YAML 2 空格、TOML 标准表排版 */
function formatByFmt(fmt: DataFmt, value: unknown): string {
  if (fmt === 'json') return JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? (v >= -9007199254740991n && v <= 9007199254740991n ? Number(v) : v.toString()) : v), 2)
  if (fmt === 'yaml') return stringifyYaml(value, { indent: 2 })
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('TOML 顶层必须是对象（键值表），当前顶层是数组或标量，请先包一层对象')
  const walk = (v: unknown, path: string): void => {
    if (v === null || v === undefined) throw new Error(`TOML 不支持 null（位于 ${path}），请删除该键或改为空字符串`)
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
    else if (typeof v === 'object' && !(v instanceof Date)) Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`))
  }
  walk(value, '$')
  return stringifyToml(value as Record<string, unknown>)
}
function TomlYamlTool(): React.JSX.Element {
  const [mode, setMode] = useStored('hadice-handy-datafmt-mode', 'yaml-json')
  const [input, setInput] = useStored('hadice-handy-datafmt-input', 'name: Hadice\nversion: 1.0.0\nfeatures:\n  - 编码\n  - 抓包\nserver:\n  port: 8080\n  debug: true\n')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState('')
  const conv = DATA_CONVERSIONS.find((c) => c.id === mode) ?? DATA_CONVERSIONS[0]
  const convert = (): void => {
    try { setOutput(formatByFmt(conv.to, parseByFmt(conv.from, input))); setErr('') }
    catch (e) { setOutput(''); setErr(e instanceof Error ? e.message : String(e)) }
  }
  const swap = (): void => {
    const rev = DATA_CONVERSIONS.find((c) => c.from === conv.to && c.to === conv.from)
    if (rev) setMode(rev.id)
    if (output) { setInput(output); setOutput('') }
  }
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid shrink-0 grid-cols-2 gap-1.5 md:grid-cols-3">
        {DATA_CONVERSIONS.map((c) => (
          <button key={c.id} type="button" onClick={() => setMode(c.id)}
            className={cn('rounded-md border px-2 py-2 text-xs font-medium transition-colors', conv.id === c.id ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30' : 'border-border bg-background/60 hover:border-primary/40 hover:bg-primary/5')}>
            {FMT_NAME[c.from]} 转 {FMT_NAME[c.to]}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" onClick={convert}>转换</Button>
        <Button size="sm" variant="secondary" disabled={!output} onClick={swap}>反向并回填</Button>
        <CopyBtn text={output} />
        <Button size="sm" variant="ghost" onClick={() => { setInput(''); setOutput(''); setErr('') }}>清空</Button>
        <span className="text-[11px] text-muted-foreground">结果自动美化：JSON / YAML 均 2 空格缩进，TOML 标准表排版</span>
      </div>
      {err && <div className="shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">{FMT_NAME[conv.from]} 解析/转换失败：{err}</div>}
      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-2">
        <div className="flex min-h-0 flex-col">
          <div className="mb-1 flex items-center gap-2"><Label>输入（{FMT_NAME[conv.from]}）</Label><Badge variant="outline">{conv.from.toUpperCase()}</Badge></div>
          <XTextarea className={cn(taCls, 'min-h-0 flex-1 resize-none')} value={input} onChange={(e) => setInput(e.target.value)} placeholder={`粘贴 ${FMT_NAME[conv.from]} 内容…`} />
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="mb-1 flex items-center gap-2"><Label>输出（{FMT_NAME[conv.to]}，已美化）</Label><Badge variant="outline">{conv.to.toUpperCase()}</Badge>{output && <span className="text-[10px] text-muted-foreground">{output.length} 字符</span>}</div>
          <div className="relative min-h-0 flex-1">
            <Textarea readOnly className={cn(taCls, 'h-full min-h-0 resize-none')} value={output} placeholder="" />
            {!output && <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground">{err ? '转换失败，详见上方提示' : '等待转换'}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------- 页面壳 ---------------- */
const TOOLS = [
  { id: 'timestamp', label: '时间戳', icon: Timer, node: <TimestampTool /> },
  { id: 'json', label: 'JSON 美化', icon: Braces, node: <JsonTool /> },
  { id: 'password', label: '随机密码', icon: KeyRound, node: <PasswordTool /> },
  { id: 'cron', label: 'Crontab', icon: Clock3, node: <CronTool /> },
  { id: 'diff', label: '文本 Diff', icon: GitCompare, node: <DiffTool /> },
  { id: 'encode', label: '编码/哈希', icon: Binary, node: <EncodeTool /> },
  { id: 'color', label: '颜色转换', icon: Palette, node: <ColorTool /> },
  { id: 'toml-yaml', label: 'TOML/YAML', icon: FileCode2, node: <TomlYamlTool /> },
  { id: 'id', label: 'UUID/ID 生成', icon: Fingerprint, node: <IdTool /> },
  { id: 'postman', label: '简易 Postman', icon: Globe, node: <PostmanTool /> },
  { id: 'image-base64', label: '图片转Base64', icon: ImageIcon, node: <ImageBase64Tool /> },
  { id: 'regex', label: '正则速查/测试', icon: Regex, node: <RegexTool /> },
  { id: 'qr', label: '二维码生成/解码', icon: QrCode, node: <QrTool /> },
] as const

/** 左栏折叠动画：快起慢停 + 轻微过冲阻尼（与应用布局同款曲线） */
const HANDY_PANEL_MS = 420
const HANDY_PANEL_EASE = 'cubic-bezier(0.22, 1.15, 0.36, 1)'
/** 高亮块：项高固定（展开/折叠均 32px），按索引 translateY，免测量；曲线/配色与主菜单共用 NAV_HIGHLIGHT_* */
export function HandyToolsPage(): React.JSX.Element {
  const [active, setActive] = useStored('hadice-handy-active', 'json')
  const [collapsed, setCollapsed] = useStored('hadice-handy-menu-collapsed', '')
  const isCollapsed = collapsed === '1'
  const tool = TOOLS.find((t) => t.id === active) ?? TOOLS[0]
  const activeIdx = Math.max(0, TOOLS.findIndex((t) => t.id === active))
  const toggle = (): void => setCollapsed(isCollapsed ? '' : '1')
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="flex flex-shrink-0 items-center gap-3 text-2xl font-bold">
        <Wrench className="h-6 w-6 text-primary" />便捷工具<WindowToggleButton /><HelpToggleButton />
      </h1>
      <div className="flex min-h-0 flex-1 gap-3">
        <aside
          className="relative shrink-0 overflow-hidden rounded-lg border border-border bg-card/40"
          style={{ width: isCollapsed ? 44 : 208, transition: `width ${HANDY_PANEL_MS}ms ${HANDY_PANEL_EASE}`, willChange: 'width' }}
        >
          <div className="absolute inset-y-0 left-0 flex w-[208px] flex-col gap-0.5 overflow-auto p-1" style={{ opacity: isCollapsed ? 0 : 1, transform: isCollapsed ? 'translateX(-8px)' : 'translateX(0)', transition: `opacity ${HANDY_PANEL_MS}ms ${HANDY_PANEL_EASE}, transform ${HANDY_PANEL_MS}ms ${HANDY_PANEL_EASE}`, pointerEvents: isCollapsed ? 'none' : 'auto' }}>
            <div className="flex justify-end px-1 pb-1">
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="折叠工具菜单" onClick={toggle}><PanelLeftClose className="h-4 w-4" /></Button>
            </div>
            {/* 高亮块：p-1(4) + 头行(28+4) + gap(2) = 38 起步，步进 32+2 */}
            <div aria-hidden className={cn('pointer-events-none absolute left-1 right-1 h-8 rounded', NAV_HIGHLIGHT_CLS)} style={{ top: 0, transform: `translateY(${38 + activeIdx * 34}px)`, transition: `transform ${NAV_HIGHLIGHT_MS}ms ${NAV_HIGHLIGHT_EASE}`, willChange: 'transform' }} />
            {TOOLS.map((t) => (
              <button key={t.id} type="button" onClick={() => setActive(t.id)} className={cn('relative flex items-center gap-2 rounded px-2 py-2 text-left text-xs transition-colors duration-300 hover:bg-muted/40', active === t.id && 'font-medium text-primary')}>
                <t.icon className="h-4 w-4 shrink-0" />{t.label}
              </button>
            ))}
          </div>
          <div className="absolute inset-0 flex flex-col items-center gap-1 overflow-auto py-2" style={{ opacity: isCollapsed ? 1 : 0, transform: isCollapsed ? 'translateX(0)' : 'translateX(8px)', transition: `opacity ${HANDY_PANEL_MS}ms ${HANDY_PANEL_EASE}, transform ${HANDY_PANEL_MS}ms ${HANDY_PANEL_EASE}`, pointerEvents: isCollapsed ? 'auto' : 'none' }}>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" title="展开工具菜单" onClick={toggle}><PanelLeftOpen className="h-4 w-4" /></Button>
            {/* 高亮块：py-2(8) + 展开钮(32) + gap(4) = 44 起步，步进 32+4 */}
            <div aria-hidden className={cn('pointer-events-none absolute left-1/2 h-8 w-8 rounded', NAV_HIGHLIGHT_CLS)} style={{ top: 0, transform: `translate(-50%, ${44 + activeIdx * 36}px)`, transition: `transform ${NAV_HIGHLIGHT_MS}ms ${NAV_HIGHLIGHT_EASE}`, willChange: 'transform' }} />
            {/* ponytail: ghost 的 hover:bg-accent 不透明会盖死滑块，故降为 /40 且选中时悬停不夺色 */}
            {TOOLS.map((t) => (
              <Button key={t.id} type="button" size="icon" variant="ghost" className={cn('relative h-8 w-8 transition-colors duration-300 hover:bg-accent/40', active === t.id && 'text-primary hover:text-primary')} title={t.label} onClick={() => setActive(t.id)}><t.icon className="h-4 w-4" /></Button>
            ))}
          </div>
        </aside>
        {/* 右侧统一规则：高度撑满至底部、不超过整体面板、内容过长内部滚动 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card/40">
          <div className="min-h-0 flex-1 overflow-auto"><div className="h-full p-4">{tool.node}</div></div>
        </div>
      </div>
    </div>
  )
}
