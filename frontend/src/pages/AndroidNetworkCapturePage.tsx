import React, { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { Smartphone, Play, Square, Trash2, Search, Download, Wand2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { captureEvent } from '@/lib/posthog'
import { useDeviceStore } from '@/store/deviceStore'
import { useNetworkCaptureStore, useDeviceCaptureState } from '@/store/networkCaptureStore'
import { useAndroidCaptureStore, useAndroidCaptureSession } from '@/store/androidCaptureStore'
import { useMockStore } from '@/store/mockStore'
import { ProcessSelect, type ProcessSelectHandle } from '@/components/android/ProcessSelect'
import { NetworkRequestTable } from '@/components/network/NetworkRequestTable'
import { NetworkRequestDetail } from '@/components/network/NetworkRequestDetail'
import { ExportNetworkDialog } from '@/components/dialogs/ExportNetworkDialog'
import { MockConfigDialog } from '@/components/dialogs/MockConfigDialog'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { networkCaptureAPI } from '@/lib/hdc-api/network-capture'
import { getNetworkRequestKey } from '@/lib/network-request-key'
import type { NetworkRequest, AndroidCaptureStatus, AndroidApp, MockConfig, MockRule } from '@/types/hdc'

export function AndroidNetworkCapturePage(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()
  const {
    initializeDevice,
    syncStatus,
    startCaptureListeners,
    stopCapture: storeStopCapture,
    setSelectedRequest: storeSetSelectedRequest,
    setSearchQuery: storeSetSearchQuery,
    setIsRegexMode: storeSetIsRegexMode,
    setIsFilterMode: storeSetIsFilterMode,
    setAutoScrollEnabled: storeSetAutoScrollEnabled,
    setSearchMatches: storeSetSearchMatches,
    setRequests: storeSetRequests,
  } = useNetworkCaptureStore()

  const [leftPanelWidth, setLeftPanelWidth] = useState(45)
  const [isResizing, setIsResizing] = useState(false)
  const processSelectRef = useRef<ProcessSelectHandle>(null)
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const [mockConfigDialogOpen, setMockConfigDialogOpen] = useState(false)
  const [mockConfigDraft, setMockConfigDraft] = useState<MockConfig | null>(null)
  const [mockInitialTestUrl, setMockInitialTestUrl] = useState('')
  const { config: mockConfig, setConfig: setMockConfig } = useMockStore()

  // 记住上次抓包的应用（停止后保留，再次开始时可自动恢复 PID）
  const lastCapturedAppRef = useRef<AndroidApp | null>(null)

  // 导出勾选状态（始终展示）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [singleExportRequest, setSingleExportRequest] = useState<NetworkRequest | null>(null)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  const deviceId = selectedDevice?.connectKey || null
  const deviceState = useDeviceCaptureState(deviceId)
  const androidCaptureSession = useAndroidCaptureSession(deviceId)
  const {
    initializeSession: initializeAndroidCaptureSession,
    setSelectedApp: storeSetSelectedApp,
    setCaptureStatus: storeSetCaptureStatus
  } = useAndroidCaptureStore()
  const selectedApp = androidCaptureSession?.selectedApp || null
  const captureStatus = androidCaptureSession?.captureStatus || {
    isCapturing: false,
    packageName: '',
    processName: ''
  }

  const setSelectedApp = useCallback((app: AndroidApp | null | ((current: AndroidApp | null) => AndroidApp | null)) => {
    if (deviceId) storeSetSelectedApp(deviceId, app)
  }, [deviceId, storeSetSelectedApp])

  const setCaptureStatus = useCallback((status: AndroidCaptureStatus | ((current: AndroidCaptureStatus) => AndroidCaptureStatus)) => {
    if (deviceId) storeSetCaptureStatus(deviceId, status)
  }, [deviceId, storeSetCaptureStatus])

  const requests = deviceState?.requests || []
  const selectedRequest = deviceState?.selectedRequest || null
  const searchQuery = deviceState?.searchQuery || ''
  const isRegexMode = deviceState?.isRegexMode || false
  const isFilterMode = deviceState?.isFilterMode || false
  const autoScrollEnabled = deviceState?.autoScrollEnabled ?? true
  const searchMatches = deviceState?.searchMatches || new Map()
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery)

  const setSearchQuery = useCallback((query: string) => {
    if (deviceId) storeSetSearchQuery(deviceId, query)
  }, [deviceId, storeSetSearchQuery])

  const setIsRegexMode = useCallback((isRegex: boolean) => {
    if (deviceId) storeSetIsRegexMode(deviceId, isRegex)
  }, [deviceId, storeSetIsRegexMode])

  const setIsFilterMode = useCallback((isFilter: boolean) => {
    if (deviceId) storeSetIsFilterMode(deviceId, isFilter)
  }, [deviceId, storeSetIsFilterMode])

  const setSelectedRequest = useCallback((request: NetworkRequest | null) => {
    if (deviceId) storeSetSelectedRequest(deviceId, request)
  }, [deviceId, storeSetSelectedRequest])

  const setAutoScrollEnabled = useCallback((enabled: boolean) => {
    if (deviceId) storeSetAutoScrollEnabled(deviceId, enabled)
  }, [deviceId, storeSetAutoScrollEnabled])

  // 生成请求唯一 Key（与 NetworkRequestTable 中的 getRequestKey 保持一致）
  const getRequestKey = useCallback((request: NetworkRequest): string => {
    return getNetworkRequestKey(request)
  }, [])

  // 已选中的请求列表
  const selectedRequests = requests.filter((r) => selectedIds.has(getRequestKey(r)))
  const exportRequests = singleExportRequest ? [singleExportRequest] : selectedRequests

  // 切换单个请求选中状态
  const handleToggleSelect = useCallback((request: NetworkRequest) => {
    const key = getRequestKey(request)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [getRequestKey])

  // 全选/取消全选（仅对当前过滤后的可见请求）
  const handleToggleSelectAll = useCallback(() => {
    // 计算过滤后的可见请求（复用与 NetworkRequestTable 相同的过滤逻辑）
    const boundaryMarkers = requests.filter((r) => r.isSessionBoundary)
    const normalRequests = requests.filter((r) => !r.isSessionBoundary)

    const filteredRequests = isFilterMode && searchQuery.trim()
      ? normalRequests.filter((r) => {
          const requestKey = getRequestKey(r)
          return searchMatches.has(requestKey)
        })
      : normalRequests

    const visibleRequests = [...boundaryMarkers, ...filteredRequests].sort((a, b) => a.timestamp - b.timestamp)
      .filter((r) => !r.isSessionBoundary)

    const allSelected = visibleRequests.every((r) => selectedIds.has(getRequestKey(r)))

    setSelectedIds((prev) => {
      const next = new Set(allSelected ? [] : prev)
      for (const r of visibleRequests) {
        const key = getRequestKey(r)
        if (allSelected) {
          next.delete(key)
        } else {
          next.add(key)
        }
      }
      return next
    })
  }, [requests, isFilterMode, searchQuery, searchMatches, selectedIds, getRequestKey])

  // 点击导出按钮 → 始终打开弹窗
  const handleExportClick = useCallback(() => {
    setSingleExportRequest(null)
    setExportDialogOpen(true)
  }, [])

  const handleExportSingleRequest = useCallback((request: NetworkRequest): void => {
    setSelectedRequest(request)
    setSingleExportRequest(request)
    setExportDialogOpen(true)
  }, [setSelectedRequest])

  const handleDeleteSingleRequest = useCallback((request: NetworkRequest): void => {
    if (!deviceId) return

    const key = getRequestKey(request)
    const remaining = requests.filter((r) => getRequestKey(r) !== key)
    storeSetRequests(deviceId, remaining)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    if (selectedRequest && getRequestKey(selectedRequest) === key) {
      storeSetSelectedRequest(deviceId, null)
    }
    toast.success('已删除该请求')
  }, [deviceId, getRequestKey, requests, selectedRequest, storeSetRequests, storeSetSelectedRequest])

  const prettyJsonOrOriginal = useCallback((value?: string): string => {
    if (!value) return ''
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }, [])

  const buildMockRuleFromRequest = useCallback((request: NetworkRequest): MockRule => {
    const fullUrl = request.fullUrl || request.url || ''
    let pathOnly = fullUrl || '请求'
    let urlPattern = fullUrl
    try {
      const parsedUrl = new URL(fullUrl)
      pathOnly = parsedUrl.pathname || '/'
      const firstQueryPart = parsedUrl.search ? parsedUrl.search.slice(1).split('&')[0] : ''
      if (pathOnly === '/' && firstQueryPart) {
        pathOnly = `/?${firstQueryPart}`
      }
      const auth = parsedUrl.username
        ? `${parsedUrl.username}${parsedUrl.password ? `:${parsedUrl.password}` : ''}@`
        : ''
      urlPattern = `${parsedUrl.protocol}//${auth}${parsedUrl.host}${pathOnly}`
    } catch {
      // Keep the original URL-like value as the label when URL parsing fails.
    }

    return {
      id: `mock-rule-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      name: pathOnly,
      enabled: true,
      matchCondition: {
        urlPattern,
        urlRegex: false
      },
      responseMode: 'replace',
      responseConfig: {
        statusCode: request.statusCode || 200,
        headers: request.responseHeaders || { 'Content-Type': 'application/json; charset=utf-8' },
        body: prettyJsonOrOriginal(request.responseBody),
        replaceRules: []
      }
    }
  }, [prettyJsonOrOriginal])

  const handleMockSingleRequest = useCallback((request: NetworkRequest): void => {
    setSelectedRequest(request)
    const newRule = buildMockRuleFromRequest(request)
    setMockInitialTestUrl(request.fullUrl || request.url || '')
    setMockConfigDraft({
      ...mockConfig,
      enabled: true,
      rules: [...mockConfig.rules, newRule]
    })
    captureEvent('android mock rule generated from request')
    setMockConfigDialogOpen(true)
  }, [buildMockRuleFromRequest, mockConfig, setSelectedRequest])

  // 初始化设备状态
  useEffect(() => {
    if (deviceId) {
      initializeDevice(deviceId)
      syncStatus(deviceId).catch(console.error)
      initializeAndroidCaptureSession(deviceId)
    }
  }, [deviceId, initializeDevice, initializeAndroidCaptureSession, syncStatus])

  // 菜单切回本页时，以后台真实会话校准已缓存的状态，处理离页期间进程重启等情况。
  useEffect(() => {
    if (!deviceId || !captureStatus.packageName) return

    let cancelled = false
    void networkCaptureAPI.GetAndroidCaptureStatus(deviceId, captureStatus.packageName).then((status) => {
      if (cancelled) return

      const nextStatus: AndroidCaptureStatus = {
        isCapturing: Boolean(status.isCapturing),
        waitingForRestart: Boolean(status.waitingForRestart),
        packageName: status.packageName || captureStatus.packageName,
        processName: status.processName || captureStatus.processName,
        pid: Number(status.pid || 0),
        localPort: Number(status.localPort || 0),
        connectedCount: Number(status.connectedCount || 0)
      }
      setCaptureStatus(nextStatus)

      if (nextStatus.isCapturing || nextStatus.waitingForRestart) {
        setSelectedApp((current) => current ? {
          ...current,
          packageName: nextStatus.packageName,
          processName: nextStatus.processName || current.processName,
          pid: nextStatus.pid || current.pid
        } : {
          name: nextStatus.processName || nextStatus.packageName,
          packageName: nextStatus.packageName,
          processName: nextStatus.processName || nextStatus.packageName,
          pid: nextStatus.pid || 0,
          debuggable: true
        })
        startCaptureListeners(deviceId)
      }
    })

    return () => {
      cancelled = true
    }
  }, [captureStatus.packageName, deviceId, setCaptureStatus, setSelectedApp, startCaptureListeners])

  useEffect(() => {
    if (!deviceId) return

    const waitingToastId = `android-process-waiting-${deviceId}`
    const restartToastId = `android-process-restart-${deviceId}`
    const unsubscribeExited = networkCaptureAPI.onAndroidProcessExited((data) => {
      if (data.deviceId !== deviceId) return
      setCaptureStatus((current) => {
        if (current.packageName && current.packageName !== data.packageName) return current
        return {
          ...current,
          isCapturing: false,
          waitingForRestart: true,
          packageName: data.packageName,
          processName: data.processName || current.processName,
          pid: 0,
          connectedCount: 0
        }
      })
      toast.loading('目标进程已退出，正在等待重新启动', { id: waitingToastId })
    })
    const unsubscribeRestarting = networkCaptureAPI.onAndroidProcessRestarting((data) => {
      if (data.deviceId !== deviceId) return
      toast.dismiss(waitingToastId)
      toast.loading(`检测到进程重启：${data.oldPid} → ${data.newPid}，正在恢复抓包`, { id: restartToastId })
    })
    const unsubscribeRestarted = networkCaptureAPI.onAndroidProcessRestarted((data) => {
      if (data.deviceId !== deviceId) return
      setCaptureStatus((current) => ({
        ...current,
        isCapturing: true,
        waitingForRestart: false,
        packageName: data.packageName,
        processName: data.processName || current.processName,
        pid: data.newPid
      }))
      setSelectedApp((current) => current ? { ...current, pid: data.newPid } : current)
      if (lastCapturedAppRef.current) {
        lastCapturedAppRef.current = { ...lastCapturedAppRef.current, pid: data.newPid }
      }
      toast.dismiss(waitingToastId)
      toast.success('进程已重启，抓包已自动恢复', { id: restartToastId })
    })
    const unsubscribeRestartFailed = networkCaptureAPI.onAndroidProcessRestartFailed((data) => {
      if (data.deviceId !== deviceId) return
      setCaptureStatus((current) => ({ ...current, isCapturing: false, waitingForRestart: true }))
      toast.error(`自动恢复抓包失败：${data.error}，将继续重试`, { id: restartToastId })
    })

    return () => {
      unsubscribeExited()
      unsubscribeRestarting()
      unsubscribeRestarted()
      unsubscribeRestartFailed()
      toast.dismiss(waitingToastId)
      toast.dismiss(restartToastId)
    }
  }, [deviceId])

  // 拖拽调整面板宽度
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      if (!isResizing) return
      const container = document.getElementById('android-capture-container')
      if (!container) return
      const containerRect = container.getBoundingClientRect()
      const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100
      setLeftPanelWidth(Math.max(20, Math.min(80, newLeftWidth)))
    }
    const handleMouseUp = (): void => setIsResizing(false)

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  // 搜索匹配函数
  const performSearch = useCallback((query: string, regexMode: boolean, reqs: NetworkRequest[]): void => {
    if (!deviceId) return

    if (!query.trim()) {
      storeSetSearchMatches(deviceId, new Map())
      return
    }

    const matches = new Map<string, {
      urlMatch: boolean
      requestBodyMatch: boolean
      responseBodyMatch: boolean
      requestHeadersMatch: boolean
      requestParamsMatch: boolean
      matches: Array<{ start: number; end: number; text: string }>
    }>()

    const createRegex = (): RegExp | null => {
      if (!regexMode) return null
      try { return new RegExp(query, 'gi') } catch { return null }
    }

    const findAllMatches = (text: string, regex: RegExp | null): Array<{ start: number; end: number; text: string }> => {
      const result: Array<{ start: number; end: number; text: string }> = []
      if (!regex) return result
      regex.lastIndex = 0
      let match
      while ((match = regex.exec(text)) !== null) {
        result.push({ start: match.index, end: match.index + match[0].length, text: match[0] })
      }
      return result
    }

    for (const request of reqs) {
      const requestKey = getNetworkRequestKey(request)

      const result = { urlMatch: false, requestBodyMatch: false, responseBodyMatch: false, requestHeadersMatch: false, requestParamsMatch: false, matches: [] as Array<{ start: number; end: number; text: string }> }

      const url = request.fullUrl || request.url || ''
      if (regexMode) {
        const urlRegex = createRegex()
        if (urlRegex) {
          const urlMatches = findAllMatches(url, urlRegex)
          if (urlMatches.length > 0) { result.urlMatch = true; result.matches.push(...urlMatches) }
        }
      } else {
        const index = url.toLowerCase().indexOf(query.toLowerCase())
        if (index !== -1) { result.urlMatch = true; result.matches.push({ start: index, end: index + query.length, text: query }) }
      }

      if (request.requestBody) {
        if (regexMode) {
          const bodyRegex = createRegex()
          if (bodyRegex) {
            const bodyMatches = findAllMatches(request.requestBody, bodyRegex)
            if (bodyMatches.length > 0) { result.requestBodyMatch = true; result.matches.push(...bodyMatches) }
          }
        } else {
          const index = request.requestBody.toLowerCase().indexOf(query.toLowerCase())
          if (index !== -1) { result.requestBodyMatch = true; result.matches.push({ start: index, end: index + query.length, text: query }) }
        }
      }

      if (request.responseBody) {
        if (regexMode) {
          const bodyRegex = createRegex()
          if (bodyRegex) {
            const bodyMatches = findAllMatches(request.responseBody, bodyRegex)
            if (bodyMatches.length > 0) { result.responseBodyMatch = true; result.matches.push(...bodyMatches) }
          }
        } else {
          const index = request.responseBody.toLowerCase().indexOf(query.toLowerCase())
          if (index !== -1) { result.responseBodyMatch = true; result.matches.push({ start: index, end: index + query.length, text: query }) }
        }
      }

      // 搜索 request-headers
      if (request.requestHeaders) {
        const headersText = Object.entries(request.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')
        if (regexMode) {
          const headersRegex = createRegex()
          if (headersRegex) {
            const headersMatches = findAllMatches(headersText, headersRegex)
            if (headersMatches.length > 0) { result.requestHeadersMatch = true; result.matches.push(...headersMatches) }
          }
        } else {
          const index = headersText.toLowerCase().indexOf(query.toLowerCase())
          if (index !== -1) { result.requestHeadersMatch = true; result.matches.push({ start: index, end: index + query.length, text: query }) }
        }
      }

      // 搜索 request-params
      if (request.requestParams) {
        const paramsText = Object.entries(request.requestParams).map(([k, v]) => `${k}: ${v}`).join('\n')
        if (regexMode) {
          const paramsRegex = createRegex()
          if (paramsRegex) {
            const paramsMatches = findAllMatches(paramsText, paramsRegex)
            if (paramsMatches.length > 0) { result.requestParamsMatch = true; result.matches.push(...paramsMatches) }
          }
        } else {
          const index = paramsText.toLowerCase().indexOf(query.toLowerCase())
          if (index !== -1) { result.requestParamsMatch = true; result.matches.push({ start: index, end: index + query.length, text: query }) }
        }
      }

      if (result.urlMatch || result.requestBodyMatch || result.responseBodyMatch || result.requestHeadersMatch || result.requestParamsMatch) {
        matches.set(requestKey, result)
      }
    }

    storeSetSearchMatches(deviceId, matches)
  }, [deviceId, storeSetSearchMatches])

  // 仅对输入变化做防抖；请求列表更新时继续使用已稳定的关键词实时匹配。
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 1500)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [searchQuery])

  useEffect(() => {
    performSearch(debouncedSearchQuery, isRegexMode, requests)
  }, [debouncedSearchQuery, isRegexMode, requests, performSearch])

  const pushAndroidMockConfigWithRetry = useCallback(async (packageName: string): Promise<void> => {
    if (!deviceId) return
    const payload = JSON.stringify(mockConfig)
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await networkCaptureAPI.PushAndroidMockConfigToClient(deviceId, packageName, payload)
        return
      } catch (error) {
        if (attempt === 5) {
          console.warn('[AndroidNetworkCapturePage] Android mock config push failed:', error)
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
      }
    }
  }, [deviceId, mockConfig])

  // 开始抓包（用快速 PID 查询替代慢速进程列表刷新，避免漏掉 App 启动初期的请求）
  const handleStartCapture = useCallback(async (app?: AndroidApp): Promise<void> => {
    if (!deviceId) {
      toast.warning('请先选择设备')
      return
    }

    // 确定目标应用：优先用传入的 app → 当前选中的 app → 上次抓包的应用
    const preferredApp = app || selectedApp || lastCapturedAppRef.current
    if (!preferredApp) {
      toast.warning('请先选择要抓包的应用进程')
      return
    }

    const packageName = preferredApp.packageName
    const port = 6200

    // 快速查询当前有效 PID（单次 adb pidof，毫秒级）
    // 替代慢速的 fetchApps（adb jdwp + 逐个 cmdline + dumpsys），避免 App 重启后漏请求
    const freshPid = await networkCaptureAPI.GetAndroidPidByPackageName(
      deviceId,
      preferredApp.processName || packageName
    )
    if (freshPid <= 0) {
      toast.warning(`进程「${preferredApp.name || packageName}」未在运行，请重新选择`)
      return
    }

    // 用最新 PID 构造 targetApp（保留 preferredApp 的应用名等信息）
    const targetApp: AndroidApp = { ...preferredApp, pid: freshPid }
    if (freshPid !== preferredApp.pid) {
      setSelectedApp(targetApp)
      toast.info(`进程 PID 已更新: ${preferredApp.pid} → ${freshPid}`)
    }

    if (captureStatus.waitingForRestart) {
      await networkCaptureAPI.StopAndroidNetworkCapture(deviceId, packageName).catch(() => {})
      setCaptureStatus((current) => ({ ...current, waitingForRestart: false }))
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    const restoreToastId = `android-agent-restore-${deviceId}-${targetApp.pid}`
    const startCapture = async (): Promise<boolean> => {
      let restoringLoadedAgent = false
      const unsubscribeRestore = networkCaptureAPI.onAndroidAgentRestoreStarted((data) => {
        if (data.deviceId !== deviceId || data.packageName !== targetApp.packageName || data.pid !== targetApp.pid) return
        restoringLoadedAgent = true
        toast.loading('当前进程已被抓取过，尝试恢复上次连接', { id: restoreToastId })
      })

      try {
        await networkCaptureAPI.StartAndroidNetworkCapture(deviceId, targetApp.packageName, targetApp.pid, port)
        return restoringLoadedAgent
      } finally {
        unsubscribeRestore()
      }
    }

    try {
      const restoringLoadedAgent = await startCapture()
      startCaptureListeners(deviceId)
      lastCapturedAppRef.current = targetApp
      setCaptureStatus({
        isCapturing: true,
        packageName: targetApp.packageName,
        processName: targetApp.processName || targetApp.packageName,
        pid: targetApp.pid,
        localPort: port,
        connectedCount: 0
      })
      if (restoringLoadedAgent) {
        toast.success('已恢复上次抓包连接', { id: restoreToastId })
      } else {
        toast.success(`开始抓包: ${targetApp.name || targetApp.processName || targetApp.packageName}`)
      }
      captureEvent('android capture started', { package_name: targetApp.packageName })
      void pushAndroidMockConfigWithRetry(targetApp.packageName)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      if (errMsg.includes('恢复抓取失败')) {
        toast.error('恢复抓取失败，请重启目标APP再次抓包', { id: restoreToastId })
        return
      }
      // 遇到 "capture already running" → 自动清理残留会话后重试一次
      if (errMsg.includes('already running')) {
        const cleanToast = toast.loading('检测到残留抓包会话，正在清理后重试...')
        try {
          await networkCaptureAPI.StopAndroidNetworkCapture(deviceId, targetApp.packageName).catch(() => {})
          await networkCaptureAPI.StopAllAndroidCaptures(deviceId)
          await new Promise(resolve => setTimeout(resolve, 500))
          const restoringLoadedAgent = await startCapture()
          startCaptureListeners(deviceId)
          lastCapturedAppRef.current = targetApp
          setCaptureStatus({
            isCapturing: true,
            packageName: targetApp.packageName,
            processName: targetApp.processName || targetApp.packageName,
            pid: targetApp.pid,
            localPort: port,
            connectedCount: 0
          })
          if (restoringLoadedAgent) {
            toast.success('已恢复上次抓包连接', { id: restoreToastId })
            toast.dismiss(cleanToast)
          } else {
            toast.success(`已清理残留并开始抓包: ${targetApp.name || targetApp.processName || targetApp.packageName}`, { id: cleanToast })
          }
          captureEvent('android capture started after cleanup', { package_name: targetApp.packageName })
          void pushAndroidMockConfigWithRetry(targetApp.packageName)
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError)
          if (retryMessage.includes('恢复抓取失败')) {
            toast.error('恢复抓取失败，请重启目标APP再次抓包', { id: restoreToastId })
            toast.dismiss(cleanToast)
          } else {
            toast.error(`启动抓包失败: ${retryMessage || '未知错误'}`, { id: cleanToast })
          }
        }
        return
      }
      toast.error(`启动抓包失败: ${errMsg}`)
    }
  }, [captureStatus.waitingForRestart, deviceId, pushAndroidMockConfigWithRetry, selectedApp, startCaptureListeners])

  // 统一停止入口：精准停止后再按设备兜底清理，确保后台监控、监听器和端口转发全部释放。
  const handleStopCapture = useCallback(async (): Promise<void> => {
    if (!deviceId) return

    const packageName = captureStatus.packageName
    const wasWaitingForRestart = captureStatus.waitingForRestart
    try {
      if (packageName) {
        await networkCaptureAPI.StopAndroidNetworkCapture(deviceId, packageName).catch(() => {})
      }
      const stoppedCount = await networkCaptureAPI.StopAllAndroidCaptures(deviceId)
      await storeStopCapture(deviceId).catch((error) => {
        console.warn('[AndroidNetworkCapturePage] Failed to clear shared capture state:', error)
      })
      lastCapturedAppRef.current = null
      setCaptureStatus({ isCapturing: false, packageName: '', processName: '' })
      toast.success(wasWaitingForRestart
        ? '已停止等待进程重启'
        : stoppedCount > 0 ? `已停止并清理 ${stoppedCount} 个抓包会话` : '已停止抓包')
      captureEvent('android capture stopped', { package_name: packageName })
    } catch (error) {
      toast.error(`停止抓包失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [captureStatus.packageName, captureStatus.waitingForRestart, deviceId, storeStopCapture])

  const handleMockConfigChange = useCallback((config: typeof mockConfig): void => {
    setMockConfig(config)
    setMockConfigDraft(null)
    setMockInitialTestUrl('')
    if (!deviceId || !captureStatus.isCapturing || !captureStatus.packageName) return

    networkCaptureAPI.PushAndroidMockConfigToClient(deviceId, captureStatus.packageName, JSON.stringify(config))
      .then(() => toast.success('Android Mock 配置已推送'))
      .catch((error) => {
        toast.error(`Android Mock 配置推送失败: ${error instanceof Error ? error.message : '未知错误'}`)
      })
  }, [captureStatus.isCapturing, captureStatus.packageName, deviceId, setMockConfig])

  const handleMockDialogOpenChange = useCallback((open: boolean): void => {
    setMockConfigDialogOpen(open)
    if (!open) {
      setMockConfigDraft(null)
      setMockInitialTestUrl('')
    }
  }, [])

  const handleExportDialogOpenChange = useCallback((open: boolean): void => {
    setExportDialogOpen(open)
    if (!open) {
      setSingleExportRequest(null)
    }
  }, [])

  // 删除：清空已选请求
  const handleClearRequests = useCallback((): void => {
    if (!deviceId) return

    if (selectedIds.size === 0) {
      toast.warning('请先在左侧请求列表前勾选想要删除的项')
      return
    }

    captureEvent('android capture cleared')
    const remaining = requests.filter((r) => !selectedIds.has(getRequestKey(r)))
    storeSetRequests(deviceId, remaining)
    setSelectedIds(new Set())
    storeSetSelectedRequest(deviceId, null)
  }, [deviceId, selectedIds, requests, getRequestKey, storeSetRequests, storeSetSelectedRequest])

  // 未选择设备或非安卓设备时的提示
  if (!selectedDevice || selectedDevice.platform !== 'android') {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Smartphone className="h-6 w-6 text-primary" />
            安卓抓包
            <WindowToggleButton />
            <HelpToggleButton />
          </h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Smartphone className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg">请先选择 Android 设备</p>
            <p className="text-sm mt-2">在右上角的设备选择器中选择已连接的 Android 设备</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full flex flex-col overflow-hidden">
      {/* 标题栏 + 工具栏 */}
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Smartphone className="h-6 w-6 text-primary" />
          安卓抓包
          <WindowToggleButton />
          <HelpToggleButton />
        </h1>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 搜索组件 */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
            <Input
              type="text"
              placeholder="搜索 URL、请求体、响应体..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-40 w-[360px] h-9"
            />
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-2 pointer-events-none">
              <div className="flex items-center gap-1 pointer-events-auto">
                <Checkbox
                  id="android-regex-mode"
                  checked={isRegexMode}
                  onCheckedChange={(checked) => setIsRegexMode(checked === true)}
                  className="h-4 w-4"
                />
                <label
                  htmlFor="android-regex-mode"
                  className="text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap"
                >
                  正则
                </label>
              </div>
              <div className="flex items-center gap-1 pointer-events-auto">
                <Checkbox
                  id="android-filter-mode"
                  checked={isFilterMode}
                  onCheckedChange={(checked) => setIsFilterMode(checked === true)}
                  className="h-4 w-4"
                />
                <label
                  htmlFor="android-filter-mode"
                  className="text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap"
                >
                  过滤
                </label>
              </div>
            </div>
          </div>

          {/* 进程选择 */}
          <ProcessSelect
            ref={processSelectRef}
            deviceId={deviceId}
            value={selectedApp}
            onChange={setSelectedApp}
            disabled={captureStatus.isCapturing || captureStatus.waitingForRestart}
          />

          {/* Mock 配置 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              captureEvent('android mock config opened')
              setMockConfigDraft(null)
              setMockInitialTestUrl('')
              setMockConfigDialogOpen(true)
            }}
            className="gap-2"
          >
            <Wand2 className="h-4 w-4" />
            <span>Mock</span>
          </Button>

          {/* 开始/停止抓包 */}
          {captureStatus.isCapturing || captureStatus.waitingForRestart ? (
            <Button variant="destructive" size="sm" onClick={handleStopCapture} className="gap-2">
              <Square className="h-4 w-4" />
              <span>{captureStatus.waitingForRestart ? '停止等待' : '停止抓包'}</span>
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => handleStartCapture()}
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              <span>开始抓包</span>
            </Button>
          )}

          {/* 删除（清空请求） */}
          <Button variant="outline" size="sm" onClick={handleClearRequests} className="gap-2" title="清空请求列表">
            <Trash2 className="h-4 w-4" />
          </Button>

          {/* 导出按钮 — 始终可点击 */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportClick}
            className="gap-1.5"
            title="导出网络请求"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 主内容区 */}
      <div id="android-capture-container" className="flex-1 flex min-h-0 relative gap-1">
        <Card className="min-w-0 flex flex-col" style={{ width: `${leftPanelWidth}%` }}>
          <NetworkRequestTable
            requests={requests}
            selectedRequest={selectedRequest}
            onSelectRequest={setSelectedRequest}
            searchQuery={searchQuery}
            searchMatches={searchMatches}
            isFilterMode={isFilterMode}
            isRegexMode={isRegexMode}
            autoScrollEnabled={autoScrollEnabled}
            setAutoScrollEnabled={setAutoScrollEnabled}
            showExportCheckboxes
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            onExportRequest={handleExportSingleRequest}
            onDeleteRequest={handleDeleteSingleRequest}
            onMockRequest={handleMockSingleRequest}
          />
        </Card>

        <div
          className="w-2 cursor-col-resize flex-shrink-0 z-10 hover:bg-primary/20 transition-colors"
          onMouseDown={() => setIsResizing(true)}
        />

        <Card className="min-w-0 flex flex-col flex-1 overflow-hidden">
          <NetworkRequestDetail
            request={selectedRequest}
            searchQuery={searchQuery}
            searchMatches={searchMatches}
            isRegexMode={isRegexMode}
          />
        </Card>
      </div>

      {/* 底部状态栏 */}
      <div className="mt-4 flex-shrink-0 flex items-center gap-4 text-xs text-muted-foreground">
        <span>请求数: <span className="font-mono">{requests.length}</span></span>
        {(captureStatus.isCapturing || captureStatus.waitingForRestart) && captureStatus.packageName && (
          <>
            <span>|</span>
            <span>进程: <span className="font-mono">{captureStatus.processName || captureStatus.packageName}</span></span>
            <span>PID: <span className="font-mono">{captureStatus.pid}</span></span>
            {captureStatus.waitingForRestart && <span className="text-amber-500">等待进程重启</span>}
          </>
        )}
        {selectedIds.size > 0 && (
          <>
            <span>|</span>
            <span>已选: <span className="font-mono">{selectedIds.size}</span> 个</span>
          </>
        )}
      </div>

      {/* 导出配置弹窗 */}
      <ExportNetworkDialog
        open={exportDialogOpen}
        onOpenChange={handleExportDialogOpenChange}
        selectedRequests={exportRequests}
        platform="android"
        processName={captureStatus.processName || selectedApp?.processName || selectedApp?.packageName || 'process'}
      />

      <MockConfigDialog
        open={mockConfigDialogOpen}
        onOpenChange={handleMockDialogOpenChange}
        config={mockConfigDraft || mockConfig}
        onConfigChange={handleMockConfigChange}
        initialTestUrl={mockInitialTestUrl}
      />
    </div>
  )
}
