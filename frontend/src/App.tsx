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
import { useDeviceStore } from '@/store/deviceStore'
import { captureEvent } from '@/lib/posthog'
import {
  DeviceOverviewPage,
  SystemInfoPage,
  PerformanceMonitorPage,
  ProcessManagerPage,
  ScreenMirrorScreenshotPage,
  FileTransferPage,
  AppManagerPage,
  AppInstallPage,
  SystemLogsPage,
  NetworkCapturePage,
  AndroidNetworkCapturePage,
  HdcShellPage,
  AIAutomationPage
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
    case 'app-install':
      page = <AppInstallPage />
      break
    case 'system-logs':
      page = <SystemLogsPage />
      break
    case 'network-capture':
      page = <NetworkCapturePage />
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
 * 解析 URL 中的 page 和 standalone 参数
 */
function useUrlParams(): { page: string; standalone: boolean } {
  const [params, setParams] = useState(() => {
    const search = typeof window !== 'undefined' ? window.location.search : ''
    const sp = new URLSearchParams(search)
    return {
      page: sp.get('page') || 'device-overview',
      standalone: sp.get('standalone') === '1'
    }
  })
  return params
}

/**
 * 应用根组件
 */
function App(): React.JSX.Element {
  const { activeMenu, setActiveMenu } = useNavigationStore()
  const { page, standalone } = useUrlParams()
  const { panelOpenMap, getFirstVisibleMenuId } = usePanelStore()
  const initializeDevices = useDeviceStore((s) => s.initialize)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{
    currentVersion: string
    latestVersion: string
    releaseDate: string
    downloadURL: string
    releaseNotes: string
  } | null>(null)

  // 主窗口：监听 navigateToPage 事件，切回主窗口时切换到对应页面
  useEffect(() => {
    if (!standalone) {
      const unlisten = EventsOn('navigateToPage', (menuId: string) => {
        setActiveMenu(menuId)
      })
      return () => {
        if (typeof unlisten === 'function') unlisten()
      }
    }
  }, [standalone, setActiveMenu])

  // 主窗口：当前选中的菜单若已在独立窗口中，自动切换到第一个可见菜单
  useEffect(() => {
    if (standalone) return
    if (panelOpenMap[activeMenu]) {
      setActiveMenu(getFirstVisibleMenuId(activeMenu))
    }
  }, [standalone, panelOpenMap, activeMenu, setActiveMenu, getFirstVisibleMenuId])

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

  // 独立窗口：初始化设备列表（因无 Header 不再自动加载）
  useEffect(() => {
    if (standalone) {
      initializeDevices()
    }
  }, [standalone, initializeDevices])

  // 独立窗口布局：页面自带头部，内容区含切换按钮
  if (standalone) {
    return (
      <div className="h-screen flex flex-col bg-background text-foreground">
        <main className="flex-1 overflow-auto bg-background">
          {renderPage(page, true)}
        </main>
        <Toaster position="top-center" theme="dark" />
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

        {/* 主内容区：页面自带头部含切换按钮 */}
        <main className="flex-1 overflow-auto bg-background min-w-0">
          {renderPage(activeMenu, false, setActiveMenu)}
        </main>
      </div>

      {/* 底部状态栏 */}
      <Footer />
      
      {/* Toast通知 */}
      <Toaster position="top-center" theme="dark" />

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
