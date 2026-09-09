import * as App from '../../bindings/Hadice/backend/appservice'
import type { NetworkRequest } from '@/types/hdc'
import { formatOutputTimestamp, sanitizeOutputComponent } from '@/lib/outputNaming'

/** 导出格式 */
export type ExportFormat = 'har' | 'json' | 'csv'

/** 导出内容配置 */
export interface ExportContentConfig {
  requestUrl: boolean
  requestHeaders: boolean
  requestBody: boolean
  responseHeaders: boolean
  responseBody: boolean
}

/** 完整的导出配置 */
export interface ExportConfig {
  format: ExportFormat
  content: ExportContentConfig
}

/** 导出结果 */
export interface ExportResult {
  success: boolean
  filePath?: string
  error?: string
}

/** 默认导出内容：请求URL + 响应Body */
const DEFAULT_CONTENT: ExportContentConfig = {
  requestUrl: true,
  requestHeaders: false,
  requestBody: false,
  responseHeaders: false,
  responseBody: true
}

const DEFAULT_CONFIG: ExportConfig = {
  format: 'csv',
  content: DEFAULT_CONTENT
}

const STORAGE_KEY = 'network-export-config'

/** 从 localStorage 读取导出配置 */
export function loadExportConfig(): ExportConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        format: parsed.format || DEFAULT_CONFIG.format,
        content: {
          requestUrl: parsed.content?.requestUrl ?? DEFAULT_CONTENT.requestUrl,
          requestHeaders: parsed.content?.requestHeaders ?? DEFAULT_CONTENT.requestHeaders,
          requestBody: parsed.content?.requestBody ?? DEFAULT_CONTENT.requestBody,
          responseHeaders: parsed.content?.responseHeaders ?? DEFAULT_CONTENT.responseHeaders,
          responseBody: parsed.content?.responseBody ?? DEFAULT_CONTENT.responseBody
        }
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG, content: { ...DEFAULT_CONTENT } }
}

/** 保存导出配置到 localStorage */
export function saveExportConfig(config: ExportConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // ignore
  }
}

