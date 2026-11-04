import React, { useEffect, useRef, useState } from 'react'
import { Toaster } from 'sonner'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { Footer } from '@/components/layout/Footer'
import { useNavigationStore } from '@/store/navigationStore'
import { UpdateDialog } from '@/components/dialogs/UpdateDialog'
import * as BackendApp from '../bindings/Hadice/backend/appservice'
import { EventsOn } from '../wailsjs/runtime/runtime'
import { UPDATE_CHECK_URL } from '@/lib/config'
import { PageProvider } from '@/contexts/PageContext'
import { usePanelStore } from '@/store/panelStore'
import { useShellSessionStore } from '@/store/shellSessionStore'
import {
  SHELL_HANDOFF_EVENT,
  setShellHandoff,
  type ShellHandoffPayload
} from '@/lib/shell-handoff'
import {
  DEVICE_SELECTED_EVENT,
  useDeviceStore
} from '@/store/deviceStore'
import { readPreferredDeviceKeyFromSearch } from '@/lib/device-selection'
import { captureEvent } from '@/lib/posthog'
import { useThemeStore } from '@/store/themeStore'
import {
  DeviceOverviewPage,
  SystemInfoPage,
  PerformanceMonitorPage,
  ProcessManagerPage,
  ScreenMirrorScreenshotPage,
  FileTransferPage,
  AppManagerPage,
  AppLayoutPage,
  AppInstallPage,
  SystemLogsPage,
  NetworkCapturePage,
  TrackLogPage,
  AndroidNetworkCapturePage,
  HdcShellPage,
  AIAutomationPage,
  HandyToolsPage,
  WebPeekPage,
  WebPeekViewerPage
} from '@/pages'

/**
 * 错误回退 UI
 */
