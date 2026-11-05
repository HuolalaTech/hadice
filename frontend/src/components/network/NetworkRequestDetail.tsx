import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Globe, PanelRightClose, Star } from 'lucide-react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { foldAll, unfoldAll } from '@codemirror/language'
import { toast } from 'sonner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { getNetworkRequestKey } from '@/lib/network-request-key'
import { stripUrlForFavorite } from '@/lib/network-url'
import { openWebPeek } from '@/lib/open-web-peek'
import { copyTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { useNetworkFavoriteStore } from '@/store/networkFavoriteStore'
import { useThemeStore } from '@/store/themeStore'
import type { NetworkRequest } from '@/types/hdc'

interface NetworkRequestDetailProps {
  request: NetworkRequest | null
  searchQuery: string
  searchMatches: Map<string, {
    urlMatch: boolean
    requestBodyMatch: boolean
    responseBodyMatch: boolean
    requestHeadersMatch: boolean
    requestParamsMatch: boolean
    matches: Array<{ start: number; end: number; text: string }>
  }>
  isRegexMode: boolean
  /** 折叠右侧详情面板（Task 5/6 接按钮） */
  onCollapsePanel?: () => void
}

/**
 * 格式化时间戳
 */
function formatTimestamp(timestamp: number): string {
  try {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    })
  } catch (error) {
    // 如果 DateTimeFormat 初始化失败，使用备用格式
    console.warn('DateTimeFormat failed, using fallback format:', error)
    const date = new Date(timestamp)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0')
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}.${milliseconds}`
  }
}

/**
 * 是否像 JSON（对象/数组；含双重引号包裹的 JSON 字符串）
 */
function looksLikeJSON(text: string | undefined): boolean {
  if (!text) return false
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return false
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return true
  }
  // 双重编码：整段是 JSON 字符串
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const inner = JSON.parse(trimmed)
      return typeof inner === 'string' && looksLikeJSON(inner)
    } catch {
      return false
    }
  }
  return false
}

/**
 * 格式化 JSON（对齐 Mock：缩进 2；支持 BOM / 双重编码）
 */
function formatJSON(raw: string | undefined): string {
  if (!raw) return ''
  const text = raw.replace(/^\uFEFF/, '').trim()
  if (!text) return raw
  try {
    let parsed: unknown = JSON.parse(text)
    // 双重编码：解析后仍是 JSON 字符串则再解一层
    if (typeof parsed === 'string') {
      const inner = parsed.trim()
      if (
        (inner.startsWith('{') && inner.endsWith('}')) ||
        (inner.startsWith('[') && inner.endsWith(']'))
      ) {
        try {
          parsed = JSON.parse(inner)
        } catch {
          // keep string
        }
      }
    }
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function isJSONFormatted(text: string): boolean {
  return text.includes('\n') && looksLikeJSON(text)
}

/**
 * 解析和美化JSON字符串
 * 处理转义的JSON字符串，自动反转义并格式化
 */
function parseAndPretifyJSON(value: unknown): string | null {
  if (typeof value !== 'string') return null
  
  // 检测是否看起来像JSON（以 { 或 [ 开头，以 } 或 ] 结尾）
  const trimmed = value.trim()
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
    return null
  }
  
  try {
    // 尝试解析JSON字符串
    const parsed = JSON.parse(value)
    // 格式化为多行JSON
    return JSON.stringify(parsed, null, 2)
  } catch {
    return null
  }
}

/**
 * 从 URL 字符串中解析 query parameters
 * 当 requestParams 不可用时作为 fallback
 */
function parseQueryParamsFromURL(urlString: string): Record<string, string> {
  const params: Record<string, string> = {}
  if (!urlString) return params

  let url: URL
  try {
    // 如果 URL 缺少 protocol，补全后再解析
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      url = new URL(`https://${urlString}`)
    } else {
      url = new URL(urlString)
    }
  } catch {
    // URL 解析失败，尝试正则 fallback
    const queryIndex = urlString.indexOf('?')
    if (queryIndex === -1) return params
    const queryString = urlString.substring(queryIndex + 1)
    for (const pair of queryString.split('&')) {
      const eqIndex = pair.indexOf('=')
      if (eqIndex > 0) {
        const key = decodeURIComponent(pair.substring(0, eqIndex))
        const value = decodeURIComponent(pair.substring(eqIndex + 1))
        params[key] = value
      }
    }
    return params
  }

  url.searchParams.forEach((value: string, key: string) => {
    params[key] = value
  })

  return params
}