function headersToString(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

function escapeCsvField(value: string): string {
  // 如果包含逗号、双引号、换行，用双引号包裹并转义内部双引号
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function getFieldValue(request: NetworkRequest, key: keyof ExportContentConfig): string {
  switch (key) {
    case 'requestUrl':
      return request.fullUrl || request.url || ''
    case 'requestHeaders':
      return request.requestHeaders ? headersToString(request.requestHeaders) : ''
    case 'requestBody':
      return request.requestBody || ''
    case 'responseHeaders':
      return request.responseHeaders ? headersToString(request.responseHeaders) : ''
    case 'responseBody':
      return request.responseBody || ''
  }
}

const COLUMN_LABELS: Record<keyof ExportContentConfig, string> = {
  requestUrl: '请求 URL',
  requestHeaders: '请求 Headers',
  requestBody: '请求 Body',
  responseHeaders: '响应 Headers',
  responseBody: '响应 Body'
}

const ALL_COLUMNS: Array<keyof ExportContentConfig> = [
  'requestUrl', 'requestHeaders', 'requestBody', 'responseHeaders', 'responseBody'
]

/** 格式化时间戳为 yyyy-mm-dd hh:mm:ss */
function formatCsvTimestamp(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 生成标准 CSV 内容（逗号分隔，双引号包裹，首列为时间） */
function generateCsv(requests: NetworkRequest[], content: ExportContentConfig): string {
  const enabledKeys = ALL_COLUMNS.filter((k) => content[k])
  const headerLine = ['时间', ...enabledKeys.map((k) => escapeCsvField(COLUMN_LABELS[k]))].join(',')
  const dataLines = requests.map((req) => {
    const timeCell = escapeCsvField(formatCsvTimestamp(req.timestamp))
    const dataCells = enabledKeys.map((key) => escapeCsvField(getFieldValue(req, key)))
    return [timeCell, ...dataCells].join(',')
  })
  return [headerLine, ...dataLines].join('\n')
}

/** 生成 JSON 内容 */
function generateJson(requests: NetworkRequest[], content: ExportContentConfig): string {
  const items = requests.map((req) => {
    const item: Record<string, unknown> = {
      method: req.method,
      url: req.fullUrl || req.url || '',
      timestamp: req.timestamp
    }
    if (req.statusCode) item.statusCode = req.statusCode
    if (content.requestHeaders) item.requestHeaders = req.requestHeaders || {}
    if (content.requestBody) item.requestBody = req.requestBody || null
    if (content.responseHeaders) item.responseHeaders = req.responseHeaders || {}
    if (content.responseBody) {
      try { item.responseBody = JSON.parse(req.responseBody || 'null') } catch { item.responseBody = req.responseBody || '' }
    }
    return item
  })
  return JSON.stringify(items, null, 2)
}

/** 生成 HAR 内容 */
function generateHar(requests: NetworkRequest[], content: ExportContentConfig): string {
  const entries = requests.map((req) => {
    const url = req.fullUrl || req.url || ''
    const responseTime = req.extra?.reqTime && req.extra?.respTime
      ? req.extra.respTime - req.extra.reqTime
      : 0

    const entry: Record<string, unknown> = {
      startedDateTime: new Date(req.timestamp).toISOString(),
      time: responseTime,
      request: {
        method: req.method, url, httpVersion: 'HTTP/1.1',
        cookies: [], headers: [], queryString: [], headersSize: -1, bodySize: -1
      },
      response: {
        status: req.statusCode || 0, statusText: '', httpVersion: 'HTTP/1.1',
        cookies: [], headers: [], content: { size: 0, mimeType: '' },
        redirectURL: '', headersSize: -1, bodySize: -1
      },
      cache: {}, timings: { send: 0, wait: 0, receive: 0 }
    }

    if (content.requestHeaders && req.requestHeaders) {
      ;(entry.request as Record<string, unknown>).headers = Object.entries(req.requestHeaders).map(
        ([name, value]) => ({ name, value })
      )
    }
    if (content.requestBody && req.requestBody) {
      ;(entry.request as Record<string, unknown>).postData = { mimeType: 'application/json', text: req.requestBody }
    }
    if (content.responseHeaders && req.responseHeaders) {
      ;(entry.response as Record<string, unknown>).headers = Object.entries(req.responseHeaders).map(
        ([name, value]) => ({ name, value })
      )
    }
    if (content.responseBody && req.responseBody) {
      ;(entry.response as Record<string, unknown>).content = { size: req.responseBody.length, mimeType: 'application/json', text: req.responseBody }
    }

    return entry
  })

  return JSON.stringify({
    log: { version: '1.2', creator: { name: 'Hadice Network Capture', version: '1.0' }, entries }
  }, null, 2)
}

/**
 * 导出选中的网络请求到文件
 * 文件保存到 ~/Documents/Hadice/network/ 目录
 * 返回完整文件路径
 */
export async function exportNetworkRequests(
  requests: NetworkRequest[],
  config: ExportConfig,
  platform: 'android' | 'harmony',
  processName: string
): Promise<ExportResult> {
  if (requests.length === 0) {
    return { success: false, error: '没有选中的请求' }
  }

  let content: string
  const ts = formatOutputTimestamp()

  switch (config.format) {
    case 'har':
      content = generateHar(requests, config.content)
      break
    case 'json':
      content = generateJson(requests, config.content)
      break
    case 'csv':
    default:
      content = generateCsv(requests, config.content)
      break
  }

  // BOM for Excel UTF-8 compatibility
  const fileContent = '﻿' + content
  const safeProcessName = sanitizeOutputComponent(processName, 'process')
  const filename = `capture_${platform}_${safeProcessName}_${ts}.${getExtension(config.format)}`

  try {
    const filePath = await App.SaveTextFile(`network/${filename}`, fileContent)
    return { success: true, filePath }
  } catch (error) {
    console.error('[NetworkExport] 导出失败:', error)
    return { success: false, error: error instanceof Error ? error.message : '导出失败' }
  }
}

/** 在系统文件管理器中打开文件所在目录 */
export async function openFileInSystem(filePath: string): Promise<void> {
  try {
    await App.OpenFileInSystem(filePath)
  } catch (error) {
    console.error('[NetworkExport] 打开文件失败:', error)
  }
}

function getExtension(format: ExportFormat): string {
  switch (format) {
    case 'har': return 'har'
    case 'json': return 'json'
    case 'csv': return 'csv'
  }
}