function ErrorFallback({ error, resetError }: { error: unknown; resetError: () => void }) {
  return (
    <div className="h-screen flex items-center justify-center bg-background text-foreground">
      <div className="text-center p-8">
        <h1 className="text-2xl font-bold mb-4 text-red-500">出现错误</h1>
        <p className="text-muted-foreground mb-4">
          {(error instanceof Error ? error.message : '未知错误')}
        </p>
        <button
          onClick={() => {
            resetError()
            window.location.reload()
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          重新加载
        </button>
      </div>
    </div>
  )
}

/**
 * 根据菜单 ID 渲染对应的页面组件（包在 PageContext 中）
 */
function renderPage(
  menuId: string,
  standalone: boolean,
  onNavigateTo?: (id: string) => void
): React.JSX.Element {
  let page: React.ReactNode
  switch (menuId) {
    case 'device-overview':
      page = <DeviceOverviewPage />
      break
    case 'system-info':
      page = <SystemInfoPage />
      break
    case 'performance':
      page = <PerformanceMonitorPage />
      break
    case 'process':
      page = <ProcessManagerPage />
      break
    case 'screenshot':
      page = <ScreenMirrorScreenshotPage />
      break
    case 'file-transfer':
      page = <FileTransferPage />
      break
    case 'app-manager':
      page = <AppManagerPage />
      break
    case 'app-layout':
      page = <AppLayoutPage />
      break
    case 'app-install':
      page = <AppInstallPage />
      break
    case 'system-logs':
      page = <SystemLogsPage />
      break
    case 'network-capture':
      page = <NetworkCapturePage />
      break
    case 'track-log':
      page = <TrackLogPage />
      break
    case 'android-network-capture':
      page = <AndroidNetworkCapturePage />
      break
    case 'hdc-shell':
      page = <HdcShellPage />
      break
    case 'ai-automation':
      page = <AIAutomationPage />
      break
    case 'handy-tools':
      page = <HandyToolsPage />
      break
    case 'web-peek':
      page = <WebPeekPage />
      break
    case 'web-peek-viewer':
      page = <WebPeekViewerPage />
      break
    default:
      page = <DeviceOverviewPage />
  }
  return (
    <PageProvider value={{ menuId, standalone, onNavigateTo }}>
      {page}
    </PageProvider>
  )
}

/**
 * 解析 URL 中的 page / standalone / device 参数
 */
function useUrlParams(): {
  page: string
  standalone: boolean
  deviceKey: string | null
} {
  const [params] = useState(() => {
    const search = typeof window !== 'undefined' ? window.location.search : ''
    const sp = new URLSearchParams(search)
    return {
      page: sp.get('page') || 'device-overview',
      standalone: sp.get('standalone') === '1',
      deviceKey: readPreferredDeviceKeyFromSearch(search)
    }
  })
  return params
}

/**
 * 应用根组件
 */
function App(): React.JSX.Element {
  const { activeMenu, setActiveMenu } = useNavigationStore()
  const { page, standalone, deviceKey } = useUrlParams()
  const { panelOpenMap, getFirstVisibleMenuId } = usePanelStore()
  const initializeDevices = useDeviceStore((s) => s.initialize)
  const setPreferredConnectKey = useDeviceStore((s) => s.setPreferredConnectKey)
  const applyRemoteDeviceKey = useDeviceStore((s) => s.applyRemoteDeviceKey)
  const selectedDevice = useDeviceStore((s) => s.selectedDevice)
  const theme = useThemeStore((s) => s.theme)
  // 终端页 keep-alive：首次进入后常驻，切走不卸载，避免 PTY/历史被清掉
  const [shellKeptAlive, setShellKeptAlive] = useState(false)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{
    currentVersion: string
    latestVersion: string
    releaseDate: string
    downloadURL: string
    releaseNotes: string
  } | null>(null)

  // Wails WebView 默认不吃浏览器 Cmd+R；开发热更失败时用它强制刷前端
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'r') return
      e.preventDefault()
      window.location.reload()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // 主窗口：独立窗交回终端状态（必须在本窗 JS 里收下，localStorage/二次 Get 不可靠）
  useEffect(() => {
    if (standalone) return
    const unlistenHandoff = EventsOn(
      SHELL_HANDOFF_EVENT,
      (payload: ShellHandoffPayload) => {
        if (!payload?.tabs?.length) return
        setShellHandoff(payload)
        useShellSessionStore.getState().applyBackendState(payload)
      }
    )
    const unlistenNav = EventsOn('navigateToPage', (menuId: string) => {
      // 立刻放开主窗挂载，勿等 IsPanelWindowOpen 异步刷新
      usePanelStore.getState().setPanelOpen(menuId, false)
      setActiveMenu(menuId)
    })
    return () => {
      if (typeof unlistenHandoff === 'function') unlistenHandoff()
      if (typeof unlistenNav === 'function') unlistenNav()
    }
  }, [standalone, setActiveMenu])

  // 主窗口：当前选中的菜单若已在独立窗口中，自动切换到第一个可见菜单
  useEffect(() => {
    if (standalone) return
    if (panelOpenMap[activeMenu]) {
      setActiveMenu(getFirstVisibleMenuId(activeMenu))
    }
  }, [standalone, panelOpenMap, activeMenu, setActiveMenu, getFirstVisibleMenuId])

  // 主窗口：在抓包页切设备时，同步到对应平台的抓包面板
  useEffect(() => {
    if (standalone || !selectedDevice) return
    const isHarmony = selectedDevice.platform === 'harmonyos'
    if (activeMenu === 'android-network-capture' && isHarmony) {
      setActiveMenu('network-capture')
      return
    }
    if (activeMenu === 'network-capture' && !isHarmony) {
      setActiveMenu('android-network-capture')
    }
  }, [standalone, selectedDevice?.platform, activeMenu, setActiveMenu])

  useEffect(() => {
    if (!standalone && activeMenu === 'hdc-shell') {
      setShellKeptAlive(true)
    }
  }, [standalone, activeMenu])

  // 检查更新（仅主窗口）
  useEffect(() => {
    if (standalone) return
    const checkUpdate = async () => {
      try {
        // 获取当前应用版本
        const currentVersion = await BackendApp.GetAppVersion()
        // @ts-ignore - CheckUpdate方法会在运行wails generate后生成
        if (!UPDATE_CHECK_URL) return
        const result = await BackendApp.CheckUpdate(UPDATE_CHECK_URL, currentVersion)
        if (result.success && result.hasUpdate) {
          setUpdateInfo({
            currentVersion: result.currentVersion as string,
            latestVersion: result.latestVersion as string,
            releaseDate: result.releaseDate as string,
            downloadURL: result.downloadURL as string,
            releaseNotes: result.releaseNotes as string
          })
          captureEvent('update available', {
            current_version: result.currentVersion,
            latest_version: result.latestVersion,
          })
          setUpdateDialogOpen(true)
        }
      } catch (error) {
        // 静默失败，不打扰用户
        console.error('[UpdateCheck] Failed to check update:', error)
      }
    }

    // 延迟检查更新，避免影响启动速度
    const timer = setTimeout(() => {
      checkUpdate()
    }, 2000)

    // 每12小时检查一次更新
    const interval = setInterval(() => {
      checkUpdate()
    }, 12 * 60 * 60 * 1000)

    return () => {
      clearTimeout(timer)
      clearInterval(interval)
    }
  }, [standalone])

  const prevPageRef = useRef<string | null>(null)
  useEffect(() => {
    captureEvent('page viewed', {
      page: activeMenu,
      from_page: prevPageRef.current,
      is_standalone: standalone,
    })
    prevPageRef.current = activeMenu
  }, [activeMenu, standalone])

  // 处理下载按钮点击
  const handleDownload = () => {
    if (updateInfo?.downloadURL) {
      captureEvent('update download clicked', {
        current_version: updateInfo.currentVersion,
        latest_version: updateInfo.latestVersion,
      })
      BackendApp.OpenBrowser(updateInfo.downloadURL).catch((err) => {
        console.error('Failed to open download URL:', err)
      })
      setUpdateDialogOpen(false)
    }
  }

  // 跨窗同步当前设备（主窗切换 / 再次打开独立窗聚焦时广播）
  useEffect(() => {
    const unlisten = EventsOn(DEVICE_SELECTED_EVENT, (key: string) => {
      if (typeof key === 'string' && key) applyRemoteDeviceKey(key)
    })
    return () => {
      if (typeof unlisten === 'function') unlisten()
    }
  }, [applyRemoteDeviceKey])

  // 独立窗口：URL device → 否则读后端 → 拉列表 → 再强制 apply（防 setDevices 竞态）
  useEffect(() => {
    if (!standalone) return
    let cancelled = false
    ;(async () => {
      let preferred = deviceKey
      if (!preferred) {
        try {
          preferred = (await BackendApp.GetSelectedConnectKey()) || null
        } catch {
          preferred = null
        }
      }
      if (cancelled) return
      if (preferred) setPreferredConnectKey(preferred)
      await initializeDevices()
      if (cancelled) return
      if (preferred) applyRemoteDeviceKey(preferred)
    })()
    return () => {
      cancelled = true
    }
  }, [
    standalone,
    deviceKey,
    setPreferredConnectKey,
    applyRemoteDeviceKey,
    initializeDevices,
  ])

  // 独立窗口布局：页面自带头部，内容区含切换按钮
  if (standalone) {
    const isPeekViewer = page === 'web-peek-viewer'
    // 网页看看悬浮工具条：透明无底栏，避免挡内容
    if (isPeekViewer) {
      return (
        <div className="h-screen w-screen overflow-hidden bg-transparent text-foreground">
          {renderPage(page, true)}
          <Toaster position="top-center" theme={theme} />
        </div>
      )
    }
    return (
      <div className="h-screen flex flex-col bg-background text-foreground">
        {/* overflow-hidden：系统日志 xterm 需要稳定高度，auto 会导致独立窗终端区塌成空白 */}
        <main className="flex-1 overflow-hidden bg-background min-h-0">
          {renderPage(page, true)}
        </main>
        <Footer />
        <Toaster position="top-center" theme={theme} />
      </div>
    )
  }

  // 主窗口布局
  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* 顶部导航栏 */}
      <Header />

      {/* 主体区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧导航栏 */}
        <Sidebar activeMenu={activeMenu} onMenuChange={setActiveMenu} />

        {/* 主内容区：终端页 keep-alive，其余按菜单挂载 */}
        <main className="flex-1 overflow-auto bg-background min-w-0 relative">
          {/* 独立窗打开时卸掉主窗终端 UI（PTY 仍在后端），避免两套 xterm 抢同一会话 */}
          {(shellKeptAlive || activeMenu === 'hdc-shell') &&
            !(panelOpenMap['hdc-shell'] ?? false) && (
            <div
              className={
                activeMenu === 'hdc-shell'
                  ? 'absolute inset-0 overflow-auto'
                  : 'hidden'
              }
            >
              <PageProvider
                value={{
                  menuId: 'hdc-shell',
                  standalone: false,
                  onNavigateTo: setActiveMenu
                }}
              >
                <HdcShellPage visible={activeMenu === 'hdc-shell'} />
              </PageProvider>
            </div>
          )}
          {activeMenu !== 'hdc-shell' && renderPage(activeMenu, false, setActiveMenu)}
        </main>
      </div>

      {/* 底部状态栏 */}
      <Footer />
      
      {/* Toast通知 */}
      <Toaster position="top-center" theme={theme} />

      {/* 更新提示对话框 */}
      {updateInfo && (
        <UpdateDialog
          open={updateDialogOpen}
          onOpenChange={setUpdateDialogOpen}
          currentVersion={updateInfo.currentVersion}
          latestVersion={updateInfo.latestVersion}
          releaseDate={updateInfo.releaseDate}
          downloadURL={updateInfo.downloadURL}
          releaseNotes={updateInfo.releaseNotes}
          onDownload={handleDownload}
        />
      )}
    </div>
  )
}

export default App