/**
 * 序列化URL参数
 * 将参数对象转换为URL query string格式，处理JSON字符串反转义
 */
function serializeParams(params: Record<string, unknown>): string {
  const pairs: string[] = []
  
  for (const [key, value] of Object.entries(params)) {
    let queryValue: string
    
    if (typeof value === 'string') {
      // 尝试检测和反转义JSON字符串
      const trimmed = value.trim()
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          // 如果是JSON字符串，先解析再序列化
          const parsed = JSON.parse(value)
          queryValue = JSON.stringify(parsed)
        } catch {
          // 解析失败，使用原始值
          queryValue = String(value)
        }
      } else {
        queryValue = String(value)
      }
    } else if (value === null || value === undefined) {
      queryValue = ''
    } else {
      queryValue = JSON.stringify(value)
    }
    
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(queryValue)}`)
  }
  
  return pairs.join('&')
}

/**
 * 构建完整的HTTP URL
 * 拼接 baseURL + url + ? + 序列化params
 * 注意：url 中如果已包含完整的 URL（http:// 或 https://），则直接使用
 */
function buildFullURL(baseURL: string | undefined, url: string | undefined, params: Record<string, unknown> | undefined): string {
  let fullURL = ''
  
  if (!url) {
    return fullURL
  }
  
  // 如果 url 已经是完整 URL（以 http:// 或 https:// 开头），直接使用
  if (url.startsWith('http://') || url.startsWith('https://')) {
    fullURL = url
  } else {
    // 否则，拼接 baseURL 和 url
    if (baseURL) {
      fullURL += baseURL.replace(/\/$/, '') // 移除末尾斜杠
    }
    fullURL += url
  }
  
  if (params && Object.keys(params).length > 0) {
    // 检查 url 中是否已经有参数
    const hasQueryString = fullURL.includes('?')
    const separator = hasQueryString ? '&' : '?'
    fullURL += separator + serializeParams(params)
  }
  
  return fullURL
}

/**
 * 可折叠分区组件
 */
function CollapsibleSection({
  title,
  children,
  defaultOpen = true
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <button
        className="w-full flex items-center justify-between p-3 hover:bg-secondary/30 transition-colors gap-2"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="font-medium text-sm">{title}</span>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>
      {isOpen && <div className="p-3 pt-0 w-full max-w-full overflow-hidden">{children}</div>}
    </div>
  )
}

/**
 * 高亮文本组件
 */
function HighlightText({
  text,
  searchQuery,
  isRegexMode
}: {
  text: string
  searchQuery: string
  isRegexMode: boolean
}): React.JSX.Element {
  if (!searchQuery.trim()) {
    return <>{text}</>
  }

  try {
    if (isRegexMode) {
      const regex = new RegExp(searchQuery, 'gi')
      const parts: Array<{ text: string; isMatch: boolean }> = []
      let lastIndex = 0
      let match

      // 重置正则表达式
      regex.lastIndex = 0
      while ((match = regex.exec(text)) !== null) {
        // 添加匹配前的文本
        if (match.index > lastIndex) {
          parts.push({ text: text.substring(lastIndex, match.index), isMatch: false })
        }
        // 添加匹配的文本
        parts.push({ text: match[0], isMatch: true })
        lastIndex = match.index + match[0].length
      }
      // 添加剩余的文本
      if (lastIndex < text.length) {
        parts.push({ text: text.substring(lastIndex), isMatch: false })
      }

      if (parts.length === 0) {
        return <>{text}</>
      }

      return (
        <>
          {parts.map((part, index) =>
            part.isMatch ? (
              <span key={index} className="bg-yellow-400 text-yellow-900 font-semibold">
                {part.text}
              </span>
            ) : (
              <span key={index}>{part.text}</span>
            )
          )}
        </>
      )
    } else {
      const lowerText = text.toLowerCase()
      const lowerQuery = searchQuery.toLowerCase()
      const parts: Array<{ text: string; isMatch: boolean }> = []
      let lastIndex = 0
      let index = lowerText.indexOf(lowerQuery, lastIndex)

      while (index !== -1) {
        // 添加匹配前的文本
        if (index > lastIndex) {
          parts.push({ text: text.substring(lastIndex, index), isMatch: false })
        }
        // 添加匹配的文本
        parts.push({ text: text.substring(index, index + searchQuery.length), isMatch: true })
        lastIndex = index + searchQuery.length
        index = lowerText.indexOf(lowerQuery, lastIndex)
      }
      // 添加剩余的文本
      if (lastIndex < text.length) {
        parts.push({ text: text.substring(lastIndex), isMatch: false })
      }

      if (parts.length === 0) {
        return <>{text}</>
      }

      return (
        <>
          {parts.map((part, index) =>
            part.isMatch ? (
              <span key={index} className="bg-yellow-400 text-yellow-900 font-semibold">
                {part.text}
              </span>
            ) : (
              <span key={index}>{part.text}</span>
            )
          )}
        </>
      )
    }
  } catch {
    // 正则表达式无效，返回原文本
    return <>{text}</>
  }
}

const jsonViewerTheme = EditorView.theme({
  '&': {
    width: '100%',
    maxWidth: '100%',
    minWidth: '0',
    overflow: 'hidden',
    fontSize: '12px'
  },
  '.cm-editor': {
    width: '100%',
    maxWidth: '100%',
    minWidth: '0'
  },
  '& .cm-scroller': {
    maxWidth: '100%',
    maxHeight: '480px',
    overflowX: 'auto',
    overflowY: 'auto'
  },
  '& .cm-content': {
    width: 'fit-content',
    minWidth: '100%'
  },
  '& .cm-line': {
    whiteSpace: 'pre'
  }
})

/**
 * JSON 响应/请求体：默认格式化，CodeMirror 展示（对齐 Mock）
 */
function JsonBodyBlock({
  raw,
  searchQuery,
  isRegexMode
}: {
  raw: string
  searchQuery?: string
  isRegexMode?: boolean
}): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const [text, setText] = useState(() => formatJSON(raw))
  const [copied, setCopied] = useState(false)
  const [folded, setFolded] = useState(false)
  const editorViewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    setText(formatJSON(raw))
    setFolded(false)
  }, [raw])

  const extensions = useMemo(() => [json(), jsonViewerTheme, EditorView.editable.of(false)], [])
  const searching = Boolean(searchQuery?.trim())

  const handleToggleFold = (): void => {
    const view = editorViewRef.current
    if (!view) return
    if (folded) {
      unfoldAll(view)
      setFolded(false)
    } else {
      foldAll(view)
      setFolded(true)
    }
  }

  const handleFormat = (): void => {
    const next = formatJSON(text)
    if (next === text && !isJSONFormatted(text)) {
      // 尝试对原始 raw 再格式化一次
      const fromRaw = formatJSON(raw)
      if (fromRaw === raw) {
        toast.error('JSON 格式错误，无法格式化')
        return
      }
      setText(fromRaw)
      toast.success('JSON 格式化成功')
      return
    }
    if (next === text && isJSONFormatted(text)) {
      toast.success('已是格式化 JSON')
      return
    }
    setText(next)
    toast.success('JSON 格式化成功')
  }

  const handleCopy = async (): Promise<void> => {
    const success = await copyTextToClipboard(text)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('复制失败')
    }
  }

  // 搜索命中时退回可高亮的 pre，内容仍用已格式化文本
  if (searching) {
    return (
      <CodeBlock
        content={text}
        language="json"
        searchQuery={searchQuery}
        isRegexMode={isRegexMode}
      />
    )
  }

  return (
    <div className="relative w-full max-w-full min-w-0 overflow-hidden space-y-2">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 flex-shrink-0" onClick={() => void handleCopy()} title="复制">
          {copied ? <Check className="h-3 w-3 text-green-700 dark:text-green-400" /> : <Copy className="h-3 w-3" />}
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleFormat}>
          格式化 JSON
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleToggleFold}
          title={folded ? '全部展开' : '全部折叠'}
        >
          {folded ? (
            <ChevronsUpDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronsDownUp className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <div className="min-w-0 overflow-hidden rounded-md border bg-muted">
        <CodeMirror
          value={text || '(空)'}
          height="auto"
          minHeight="80px"
          maxHeight="480px"
          width="100%"
          maxWidth="100%"
          theme={theme}
          editable={false}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: false,
            bracketMatching: true,
            closeBrackets: false,
            autocompletion: false,
            searchKeymap: false
          }}
          extensions={extensions}
          onCreateEditor={(view) => {
            editorViewRef.current = view
          }}
          className="w-full max-w-full min-w-0 text-xs"
        />
      </div>
    </div>
  )
}

/**
 * 代码块组件
 */
function CodeBlock({
  content,
  language = 'json',
  searchQuery,
  isRegexMode
}: {
  content: string
  language?: string
  searchQuery?: string
  isRegexMode?: boolean
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (): Promise<void> => {
    const success = await copyTextToClipboard(content)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('复制失败')
    }
  }

  const displayContent = content || '(空)'

  return (
    <div className="relative w-full max-w-full overflow-hidden">
      <div className="flex gap-2 items-baseline mb-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 flex-shrink-0"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-700 dark:text-green-400" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
        
      </div>
      <pre className="p-3 bg-secondary/50 rounded-md text-xs font-mono break-words whitespace-pre-wrap max-w-full" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
        <code className="break-words whitespace-pre-wrap" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
          {searchQuery && searchQuery.trim() ? (
            <HighlightText text={displayContent} searchQuery={searchQuery} isRegexMode={isRegexMode || false} />
          ) : (
            displayContent
          )}
        </code>
      </pre>
    </div>
  )
}

/**
 * 键值对列表组件
 */
function KeyValueList({
  data,
  searchQuery,
  isRegexMode
}: {
  data: Record<string, string> | undefined
  searchQuery?: string
  isRegexMode?: boolean
}): React.JSX.Element {
  if (!data || Object.keys(data).length === 0) {
    return <div className="text-sm text-muted-foreground">(空)</div>
  }

  return (
    <div className="space-y-1">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="flex gap-2 text-sm items-baseline">
          <span className="font-medium text-muted-foreground min-w-[120px] flex-shrink-0">{key}:</span>
          <span className="font-mono text-xs break-all">
            {searchQuery?.trim() ? (
              <HighlightText text={value} searchQuery={searchQuery} isRegexMode={isRegexMode || false} />
            ) : (
              value
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * URL 查询参数项目组件
 * ponytail: WebView hover 不可靠，改为点击行显示复制按钮
 */
function URLQueryParamItem({
  paramKey,
  value,
  searchQuery,
  isRegexMode,
  selected,
  onSelect
}: {
  paramKey: string
  value: unknown
  searchQuery?: string
  isRegexMode?: boolean
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const stringValue = String(value)
  const prettifiedJSON = parseAndPretifyJSON(value)
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    // 字段 + 值两部分（query 形态，便于粘贴）
    const success = await copyTextToClipboard(`${paramKey}=${stringValue}`)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('复制失败')
    }
  }

  return (
    <div
      className="py-0.5 cursor-pointer rounded-md px-1 -mx-1 hover:bg-secondary/40"
      onClick={onSelect}
    >
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-medium text-muted-foreground min-w-fit flex-shrink-0">{paramKey}:</span>
        {selected && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-4 w-4 p-0 flex-shrink-0"
            onClick={(e) => void handleCopy(e)}
            title={`复制 ${paramKey}=…`}
            aria-label={`复制参数 ${paramKey}`}
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-700 dark:text-green-400" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        )}
        <div className="min-w-0 flex-1">
          {prettifiedJSON ? (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80 bg-secondary/50 rounded-md p-2 overflow-hidden">
              {searchQuery?.trim() ? (
                <HighlightText text={prettifiedJSON} searchQuery={searchQuery} isRegexMode={isRegexMode || false} />
              ) : (
                prettifiedJSON
              )}
            </pre>
          ) : (
            <span className="font-mono text-xs break-all text-foreground/80">
              {searchQuery?.trim() ? (
                <HighlightText text={stringValue} searchQuery={searchQuery} isRegexMode={isRegexMode || false} />
              ) : (
                stringValue
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * URL 查询参数展示组件
 * 用于展示 data.request.params 的内容，支持JSON字符串的美观显示
 */
function URLQueryParamsSection({
  params,
  searchQuery,
  isRegexMode
}: {
  params: Record<string, unknown> | undefined
  searchQuery?: string
  isRegexMode?: boolean
}): React.JSX.Element {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  if (!params || Object.keys(params).length === 0) {
    return <div className="text-sm text-muted-foreground">(无参数)</div>
  }

  return (
    <div
      className="space-y-2"
      onClick={(e) => {
        // 点空白处取消选中
        if (e.target === e.currentTarget) setSelectedKey(null)
      }}
    >
      {Object.entries(params).map(([key, value]) => (
        <URLQueryParamItem
          key={key}
          paramKey={key}
          value={value}
          searchQuery={searchQuery}
          isRegexMode={isRegexMode}
          selected={selectedKey === key}
          onSelect={() => setSelectedKey((prev) => (prev === key ? null : key))}
        />
      ))}
    </div>
  )
}

/**
 * 网络请求详情面板组件
 */
export function NetworkRequestDetail({
  request,
  searchQuery,
  searchMatches,
  isRegexMode,
  onCollapsePanel
}: NetworkRequestDetailProps): React.JSX.Element {
  const toggleFavorite = useNetworkFavoriteStore((s) => s.toggleFavorite)
  // 必须订阅 favorites 数组，不能只取 isFavorite 函数引用（否则收藏变化不重渲）
  const favoriteKey = request ? stripUrlForFavorite(request) : ''
  const isFav = useNetworkFavoriteStore((s) =>
    favoriteKey ? s.favorites.includes(favoriteKey) : false
  )

  const detailToolbar = (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0">
      <span className="text-xs font-medium text-muted-foreground flex-1">响应详情</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!request || !favoriteKey}
        title={isFav ? '取消收藏' : '收藏（保留到第一个 & 前）'}
        onClick={() => {
          if (!request) return
          toggleFavorite(request)
        }}
      >
        <Star className={cn('h-3.5 w-3.5', isFav && 'fill-amber-500 text-amber-500')} />
      </Button>
      {onCollapsePanel && (
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="折叠详情" onClick={onCollapsePanel}>
          <PanelRightClose className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )

  if (!request) {
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        {detailToolbar}
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="text-sm">请选择一个请求查看详情</p>
          </div>
        </div>
      </div>
    )
  }

  const requestKey = getNetworkRequestKey(request)
  const matchInfo = searchMatches.get(requestKey)
  const hasURLMatch = matchInfo?.urlMatch || false
  const hasRequestBodyMatch = matchInfo?.requestBodyMatch || false
  const hasResponseBodyMatch = matchInfo?.responseBodyMatch || false
  const hasRequestHeadersMatch = matchInfo?.requestHeadersMatch || false
  const hasRequestParamsMatch = matchInfo?.requestParamsMatch || false
  const hasRequestTabMatch = hasURLMatch || hasRequestBodyMatch || hasRequestHeadersMatch || hasRequestParamsMatch

  // 获取有效的 query parameters：优先使用 requestParams，fallback 到 URL 解析
  const fullURLForParams = buildFullURL(request.baseURL, request.fullUrl || request.url, undefined)
  const urlParsedParams = parseQueryParamsFromURL(fullURLForParams)
  const effectiveParams = (request.requestParams && Object.keys(request.requestParams).length > 0)
    ? request.requestParams
    : (Object.keys(urlParsedParams).length > 0 ? urlParsedParams : undefined)

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      {detailToolbar}
      <Tabs defaultValue="request" className="w-full flex-1 min-h-0 flex flex-col">
        <TabsList className="w-full flex-shrink-0">
          <TabsTrigger value="request" className="flex-1 flex items-center justify-center gap-2">
            请求
            {hasRequestTabMatch && (
              <span className="w-2 h-2 bg-red-500 rounded-full" />
            )}
          </TabsTrigger>
          <TabsTrigger value="response" className="flex-1 flex items-center justify-center gap-2">
            响应
            {hasResponseBodyMatch && (
              <span className="w-2 h-2 bg-red-500 rounded-full" />
            )}
          </TabsTrigger>
        </TabsList>
        
        <ScrollArea className="flex-1 min-h-0">
        
        {/* 请求内容 */}
        <TabsContent value="request" className="mt-2 space-y-0">
          {/* Overview */}
          <CollapsibleSection 
            title="Overview" 
            defaultOpen={true}
          >
            <div className="space-y-2 text-sm">
              <div className="flex gap-2 items-baseline">
                <span className="font-medium text-muted-foreground min-w-[100px] flex-shrink-0">Method:</span>
                <span className="font-mono">{request.method}</span>
              </div>
              {/* URL with copy button on the left */}
              <div className="flex gap-2 text-sm items-baseline min-w-0">
                <span className="font-medium text-muted-foreground min-w-[100px] flex-shrink-0">URL:</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 flex-shrink-0"
                  onClick={async () => {
                    const fullURL = buildFullURL(request.baseURL, request.fullUrl || request.url, request.requestParams)
                    const success = await copyTextToClipboard(fullURL)
                    if (success) {
                      toast.success('已复制完整 URL')
                    } else {
                      toast.error('复制失败')
                    }
                  }}
                  title="复制完整 URL"
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 flex-shrink-0"
                  title="网页看看（应用内打开）"
                  onClick={() => {
                    const fullURL = buildFullURL(request.baseURL, request.fullUrl || request.url, request.requestParams)
                    void openWebPeek(fullURL)
                  }}
                >
                  <Globe className="h-3 w-3" />
                </Button>
                <span 
                  className="font-mono text-xs text-foreground/80 flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                >
                  {searchQuery.trim() && matchInfo?.urlMatch ? (
                    <HighlightText
                      text={buildFullURL(request.baseURL, request.fullUrl || request.url, request.requestParams)}
                      searchQuery={searchQuery}
                      isRegexMode={isRegexMode}
                    />
                  ) : (
                    buildFullURL(request.baseURL, request.fullUrl || request.url, request.requestParams)
                  )}
                </span>
              </div>
              <div className="flex gap-2 items-baseline">
                <span className="font-medium text-muted-foreground min-w-[100px] flex-shrink-0">Time:</span>
                <span className="font-mono text-xs">{formatTimestamp(request.timestamp)}</span>
              </div>
              {request.extra && (
                <>
                  <div className="flex gap-2 items-baseline">
                    <span className="font-medium text-muted-foreground min-w-[100px] flex-shrink-0">Request ID:</span>
                    <span className="font-mono text-xs">{request.extra.id}</span>
                  </div>
                  {request.extra.uid && (
                    <div className="flex gap-2 items-baseline">
                      <span className="font-medium text-muted-foreground min-w-[100px] flex-shrink-0">UID:</span>
                      <span className="font-mono text-xs">{request.extra.uid}</span>
                    </div>
                  )}
                  {request.extra.reqTime > 0 && (
                    <div className="flex gap-2 items-baseline">
                      <span className="font-medium text-muted-foreground min-w-[100px] flex-shrink-0">Request Time:</span>
                      <span className="font-mono text-xs">{formatTimestamp(request.extra.reqTime)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </CollapsibleSection>

          {/* URL Query Parameters */}
          {effectiveParams && (
            <CollapsibleSection title="URL Query Parameters" defaultOpen={true}>
              <URLQueryParamsSection params={effectiveParams} searchQuery={searchQuery} isRegexMode={isRegexMode} />
            </CollapsibleSection>
          )}

          {/* Request Headers */}
          {request.requestHeaders && (
            <CollapsibleSection title="Request Headers" defaultOpen={false}>
              <KeyValueList data={request.requestHeaders} searchQuery={searchQuery} isRegexMode={isRegexMode} />
            </CollapsibleSection>
          )}

          {/* Request Body */}
          {request.requestBody && (
            <CollapsibleSection title="Body" defaultOpen={true}>
              {looksLikeJSON(request.requestBody) ? (
                <JsonBodyBlock
                  raw={request.requestBody}
                  searchQuery={searchQuery}
                  isRegexMode={isRegexMode}
                />
              ) : (
                <CodeBlock
                  content={request.requestBody}
                  searchQuery={searchQuery}
                  isRegexMode={isRegexMode}
                />
              )}
            </CollapsibleSection>
          )}
        </TabsContent>

        {/* 响应内容 */}
        <TabsContent value="response" className="mt-2 space-y-0">
          {/* Overview */}
          <CollapsibleSection title="Overview" defaultOpen={true}>
            <div className="space-y-2 text-sm">
              {request.statusCode && (
                <div className="flex gap-2 items-baseline">
                  <span className="font-medium text-muted-foreground min-w-[100px] flex-shrink-0">Status:</span>
                  <span className="font-mono">{request.statusCode}</span>
                </div>
              )}
              <div className="flex gap-2 items-baseline">
                <span className="font-medium text-muted-foreground min-w-[100px] flex-shrink-0">Time:</span>
                <span className="font-mono text-xs">{formatTimestamp(request.timestamp)}</span>
              </div>
              {request.extra && (
                <>
                  {request.extra.respTime > 0 && (
                    <div className="flex gap-2 items-baseline">
                      <span className="font-medium text-muted-foreground min-w-[100px] flex-shrink-0">Response Time:</span>
                      <span className="font-mono text-xs">{formatTimestamp(request.extra.respTime)}</span>
                    </div>
                  )}
                  {request.extra.reqTime > 0 && request.extra.respTime > 0 && (
                    <div className="flex gap-2 items-baseline">
                      <span className="font-medium text-muted-foreground min-w-[100px] flex-shrink-0">Duration:</span>
                      <span className="font-mono text-xs">
                        {request.extra.respTime - request.extra.reqTime}ms
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </CollapsibleSection>

          {/* Response Headers */}
          {request.responseHeaders && (
            <CollapsibleSection title="Response Headers" defaultOpen={false}>
              <KeyValueList data={request.responseHeaders} />
            </CollapsibleSection>
          )}

          {/* Response Body */}
          {request.responseBody && (
            <CollapsibleSection title="Body" defaultOpen={true}>
              {request.responseBody.startsWith('data:image/') ? (
                <div className="space-y-2">
                  <img
                    src={request.responseBody}
                    alt="response"
                    className="max-w-full rounded border border-border"
                    style={{ maxHeight: 400 }}
                  />
                  <div className="text-xs text-muted-foreground">
                    {request.responseBody.substring(request.responseBody.indexOf('/') + 1, request.responseBody.indexOf(';'))}
                    {' '}({Math.round((request.responseBody.length * 3) / 4 / 1024)}KB)
                  </div>
                </div>
              ) : looksLikeJSON(request.responseBody) ? (
                <JsonBodyBlock
                  raw={request.responseBody}
                  searchQuery={searchQuery}
                  isRegexMode={isRegexMode}
                />
              ) : (
                <CodeBlock
                  content={request.responseBody}
                  searchQuery={searchQuery}
                  isRegexMode={isRegexMode}
                />
              )}
            </CollapsibleSection>
          )}
        </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  )
}
