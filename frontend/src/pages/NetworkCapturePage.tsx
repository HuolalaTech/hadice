import React, { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import {
  Globe,
  Play,
  Square,
  Loader2,
  Download,
  Trash2,
  Search,
  Wand2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDeviceStore } from '@/store/deviceStore'
import { captureEvent } from '@/lib/posthog'
import { useNetworkCaptureStore, useDeviceCaptureState } from '@/store/networkCaptureStore'
import { useMockStore } from '@/store/mockStore'
import { PortForwardDialog } from '@/components/dialogs/PortForwardDialog'
import { MockConfigDialog } from '@/components/dialogs/MockConfigDialog'
import { ExportNetworkDialog } from '@/components/dialogs/ExportNetworkDialog'
import { NetworkRequestTable } from '@/components/network/NetworkRequestTable'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { NoDeviceState } from '@/components/layout/NoDeviceState'
import { NetworkRequestDetail } from '@/components/network/NetworkRequestDetail'
import { HarmonyProcessSelect } from '@/components/hiprofiler/HarmonyProcessSelect'
import { getNetworkRequestKey } from '@/lib/network-request-key'
import { buildNetworkRequestUrl, escapeRegexLiteral } from '@/lib/network-url'
import type {
  NetworkRequest,
  PortForwardStatus,
  CaptureStatus,
  ClientHeartbeatInfo,
  HarmonyDebuggableApp,
  HiProfilerCaptureStatus,
  MockConfig,
  MockRule
} from '@/types/hdc'
import { networkCaptureAPI } from '@/lib/hdc-api/network-capture'

  /**
   * 格式化运行时间
   */
  function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    const h = hours.toString().padStart(2, '0')
    const m = (minutes % 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')

    return `${h}:${m}:${s}`
  }

/**
 * 网络请求页面
 */
export function NetworkCapturePage(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()
  const {
    initializeDevice,
    syncStatus,
    startCaptureListeners,
    stopCapture: storeStopCapture,
    setRequests: storeSetRequests,
    setSearchQuery: storeSetSearchQuery,
    setIsRegexMode: storeSetIsRegexMode,
    setIsFilterMode: storeSetIsFilterMode,
    setAutoScrollEnabled: storeSetAutoScrollEnabled,
    setSearchMatches: storeSetSearchMatches,
    setSelectedRequest: storeSetSelectedRequest
  } = useNetworkCaptureStore()

  // 使用 selector hook 响应式订阅设备状态
  const deviceState = useDeviceCaptureState(selectedDevice?.connectKey || null)

  const [portForwardDialogOpen, setPortForwardDialogOpen] = useState(false)
  const [mockConfigDialogOpen, setMockConfigDialogOpen] = useState(false)
  const [mockConfigDraft, setMockConfigDraft] = useState<MockConfig | null>(null)
  const [mockInitialTestUrl, setMockInitialTestUrl] = useState('')
  const [localPort, setLocalPort] = useState(6100)
  const [devicePort, setDevicePort] = useState(35201)
  const [leftPanelWidth, setLeftPanelWidth] = useState(45) // 左侧面板宽度百分比，默认45:55
  const [isResizing, setIsResizing] = useState(false)
  const [captureMode, setCaptureMode] = useState<'sophon' | 'hiprofiler'>('hiprofiler')
  const [selectedHiProfilerApp, setSelectedHiProfilerApp] = useState<HarmonyDebuggableApp | null>(null)
  const [hiProfilerStatus, setHiProfilerStatus] = useState<HiProfilerCaptureStatus>({
    state: 'idle',
    isCapturing: false
  })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [singleExportRequest, setSingleExportRequest] = useState<NetworkRequest | null>(null)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  
  // Mock 配置
  const { config: mockConfig, setConfig: setMockConfig } = useMockStore()

  // 从 store 获取搜索和选中状态
  const searchQuery = deviceState?.searchQuery || ''
  const isRegexMode = deviceState?.isRegexMode || false
  const isFilterMode = deviceState?.isFilterMode || false
  const autoScrollEnabled = deviceState?.autoScrollEnabled ?? true
  const searchMatches = deviceState?.searchMatches || new Map()
  const selectedRequest = deviceState?.selectedRequest || null
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery)

  // 设置搜索状态的包装函数
  const setSearchQuery = useCallback((query: string) => {
    if (selectedDevice) {
      storeSetSearchQuery(selectedDevice.connectKey, query)
    }
  }, [selectedDevice, storeSetSearchQuery])

  const setIsRegexMode = useCallback((isRegex: boolean) => {
    if (selectedDevice) {
      storeSetIsRegexMode(selectedDevice.connectKey, isRegex)
    }
  }, [selectedDevice, storeSetIsRegexMode])

  const setIsFilterMode = useCallback((isFilter: boolean) => {
    if (selectedDevice) {
      storeSetIsFilterMode(selectedDevice.connectKey, isFilter)
    }
  }, [selectedDevice, storeSetIsFilterMode])

  const setAutoScrollEnabled = useCallback((enabled: boolean) => {
    if (selectedDevice) {
      storeSetAutoScrollEnabled(selectedDevice.connectKey, enabled)
    }
  }, [selectedDevice, storeSetAutoScrollEnabled])

  const setSelectedRequest = useCallback((request: NetworkRequest | null) => {
    if (selectedDevice) {
      storeSetSelectedRequest(selectedDevice.connectKey, request)
    }
  }, [selectedDevice, storeSetSelectedRequest])

  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const portStatus = deviceState?.portForward || {
    configured: false,
    localPort: 6100,
    devicePort: 35201,
    status: 'not_configured' as const
  }
  const captureStatus: CaptureStatus = {
    isCapturing: deviceState?.isCapturing || false,
    requestCount: deviceState?.requests.length || 0,
    portForward: portStatus
  }
  const requests = deviceState?.requests || []
  const startTime = deviceState?.startTime || null
  const successCount = deviceState?.successCount || 0
  const errorCount = deviceState?.errorCount || 0
  const heartbeatInfo = deviceState?.heartbeatInfo || []
  const isHiProfilerActive = ['starting', 'capturing', 'stopping', 'waiting', 'restarting'].includes(hiProfilerStatus.state)
  const selectedExportRequests = requests.filter(
    (request) => !request.isSessionBoundary && selectedIds.has(getNetworkRequestKey(request))
  )
  const exportRequests = singleExportRequest ? [singleExportRequest] : selectedExportRequests

  /**
   * 获取心跳状态颜色
   */
  const getHeartbeatColor = (status: string): string => {
    switch (status) {
      case 'healthy':
        return 'bg-green-500'
      case 'warning':
        return 'bg-yellow-500'
      case 'timeout':
        return 'bg-red-500'
      default:
        return 'bg-gray-500'
    }
  }

  /**
   * 渲染心跳健康度
   */
  const renderHeartbeatStatus = (): React.ReactNode => {
    if (!heartbeatInfo || heartbeatInfo.length === 0) {
      return null
    }

    return (
      <div className="flex items-center gap-2">
        {heartbeatInfo.map((info, index) => {
          const dotColor = getHeartbeatColor(info.heartbeatStatus)

          return (
            <div key={index} className="flex items-center gap-1">
              <span className="text-muted-foreground">{info.deviceId}:</span>
              <div className={`w-2 h-2 rounded-full ${dotColor}`} title={info.heartbeatStatus} />
            </div>
          )
        })}
      </div>
    )
  }

  // 初始化：初始化设备状态并同步状态
  useEffect(() => {
    if (selectedDevice) {
      initializeDevice(selectedDevice.connectKey)
      syncStatus(selectedDevice.connectKey).catch((error) => {
        console.error('[NetworkCapturePage] 同步状态失败:', error)
      })
    }
  }, [selectedDevice, initializeDevice, syncStatus])

  // HiProfiler 使用独立后端状态，不能复用 Sophon TCP Server 的 isCapturing。
  useEffect(() => {
    if (!selectedDevice) {
      setHiProfilerStatus({ state: 'idle', isCapturing: false })
      return
    }

    const deviceId = selectedDevice.connectKey
    const waitingToastId = `hiprofiler-waiting-${deviceId}`
    const unsubscribe = networkCaptureAPI.onHiProfilerCaptureStateChanged((status) => {
      if (status.deviceId !== deviceId) return
      setHiProfilerStatus(status)

      if (status.processName) {
        setSelectedHiProfilerApp((current) => {
          if (current && current.processName !== status.processName) return current
          return {
            bundleName: status.bundleName || current?.bundleName || status.processName || '',
            appName: current?.appName || status.bundleName || status.processName || '',
            processName: status.processName || current?.processName || '',
            pid: status.state === 'exited' || status.state === 'waiting'
              ? 0
              : (status.pid || current?.pid || 0)
          }
        })
      }

      if (status.state === 'waiting') {
        toast.loading('目标进程已退出，正在等待新 PID 自动恢复抓包', { id: waitingToastId })
      } else if (status.state === 'restarting') {
        toast.loading(`检测到新 PID ${status.pid}，正在自动恢复 HiProfiler 抓包`, { id: waitingToastId })
      } else if (status.state === 'capturing' || status.state === 'idle') {
        toast.dismiss(waitingToastId)
      }
    })

    networkCaptureAPI.GetHiProfilerCaptureStatus(deviceId)
      .then((status) => {
        setHiProfilerStatus(status)
        if (status.processName) {
          setSelectedHiProfilerApp({
            bundleName: status.bundleName || status.processName,
            appName: status.bundleName || status.processName,
            processName: status.processName,
            pid: status.state === 'waiting' ? 0 : (status.pid || 0)
          })
        }
        if (status.isCapturing) {
          startCaptureListeners(deviceId, false)
        }
      })
      .catch(console.error)

    return () => {
      unsubscribe()
      toast.dismiss(waitingToastId)
    }
  }, [selectedDevice, startCaptureListeners])

  // 未抓包时持续跟踪当前选中进程；进程重启后自动刷新 PID 和开始按钮可用状态。
  useEffect(() => {
    if (!selectedDevice || !selectedHiProfilerApp?.processName || isHiProfilerActive) return

    let cancelled = false
    const refreshSelectedProcess = async (): Promise<void> => {
      try {
        const status = await networkCaptureAPI.GetHiProfilerProcessStatus(
          selectedDevice.connectKey,
          selectedHiProfilerApp.processName
        )
        if (cancelled) return
        setSelectedHiProfilerApp((current) => {
          if (!current || current.processName !== selectedHiProfilerApp.processName) return current
          const nextPid = status.alive ? status.pid : 0
          return current.pid === nextPid ? current : { ...current, pid: nextPid }
        })
      } catch (error) {
        console.warn('[NetworkCapturePage] 查询 HiProfiler 进程状态失败:', error)
      }
    }

    void refreshSelectedProcess()
    const interval = setInterval(refreshSelectedProcess, 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [selectedDevice, selectedHiProfilerApp?.processName, isHiProfilerActive])

  // 开始抓包（新架构：Hadice 作为 TCP 服务器）
  const handleStartCapture = useCallback(async () => {
    if (!selectedDevice) {
      return
    }

    try {
      // 检查是否已存在反向端口转发
      let portStatus = await window.hdc.networkCapture.checkReversePortForwardStatus(
        selectedDevice.connectKey,
        localPort,
        devicePort
      )

      // 如果未配置反向端口转发，自动创建
      if (!portStatus.configured) {
        toast.loading('正在创建反向端口转发规则 (rport)...', { id: 'start-capture' })

        try {
          const newStatus = await window.hdc.networkCapture.configurePortForward(
            selectedDevice.connectKey,
            localPort,
            devicePort,
            'Reverse'
          )

          if (newStatus.configured) {
            toast.success(`已创建反向端口转发规则 (设备 ${devicePort} -> 本地 ${localPort})`, { id: 'start-capture' })
            portStatus = newStatus
            // 更新 store 中的端口状态
            const { setPortForward } = useNetworkCaptureStore.getState()
            setPortForward(selectedDevice.connectKey, newStatus)
          } else {
            toast.error(`创建反向端口转发规则失败: ${newStatus.error || '未知错误'}`, { id: 'start-capture' })
            return
          }
        } catch (error) {
          toast.error(`创建反向端口转发规则失败: ${error instanceof Error ? error.message : '未知错误'}`, { id: 'start-capture' })
          return
        }
      }

      toast.loading('正在启动 TCP 服务器并等待设备连接...', { id: 'start-capture' })

      // 启动 TCP 服务器（新架构）
      try {
        const result = await window.hdc.networkCapture.startCaptureServer(
          selectedDevice.connectKey,
          localPort,
          devicePort
        )

        if (result.success) {
          toast.success('TCP 服务器已启动，等待设备连接...', { id: 'start-capture' })

          // 启动事件监听器（在 store 中管理，确保后台继续工作）
          startCaptureListeners(selectedDevice.connectKey)

          // 同步一次状态
          await syncStatus(selectedDevice.connectKey)

          // ✅ 推送Mock配置到Sophon
          try {
            const { pushConfigToClient } = useMockStore.getState()
            await pushConfigToClient(selectedDevice.connectKey)
            console.log('[NetworkCapture] Mock配置已推送到设备')
          } catch (err) {
            console.warn('[NetworkCapture] Mock配置推送失败:', err)
            // 不影响抓包功能，只记录警告
          }
        } else {
          toast.error(`启动失败: ${result.error || '未知错误'}`, { id: 'start-capture' })
        }
      } catch (error) {
        toast.error(`启动失败: ${error instanceof Error ? error.message : '未知错误'}`, { id: 'start-capture' })
      }
    } catch (error) {
      console.error('[NetworkCapturePage] 开始抓包失败:', error)
      toast.error(`开始抓包失败: ${error instanceof Error ? error.message : '未知错误'}`, { id: 'start-capture' })
    }
  }, [selectedDevice, localPort, devicePort, startCaptureListeners, syncStatus])

  // 停止抓包（新架构）
  const handleStopCapture = useCallback(async () => {
    if (!selectedDevice) return

    try {
      // 停止 TCP 服务器
      await window.hdc.networkCapture.stopCaptureServer(selectedDevice.connectKey)

      // 更新 store 状态
      await storeStopCapture(selectedDevice.connectKey)
    } catch (error) {
      console.error('[NetworkCapturePage] 停止抓包失败:', error)
    }
  }, [selectedDevice, storeStopCapture])

  // 删除已勾选请求，与安卓抓包保持一致。
  const handleClearRequests = useCallback((): void => {
    if (!selectedDevice) return

    if (selectedIds.size === 0) {
      toast.warning('请先在左侧请求列表前勾选想要删除的项')
      return
    }

    captureEvent('network capture selected requests deleted')
    const remaining = requests.filter(
      (request) => !selectedIds.has(getNetworkRequestKey(request))
    )
    storeSetRequests(selectedDevice.connectKey, remaining)
    storeSetSelectedRequest(selectedDevice.connectKey, null)
    setSelectedIds(new Set())
  }, [requests, selectedDevice, selectedIds, storeSetRequests, storeSetSelectedRequest])

  // ========== HiProfiler 模式的抓包处理 ==========

  const handleStartHiProfilerCapture = useCallback(async () => {
    if (!selectedDevice || !selectedHiProfilerApp) {
      toast.error('请先选择一个进程')
      return
    }

    try {
      const processStatus = await networkCaptureAPI.GetHiProfilerProcessStatus(
        selectedDevice.connectKey,
        selectedHiProfilerApp.processName
      )
      if (!processStatus.alive || processStatus.pid <= 0) {
        setSelectedHiProfilerApp((current) => current ? { ...current, pid: 0 } : current)
        toast.warning('目标进程已退出，请先重新启动应用')
        return
      }

      const targetApp = {
        ...selectedHiProfilerApp,
        pid: processStatus.pid
      }
      setSelectedHiProfilerApp(targetApp)
      setHiProfilerStatus({
        state: 'starting',
        isCapturing: false,
        deviceId: selectedDevice.connectKey,
        pid: targetApp.pid,
        bundleName: targetApp.bundleName,
        processName: targetApp.processName
      })
      toast.loading('正在启动 HiProfiler 抓包...', { id: 'start-hiprofiler' })
      // HiProfiler 启动后会立即开始推送 FetchData 结果，先注册监听，避免启动
      // RPC 返回前已经完成的短请求丢失或延后到下一批次才被用户看到。
      startCaptureListeners(selectedDevice.connectKey, false)
      await networkCaptureAPI.StartHiProfilerCapture(
        selectedDevice.connectKey,
        targetApp.pid,
        targetApp.bundleName,
        targetApp.processName
      )
      setHiProfilerStatus((current) => current.state === 'capturing'
        ? current
        : {
            state: 'capturing',
            isCapturing: true,
            deviceId: selectedDevice.connectKey,
            pid: targetApp.pid,
            bundleName: targetApp.bundleName,
            processName: targetApp.processName
          })
      toast.success('HiProfiler 抓包已启动', { id: 'start-hiprofiler' })
    } catch (error) {
      setHiProfilerStatus((current) => ({
        ...current,
        state: 'error',
        isCapturing: false,
        reason: error instanceof Error ? error.message : String(error)
      }))
      toast.error(`HiProfiler 启动失败: ${error instanceof Error ? error.message : '未知错误'}`, { id: 'start-hiprofiler' })
    }
  }, [selectedDevice, selectedHiProfilerApp, startCaptureListeners])

  const handleStopHiProfilerCapture = useCallback(async () => {
    if (!selectedDevice) return

    const targetPID = hiProfilerStatus.pid || selectedHiProfilerApp?.pid || 0
    setHiProfilerStatus((current) => ({ ...current, state: 'stopping', isCapturing: false }))
    try {
      if (targetPID > 0) {
        await networkCaptureAPI.StopHiProfilerCapture(selectedDevice.connectKey, targetPID).catch(() => {})
      }
      const stoppedCount = await networkCaptureAPI.StopAllHiProfilerCaptures(selectedDevice.connectKey)
      toast.success(stoppedCount > 0 ? `已停止并清理 ${stoppedCount} 个 HiProfiler 会话` : 'HiProfiler 抓包已停止')
    } catch (error) {
      toast.error(`停止失败: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setHiProfilerStatus({ state: 'idle', isCapturing: false, deviceId: selectedDevice.connectKey })
    }
  }, [hiProfilerStatus.pid, selectedDevice, selectedHiProfilerApp?.pid])

  const handleToggleExportSelect = useCallback((request: NetworkRequest): void => {
    const key = getNetworkRequestKey(request)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const handleToggleExportSelectAll = useCallback((): void => {
    const visibleRequests = requests
      .filter((request) => !request.isSessionBoundary)
      .filter((request) => !isFilterMode || !searchQuery.trim() || searchMatches.has(getNetworkRequestKey(request)))

    const allSelected = visibleRequests.length > 0 &&
      visibleRequests.every((request) => selectedIds.has(getNetworkRequestKey(request)))
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const request of visibleRequests) {
        const key = getNetworkRequestKey(request)
        if (allSelected) {
          next.delete(key)
        } else {
          next.add(key)
        }
      }
      return next
    })
  }, [isFilterMode, requests, searchMatches, searchQuery, selectedIds])

  const handleExportClick = useCallback((): void => {
    setSingleExportRequest(null)
    setExportDialogOpen(true)
  }, [])

  const handleExportSingleRequest = useCallback((request: NetworkRequest): void => {
    setSelectedRequest(request)
    setSingleExportRequest(request)
    setExportDialogOpen(true)
  }, [setSelectedRequest])

  const handleExportDialogOpenChange = useCallback((open: boolean): void => {
    setExportDialogOpen(open)
    if (!open) setSingleExportRequest(null)
  }, [])

  const prettyJsonOrOriginal = useCallback((value?: string): string => {
    if (!value) return ''
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }, [])

  const buildMockRuleFromRequest = useCallback((request: NetworkRequest): MockRule => {
    const fullUrl = buildNetworkRequestUrl(request)
    // Sophon 设备端实际使用 Axios config.url 匹配，并且始终按正则执行。
    // 用转义后的原始 config.url 作为非锚定正则，可同时匹配相对和完整 URL。
    const sophonMatchUrl = request.url || fullUrl
    let pathOnly = fullUrl || '请求'
    const urlPattern = escapeRegexLiteral(sophonMatchUrl)
    try {
      const parsedUrl = new URL(fullUrl)
      pathOnly = parsedUrl.pathname || '/'
      const firstQueryPart = parsedUrl.search ? parsedUrl.search.slice(1).split('&')[0] : ''
      if (pathOnly === '/' && firstQueryPart) {
        pathOnly = `/?${firstQueryPart}`
      }
    } catch {
      // URL 无法解析时保留原值，和安卓抓包的规则生成逻辑一致。
    }

    return {
      id: `mock-rule-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      name: pathOnly,
      enabled: true,
      matchCondition: {
        urlPattern,
        urlRegex: true
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
    setMockInitialTestUrl(buildNetworkRequestUrl(request))
    setMockConfigDraft({
      ...mockConfig,
      enabled: true,
      rules: [...mockConfig.rules, newRule]
    })
    captureEvent('harmony sophon mock rule generated from request')
    setMockConfigDialogOpen(true)
  }, [buildMockRuleFromRequest, mockConfig, setSelectedRequest])

  const handleMockConfigChange = useCallback((config: MockConfig): void => {
    setMockConfig(config)
    setMockConfigDraft(null)
    setMockInitialTestUrl('')
  }, [setMockConfig])

  const handleMockDialogOpenChange = useCallback((open: boolean): void => {
    setMockConfigDialogOpen(open)
    if (!open) {
      setMockConfigDraft(null)
      setMockInitialTestUrl('')
    }
  }, [])

  // 处理拖动调整宽度
  const containerRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      if (!isResizing || !containerRef.current) return
      
      const containerRect = containerRef.current.getBoundingClientRect()
      const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100
      
      // 限制在20%到80%之间
      const clampedWidth = Math.max(20, Math.min(80, newLeftWidth))
      setLeftPanelWidth(clampedWidth)
    }

    const handleMouseUp = (): void => {
      setIsResizing(false)
    }

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

  // 组件卸载时关闭测试连接（不清理事件监听器，让后台继续抓包）
  useEffect(() => {
    return () => {
      // 关闭所有测试连接
      window.hdc.networkCapture.closeTestConnection(localPort).catch((error) => {
        console.error('[NetworkCapturePage] 关闭测试连接失败:', error)
      })
    }
  }, [localPort])

  // 计算运行时间
  const duration = startTime ? Date.now() - startTime : 0

  /**
   * 搜索匹配函数
   */
  const performSearch = useCallback((query: string, regexMode: boolean, requests: NetworkRequest[]): void => {
    if (!selectedDevice) return

    if (!query.trim()) {
      storeSetSearchMatches(selectedDevice.connectKey, new Map())
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

    // 创建正则表达式的辅助函数
    const createRegex = (): RegExp | null => {
      if (!regexMode) return null
      try {
        return new RegExp(query, 'gi')
      } catch (e) {
        return null
      }
    }

    // 查找所有匹配的辅助函数
    const findAllMatches = (text: string, regex: RegExp | null): Array<{ start: number; end: number; text: string }> => {
      const result: Array<{ start: number; end: number; text: string }> = []
      if (!regex) return result
      
      regex.lastIndex = 0
      let match
      while ((match = regex.exec(text)) !== null) {
        result.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0]
        })
      }
      return result
    }

    for (const request of requests) {
      const requestKey = getNetworkRequestKey(request)
      
      const result: {
        urlMatch: boolean
        requestBodyMatch: boolean
        responseBodyMatch: boolean
        requestHeadersMatch: boolean
        requestParamsMatch: boolean
        matches: Array<{ start: number; end: number; text: string }>
      } = {
        urlMatch: false,
        requestBodyMatch: false,
        responseBodyMatch: false,
        requestHeadersMatch: false,
        requestParamsMatch: false,
        matches: []
      }

      // 搜索URL
      const url = request.fullUrl || request.url || ''
      if (regexMode) {
        const urlRegex = createRegex()
        if (urlRegex) {
          const urlMatches = findAllMatches(url, urlRegex)
          if (urlMatches.length > 0) {
            result.urlMatch = true
            result.matches.push(...urlMatches)
          }
        }
      } else {
        const index = url.toLowerCase().indexOf(query.toLowerCase())
        if (index !== -1) {
          result.urlMatch = true
          result.matches.push({
            start: index,
            end: index + query.length,
            text: query
          })
        }
      }

      // 搜索request-body
      if (request.requestBody) {
        if (regexMode) {
          const bodyRegex = createRegex()
          if (bodyRegex) {
            const bodyMatches = findAllMatches(request.requestBody, bodyRegex)
            if (bodyMatches.length > 0) {
              result.requestBodyMatch = true
              result.matches.push(...bodyMatches)
            }
          }
        } else {
          const index = request.requestBody.toLowerCase().indexOf(query.toLowerCase())
          if (index !== -1) {
            result.requestBodyMatch = true
            result.matches.push({
              start: index,
              end: index + query.length,
              text: query
            })
          }
        }
      }

      // 搜索response-body
      if (request.responseBody) {
        if (regexMode) {
          const bodyRegex = createRegex()
          if (bodyRegex) {
            const bodyMatches = findAllMatches(request.responseBody, bodyRegex)
            if (bodyMatches.length > 0) {
              result.responseBodyMatch = true
              result.matches.push(...bodyMatches)
            }
          }
        } else {
          const index = request.responseBody.toLowerCase().indexOf(query.toLowerCase())
          if (index !== -1) {
            result.responseBodyMatch = true
            result.matches.push({
              start: index,
              end: index + query.length,
              text: query
            })
          }
        }
      }

      // 搜索 request-headers
      if (request.requestHeaders) {
        const headersText = Object.entries(request.requestHeaders)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
        if (regexMode) {
          const headersRegex = createRegex()
          if (headersRegex) {
            const headersMatches = findAllMatches(headersText, headersRegex)
            if (headersMatches.length > 0) {
              result.requestHeadersMatch = true
              result.matches.push(...headersMatches)
            }
          }
        } else {
          const index = headersText.toLowerCase().indexOf(query.toLowerCase())
          if (index !== -1) {
            result.requestHeadersMatch = true
            result.matches.push({
              start: index,
              end: index + query.length,
              text: query
            })
          }
        }
      }

      // 搜索 request-params
      if (request.requestParams) {
        const paramsText = Object.entries(request.requestParams)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
        if (regexMode) {
          const paramsRegex = createRegex()
          if (paramsRegex) {
            const paramsMatches = findAllMatches(paramsText, paramsRegex)
            if (paramsMatches.length > 0) {
              result.requestParamsMatch = true
              result.matches.push(...paramsMatches)
            }
          }
        } else {
          const index = paramsText.toLowerCase().indexOf(query.toLowerCase())
          if (index !== -1) {
            result.requestParamsMatch = true
            result.matches.push({
              start: index,
              end: index + query.length,
              text: query
            })
          }
        }
      }

      if (result.urlMatch || result.requestBodyMatch || result.responseBodyMatch || result.requestHeadersMatch || result.requestParamsMatch) {
        matches.set(requestKey, result)
      }
    }

    storeSetSearchMatches(selectedDevice.connectKey, matches)
  }, [selectedDevice, storeSetSearchMatches])

  // 仅对输入变化做防抖；请求列表更新时继续使用已稳定的关键词实时匹配。
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 1500)

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [searchQuery])

  useEffect(() => {
    performSearch(debouncedSearchQuery, isRegexMode, requests)
  }, [debouncedSearchQuery, isRegexMode, requests, performSearch])

  // 未选择设备时的提示
  if (!selectedDevice) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Globe className="h-6 w-6 text-primary" />
            鸿蒙抓包
            <WindowToggleButton />
            <HelpToggleButton />
          </h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <NoDeviceState icon={<Globe className="h-16 w-16 mx-auto mb-4 opacity-50" />} />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full flex flex-col overflow-hidden">
      {/* 标题栏 - 标题和操作按钮在一行 */}
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Globe className="h-6 w-6 text-primary" />
          鸿蒙抓包
          <WindowToggleButton />
            <HelpToggleButton />
        </h1>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 模式切换 */}
          <Select
            value={captureMode}
            onValueChange={(v) => setCaptureMode(v as 'sophon' | 'hiprofiler')}
            disabled={isHiProfilerActive}
          >
            <SelectTrigger className="w-[130px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sophon">Sophon模式</SelectItem>
              <SelectItem value="hiprofiler">HiProfiler模式</SelectItem>
            </SelectContent>
          </Select>

          {/* 搜索组件 */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
            <Input
              type="text"
              placeholder="搜索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-40 w-[280px] h-9"
            />
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
              <div className="flex items-center gap-1">
                <Checkbox
                  id="regex-mode"
                  checked={isRegexMode}
                  onCheckedChange={(checked) => setIsRegexMode(checked === true)}
                  className="h-4 w-4"
                />
                <label
                  htmlFor="regex-mode"
                  className="text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap"
                >
                  正则
                </label>
              </div>
              <div className="flex items-center gap-1">
                <Checkbox
                  id="filter-mode"
                  checked={isFilterMode}
                  onCheckedChange={(checked) => setIsFilterMode(checked === true)}
                  className="h-4 w-4"
                />
                <label
                  htmlFor="filter-mode"
                  className="text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap"
                >
                  过滤
                </label>
              </div>
            </div>
          </div>

          {/* HiProfiler 模式：进程选择器 */}
          {captureMode === 'hiprofiler' && (
            <HarmonyProcessSelect
              deviceId={selectedDevice.connectKey}
              value={selectedHiProfilerApp}
              onChange={setSelectedHiProfilerApp}
              disabled={isHiProfilerActive}
            />
          )}

          {/* Sophon 模式：Mock 按钮 */}
          {captureMode === 'sophon' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                captureEvent('harmony sophon mock config opened')
                setMockConfigDraft(null)
                setMockInitialTestUrl('')
                setMockConfigDialogOpen(true)
              }}
              className="gap-2"
            >
              <Wand2 className="h-4 w-4" />
              <span>Mock</span>
            </Button>
          )}

          {/* 开始/停止按钮 */}
          {captureMode === 'hiprofiler' ? (
            hiProfilerStatus.state === 'capturing' ? (
              <Button variant="destructive" size="sm" onClick={handleStopHiProfilerCapture} className="gap-2">
                <Square className="h-4 w-4" />
                <span>停止抓包</span>
              </Button>
            ) : hiProfilerStatus.state === 'waiting' ? (
              <Button variant="destructive" size="sm" onClick={handleStopHiProfilerCapture} className="gap-2">
                <Square className="h-4 w-4" />
                <span>停止等待</span>
              </Button>
            ) : hiProfilerStatus.state === 'restarting' ? (
              <Button size="sm" className="gap-2" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>恢复中</span>
              </Button>
            ) : hiProfilerStatus.state === 'starting' ? (
              <Button size="sm" className="gap-2" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>启动中</span>
              </Button>
            ) : hiProfilerStatus.state === 'stopping' ? (
              <Button variant="destructive" size="sm" className="gap-2" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>停止中</span>
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleStartHiProfilerCapture}
                className="gap-2"
                disabled={!selectedHiProfilerApp || selectedHiProfilerApp.pid <= 0}
              >
                <Play className="h-4 w-4" />
                <span>开始抓包</span>
              </Button>
            )
          ) : (
            captureStatus.isCapturing ? (
              <Button variant="destructive" size="sm" onClick={handleStopCapture} className="gap-2">
                <Square className="h-4 w-4" />
                <span>停止抓包</span>
              </Button>
            ) : (
              <Button size="sm" onClick={handleStartCapture} className="gap-2">
                <Play className="h-4 w-4" />
                <span>开始抓包</span>
              </Button>
            )
          )}
          <Button variant="outline" size="sm" onClick={handleClearRequests} className="gap-2" title="删除已选请求">
            <Trash2 className="h-4 w-4" />
          </Button>
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

      {/* 主内容区 - 左右布局 */}
      <div ref={containerRef} className="flex-1 flex min-h-0 relative gap-1">
        {/* 左侧：请求列表 */}
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
            onToggleSelect={handleToggleExportSelect}
            onToggleSelectAll={handleToggleExportSelectAll}
            onExportRequest={handleExportSingleRequest}
            onMockRequest={captureMode === 'sophon' ? handleMockSingleRequest : undefined}
          />
        </Card>

        {/* 拖动区域 - 空白区域，鼠标悬停时变化 */}
        <div
          className="w-2 cursor-col-resize flex-shrink-0 z-10 hover:bg-primary/20 transition-colors"
          onMouseDown={() => setIsResizing(true)}
        />

        {/* 右侧：请求详情 */}
        <Card className="min-w-0 flex flex-col flex-1 overflow-hidden">
          <NetworkRequestDetail
            request={selectedRequest}
            searchQuery={searchQuery}
            searchMatches={searchMatches}
            isRegexMode={isRegexMode}
          />
        </Card>
      </div>

      {/* 底部状态栏 - 一行显示 */}
      <div className="mt-4 flex-shrink-0 flex items-center gap-4 text-xs text-muted-foreground">
        <span>请求数: <span className="font-mono">{requests.length}</span></span>
        {selectedIds.size > 0 && (
          <>
            <span>|</span>
            <span>已选: <span className="font-mono">{selectedIds.size}</span> 个</span>
          </>
        )}
        {captureMode === 'hiprofiler' && selectedHiProfilerApp && (
          <>
            <span>|</span>
            <span>进程: <span className="font-mono">{selectedHiProfilerApp.processName}</span></span>
            <span>PID: <span className="font-mono">{selectedHiProfilerApp.pid || '-'}</span></span>
            {hiProfilerStatus.state === 'waiting'
              ? <span className="text-amber-500">等待进程重启</span>
              : selectedHiProfilerApp.pid <= 0 && <span className="text-amber-500">进程已退出</span>}
          </>
        )}
        <span>|</span>
        {renderHeartbeatStatus()}
      </div>

      <ExportNetworkDialog
        open={exportDialogOpen}
        onOpenChange={handleExportDialogOpenChange}
        selectedRequests={exportRequests}
        platform="harmony"
        processName={selectedHiProfilerApp?.processName || (captureMode === 'sophon' ? 'sophon' : 'process')}
      />

      {/* 端口转发配置弹窗 */}
      <PortForwardDialog
        open={portForwardDialogOpen}
        onOpenChange={setPortForwardDialogOpen}
        localPort={localPort}
        devicePort={devicePort}
        onPortChange={(local, device) => {
          setLocalPort(local)
          setDevicePort(device)
        }}
        onStatusChange={(status) => {
          if (selectedDevice) {
            const { setPortForward } = useNetworkCaptureStore.getState()
            setPortForward(selectedDevice.connectKey, status)
          }
        }}
      />

      {/* Mock 配置弹窗 */}
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
