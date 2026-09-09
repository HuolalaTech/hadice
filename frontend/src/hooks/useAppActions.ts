import { useState, useCallback } from 'react'
import { useDeviceStore } from '@/store/deviceStore'
import { isHdcAvailable } from '@/lib/hdc'
import type { AppInfo } from '@/types/hdc'
import { captureEvent } from '@/lib/posthog'

/**
 * 应用操作管理 Hook
 */
export function useAppActions(onRefresh: () => Promise<void>) {
  const { selectedDevice } = useDeviceStore()
  const [isActioning, setIsActioning] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)

  // 启动应用
  const startApp = useCallback(async (app: AppInfo) => {
    if (!selectedDevice || !isHdcAvailable()) return
    try {
      await window.hdc.startApp(selectedDevice.connectKey, app.packageName, selectedDevice.platform)
      await onRefresh()
    } catch (error) {
      console.error('[useAppActions] Failed to start app:', error)
      throw error
    }
  }, [selectedDevice, onRefresh])

  // 停止应用
  const stopApp = useCallback(async (app: AppInfo) => {
    if (!selectedDevice || !isHdcAvailable()) return
    try {
      await window.hdc.stopApp(selectedDevice.connectKey, app.packageName, selectedDevice.platform)
      await onRefresh()
    } catch (error) {
      console.error('[useAppActions] Failed to stop app:', error)
      throw error
    }
  }, [selectedDevice, onRefresh])

  // 执行操作
  const executeAction = useCallback(async (
    app: AppInfo,
    action: 'start' | 'stop' | 'clear' | 'clearCache' | 'uninstall'
  ) => {
    if (!selectedDevice || !isHdcAvailable()) return

    setIsActioning(true)
    try {
      let result
      const platform = selectedDevice.platform
      switch (action) {
        case 'start':
          result = await window.hdc.startApp(selectedDevice.connectKey, app.packageName, platform)
          break
        case 'stop':
          result = await window.hdc.stopApp(selectedDevice.connectKey, app.packageName, platform)
          break
        case 'clear':
          result = await window.hdc.clearAppData(selectedDevice.connectKey, app.packageName, platform)
          break
        case 'clearCache':
          result = await window.hdc.clearAppCacheFiles(selectedDevice.connectKey, app.packageName)
          break
        case 'uninstall':
          result = await window.hdc.uninstallApp(selectedDevice.connectKey, app.packageName, platform)
          break
      }

      if (result && result.success) {
        if (action === 'start') captureEvent('app started', { package_name: app.packageName })
        if (action === 'stop') captureEvent('app stopped', { package_name: app.packageName })
        if (action === 'uninstall') captureEvent('app uninstalled', { package_name: app.packageName })
        await onRefresh()
        return { success: true }
      } else {
        return { success: false, error: result?.error }
      }
    } catch (error) {
      console.error('[useAppActions] Action error:', error)
      return { success: false, error: error instanceof Error ? error.message : '操作失败' }
    } finally {
      setIsActioning(false)
    }
  }, [selectedDevice, onRefresh])

  // 安装应用
  const installApp = useCallback(async () => {
    if (!selectedDevice || !isHdcAvailable() || isInstalling) return

    try {
      // 弹出文件选择器
      const filePath = await window.hdc.selectHapFile(selectedDevice.connectKey)
      if (!filePath) {
        return { success: false, cancelled: true }
      }

      // 开始安装
      setIsInstalling(true)

      // 执行安装
      const result = await window.hdc.installApp(selectedDevice.connectKey, filePath)

      // 合并所有输出信息用于判断
      const allOutput = [result.output, result.error].filter(Boolean).join('\n').trim()
      const installResult = allOutput.toLowerCase()

      // 根据输出内容判断安装结果
      const isSuccess = installResult.includes('success') || 
        (result.success && !result.error && installResult.length > 0 && 
         !installResult.includes('error') && !installResult.includes('fail'))

      if (isSuccess) {
        captureEvent('app installed', { file_path: filePath })
        await onRefresh()
        return { success: true }
      } else if (installResult.includes('downgrade')) {
        return { success: false, error: '安装失败，无法降级安装，请先卸载' }
      } else {
        const errorMsg = result.error || result.output || '安装失败，若已安装请卸载旧版再尝试'
        return { 
          success: false, 
          error: errorMsg.length > 50 ? '安装失败，若已安装请卸载旧版再尝试' : errorMsg 
        }
      }
    } catch (error) {
      console.error('[useAppActions] Install app error:', error)
      return { success: false, error: '安装失败，请检查文件路径和设备连接' }
    } finally {
      setIsInstalling(false)
    }
  }, [selectedDevice, onRefresh, isInstalling])

  return {
    isActioning,
    isInstalling,
    startApp,
    stopApp,
    executeAction,
    installApp
  }
}

