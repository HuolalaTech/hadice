/**
 * 网络抓包相关 API (新架构：Hadice 作为 TCP 服务器)
 */

import * as App from '../../../bindings/Hadice/backend/appservice.js'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { captureEvent, capturePostHogException } from '@/lib/posthog'
import type {
  PortForwardStatus,
  NetworkRequest,
  CaptureStatus,
  ConnectionTestResult,
  HiProfilerCaptureStatus
} from '@/types/hdc'

function getRuntimeErrorMessage(error: unknown): string {
  const unwrapMessage = (message: string): string => {
    try {
      const parsed = JSON.parse(message)
      if (parsed && typeof parsed.message === 'string') return parsed.message
    } catch {
      // 普通字符串错误，直接返回
    }
    return message
  }

  if (error instanceof Error) return unwrapMessage(error.message)
  if (error && typeof error === 'object' && 'message' in error) {
    return unwrapMessage(String((error as { message?: unknown }).message || error))
  }
  if (typeof error === 'string') {
    return unwrapMessage(error)
  }
  return String(error)
}

/**
 * 网络抓包相关 API
 */
export const networkCaptureAPI = {
  configurePortForward: async (connectKey: string, localPort: number, devicePort: number, portType: 'Forward' | 'Reverse' = 'Forward'): Promise<PortForwardStatus> => {
    try {
      const status = await App.ConfigurePortForward(connectKey, localPort, devicePort, portType)
      return {
        configured: status.configured,
        localPort: status.localPort,
        devicePort: status.devicePort,
        status: status.status as 'normal' | 'error' | 'not_configured',
        error: status.error
      }
    } catch (error) {
      console.error('[HDC API] networkCapture.configurePortForward failed:', error)
      throw error
    }
  },

  removePortForward: async (_connectKey: string, localPort: number, devicePort: number): Promise<{ success: boolean; output: string; error?: string }> => {
    try {
      const result = await App.RemovePortForward(localPort, devicePort)
      return { success: result.success, output: result.output || '', error: result.error }
    } catch (error) {
      console.error('[HDC API] networkCapture.removePortForward failed:', error)
      return { success: false, output: '', error: error instanceof Error ? error.message : String(error) }
    }
  },

  checkPortForwardStatus: async (_connectKey: string, localPort: number, devicePort: number): Promise<PortForwardStatus> => {
    try {
      const status = await App.CheckPortForwardStatus(localPort, devicePort)
      return {
        configured: status.configured,
        localPort: status.localPort,
        devicePort: status.devicePort,
        status: status.status as 'normal' | 'error' | 'not_configured',
        error: status.error
      }
    } catch (error) {
      console.error('[HDC API] networkCapture.checkPortForwardStatus failed:', error)
      throw error
    }
  },

  checkReversePortForwardStatus: async (connectKey: string, localPort: number, devicePort: number): Promise<PortForwardStatus> => {
    try {
      const status = await App.CheckReversePortForwardStatus(connectKey, localPort, devicePort)
      return {
        configured: status.configured,
        localPort: status.localPort,
        devicePort: status.devicePort,
        status: status.status as 'normal' | 'error' | 'not_configured',
        error: status.error
      }
    } catch (error) {
      console.error('[HDC API] networkCapture.checkReversePortForwardStatus failed:', error)
      throw error
    }
  },

  listPortForwards: async (): Promise<Array<{ localPort: number; devicePort: number; type: 'Forward' | 'Reverse' }>> => {
    try {
      const forwards = await App.ListPortForwards()
      return forwards.map(f => ({
        localPort: f.localPort,
        devicePort: f.devicePort,
        type: f.type as 'Forward' | 'Reverse'
      }))
    } catch (error) {
      // 详细记录错误信息
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined
      console.error('[HDC API] networkCapture.listPortForwards failed:', {
        message: errorMessage,
        stack: errorStack,
        error: error
      })
      // 返回空数组而不是抛出错误，避免影响 UI
      return []
    }
  },

  testConnection: async (_connectKey: string, localPort: number): Promise<ConnectionTestResult> => {
    try {
      const result = await App.TestConnection(localPort)
      return {
        success: result.success === true,
        latency: result.latency,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] networkCapture.testConnection failed:', error)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },

  closeTestConnection: async (_localPort: number): Promise<void> => {
    // TODO: 实现关闭测试连接的方法
    console.log('[HDC API] networkCapture.closeTestConnection - Not implemented yet')
  },

  // ========== 旧架构方法（保留用于兼容）==========
  startCapture: async (connectKey: string, localPort: number, devicePort: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.StartCapture(connectKey, localPort, devicePort)
      return { success: result.success === true, error: result.error }
    } catch (error) {
      console.error('[HDC API] networkCapture.startCapture failed:', error)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },

  stopCapture: async (connectKey: string): Promise<void> => {
    try {
      await App.StopCapture(connectKey)
    } catch (error) {
      console.error('[HDC API] networkCapture.stopCapture failed:', error)
    }
  },

  getCaptureStatus: async (connectKey: string): Promise<CaptureStatus> => {
    try {
      const status = await App.GetCaptureStatus(connectKey)
      return {
        isCapturing: status.isCapturing === true,
        requestCount: status.requestCount || 0,
        portForward: {
          configured: status.portForward?.configured || false,
          localPort: status.portForward?.localPort || 0,
          devicePort: status.portForward?.devicePort || 0,
          status: (status.portForward?.status || 'not_configured') as 'normal' | 'error' | 'not_configured'
        }
      }
    } catch (error) {
      console.error('[HDC API] networkCapture.getCaptureStatus failed:', error)
      return {
        isCapturing: false,
        requestCount: 0,
        portForward: {
          configured: false,
          localPort: 0,
          devicePort: 0,
          status: 'not_configured'
        }
      }
    }
  },

  getRequests: async (connectKey: string, limit?: number): Promise<NetworkRequest[]> => {
    try {
      const requests = await App.GetRequests(connectKey, limit || 0)
      return requests.map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        method: r.method,
        url: r.url,
        fullUrl: r.fullUrl,
        statusCode: r.statusCode,
        requestHeaders: r.requestHeaders,
        responseHeaders: r.responseHeaders,
        requestBody: r.requestBody,
        responseBody: r.responseBody,
        rawData: r.rawData,
        direction: r.direction as 'request' | 'response',
        extra: r.extra,
        requestParams: r.requestParams,
        baseURL: r.baseURL
      }))
    } catch (error) {
      console.error('[HDC API] networkCapture.getRequests failed:', error)
      return []
    }
  },

  clearRequests: async (connectKey: string): Promise<void> => {
    try {
      await App.ClearRequests(connectKey)
    } catch (error) {
      console.error('[HDC API] networkCapture.clearRequests failed:', error)
    }
  },

  // ========== 新架构方法（Hadice 作为 TCP 服务器）==========
  startCaptureServer: async (connectKey: string, localPort: number, devicePort: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.StartCaptureServer(connectKey, localPort, devicePort)
      if (result.success) {
        captureEvent('network capture started', { local_port: localPort, device_port: devicePort })
      }
      return { success: result.success === true, error: result.error }
    } catch (error) {
      console.error('[HDC API] networkCapture.startCaptureServer failed:', error)
      if (error instanceof Error) {
        capturePostHogException(error, { feature: 'network_capture', action: 'start_server' })
      }
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },

  stopCaptureServer: async (connectKey: string): Promise<void> => {
    try {
      await App.StopCaptureServer(connectKey)
      captureEvent('network capture stopped', {})
    } catch (error) {
      console.error('[HDC API] networkCapture.stopCaptureServer failed:', error)
    }
  },

  getCaptureServerStatus: async (connectKey: string): Promise<CaptureStatus & { sessions?: any[] }> => {
    try {
      const status = await App.GetCaptureServerStatus(connectKey)
      return {
        isCapturing: status.isCapturing === true,
        requestCount: status.requestCount || 0,
        portForward: {
          configured: status.portForward?.configured || false,
          localPort: status.portForward?.localPort || 0,
          devicePort: status.portForward?.devicePort || 0,
          status: (status.portForward?.status || 'not_configured') as 'normal' | 'error' | 'not_configured'
        },
        sessions: status.sessions
      }
    } catch (error) {
      console.error('[HDC API] networkCapture.getCaptureServerStatus failed:', error)
      return {
        isCapturing: false,
        requestCount: 0,
        portForward: {
          configured: false,
          localPort: 0,
          devicePort: 0,
          status: 'not_configured'
        }
      }
    }
  },


  onRequestReceived: (callback: (deviceId: string, request: NetworkRequest) => void): (() => void) => {
    console.log('[HDC API] 注册 networkCapture:requestReceived 事件监听')
    return EventsOn('networkCapture:requestReceived', (data: any) => {
      console.log('[HDC API] 收到 networkCapture:requestReceived 事件:', { data })
      if (data?.deviceId && data?.request) {
        callback(data.deviceId, data.request)
      }
    })
  },

  onBoundaryMarker: (callback: (deviceId: string, boundaryMarker: NetworkRequest) => void): (() => void) => {
    return EventsOn('networkCapture:boundaryMarker', (data: any) => {
      if (data?.deviceId && data?.boundaryMarker) {
        callback(data.deviceId, data.boundaryMarker)
      }
    })
  },

  onError: (callback: (deviceId: string, error: string) => void): (() => void) => {
    return EventsOn('networkCapture:error', (data: any) => {
      if (data?.deviceId && data?.error) {
        callback(data.deviceId, data.error)
      }
    })
  },

  onClosed: (callback: (deviceId: string) => void): (() => void) => {
    return EventsOn('networkCapture:closed', (data: any) => {
      if (data?.deviceId) {
        callback(data.deviceId)
      }
    })
  },

  onClientConnected: (callback: (serverDeviceId: string, clientDeviceId: string) => void): (() => void) => {
    return EventsOn('networkCapture:clientConnected', (data: any) => {
      if (data?.serverDeviceId && data?.clientDeviceId) {
        callback(data.serverDeviceId, data.clientDeviceId)
      }
    })
  },

  // ========== Android 网络抓包相关方法 ==========
  GetAndroidDebuggableApps: async (deviceId: string): Promise<any[]> => {
    try {
      const apps = await App.GetAndroidDebuggableApps(deviceId)
      return apps || []
    } catch (error) {
      console.error('[HDC API] GetAndroidDebuggableApps failed:', error)
      return []
    }
  },

  StartAndroidNetworkCapture: async (deviceId: string, packageName: string, pid: number, localPort: number): Promise<void> => {
    try {
      await App.StartAndroidNetworkCapture(deviceId, packageName, pid, localPort)
    } catch (error) {
      console.error('[HDC API] StartAndroidNetworkCapture failed:', error)
      throw new Error(getRuntimeErrorMessage(error))
    }
  },

  onAndroidAgentRestoreStarted: (callback: (data: { deviceId: string; packageName: string; pid: number }) => void): (() => void) => {
    return EventsOn('androidCapture:restoreStarted', (data: any) => {
      callback({
        deviceId: data?.deviceId || '',
        packageName: data?.packageName || '',
        pid: Number(data?.pid || 0)
      })
    })
  },

  onAndroidProcessExited: (callback: (data: { deviceId: string; packageName: string; processName: string; oldPid: number }) => void): (() => void) => {
    return EventsOn('androidCapture:processExited', (data: any) => {
      callback({
        deviceId: data?.deviceId || '',
        packageName: data?.packageName || '',
        processName: data?.processName || '',
        oldPid: Number(data?.oldPid || 0)
      })
    })
  },

  onAndroidProcessRestarting: (callback: (data: { deviceId: string; packageName: string; processName: string; oldPid: number; newPid: number }) => void): (() => void) => {
    return EventsOn('androidCapture:processRestarting', (data: any) => {
      callback({
        deviceId: data?.deviceId || '',
        packageName: data?.packageName || '',
        processName: data?.processName || '',
        oldPid: Number(data?.oldPid || 0),
        newPid: Number(data?.newPid || 0)
      })
    })
  },

  onAndroidProcessRestarted: (callback: (data: { deviceId: string; packageName: string; processName: string; oldPid: number; newPid: number }) => void): (() => void) => {
    return EventsOn('androidCapture:processRestarted', (data: any) => {
      callback({
        deviceId: data?.deviceId || '',
        packageName: data?.packageName || '',
        processName: data?.processName || '',
        oldPid: Number(data?.oldPid || 0),
        newPid: Number(data?.newPid || 0)
      })
    })
  },

  onAndroidProcessRestartFailed: (callback: (data: { deviceId: string; packageName: string; processName: string; oldPid: number; newPid: number; error: string }) => void): (() => void) => {
    return EventsOn('androidCapture:processRestartFailed', (data: any) => {
      callback({
        deviceId: data?.deviceId || '',
        packageName: data?.packageName || '',
        processName: data?.processName || '',
        oldPid: Number(data?.oldPid || 0),
        newPid: Number(data?.newPid || 0),
        error: data?.error || '未知错误'
      })
    })
  },

  PushAndroidMockConfigToClient: async (deviceId: string, packageName: string, configJson: string): Promise<void> => {
    try {
      await App.PushAndroidMockConfigToClient(deviceId, packageName, configJson)
    } catch (error) {
      console.error('[HDC API] PushAndroidMockConfigToClient failed:', error)
      throw error
    }
  },

  StopAndroidNetworkCapture: async (deviceId: string, packageName: string): Promise<void> => {
    try {
      await App.StopAndroidNetworkCapture(deviceId, packageName)
    } catch (error) {
      console.error('[HDC API] StopAndroidNetworkCapture failed:', error)
      throw error
    }
  },

  // 按包名快速查询当前 PID（单次 adb pidof，毫秒级，避免漏请求）
  // 返回 0 表示进程未在运行
  GetAndroidPidByPackageName: async (deviceId: string, packageName: string): Promise<number> => {
    try {
      return await App.GetAndroidPidByPackageName(deviceId, packageName)
    } catch (error) {
      console.error('[HDC API] GetAndroidPidByPackageName failed:', error)
      return 0
    }
  },

  // 按设备 ID 清理所有 Android 抓包会话（强制停止兜底，不依赖 packageName 匹配）
  StopAllAndroidCaptures: async (deviceId: string): Promise<number> => {
    try {
      return await App.StopAllAndroidCaptures(deviceId)
    } catch (error) {
      console.error('[HDC API] StopAllAndroidCaptures failed:', error)
      return 0
    }
  },

  GetAndroidCaptureStatus: async (deviceId: string, packageName: string): Promise<any> => {
    try {
      const status = await App.GetAndroidCaptureStatus(deviceId, packageName)
      return status || { isCapturing: false, packageName }
    } catch (error) {
      console.error('[HDC API] GetAndroidCaptureStatus failed:', error)
      return { isCapturing: false, packageName }
    }
  },

  IsAndroidDevice: async (deviceId: string): Promise<boolean> => {
    try {
      return await App.IsAndroidDevice(deviceId)
    } catch (error) {
      console.error('[HDC API] IsAndroidDevice failed:', error)
      return false
    }
  },

  GetAndroidDeviceList: async (): Promise<any[]> => {
    try {
      const devices = await App.GetAndroidDeviceList()
      return devices || []
    } catch (error) {
      console.error('[HDC API] GetAndroidDeviceList failed:', error)
      return []
    }
  },

  IsDeviceRooted: async (deviceId: string): Promise<boolean> => {
    try {
      return await App.IsDeviceRooted(deviceId)
    } catch (error) {
      console.error('[HDC API] IsDeviceRooted failed:', error)
      return false
    }
  },

  // ========== HiProfiler 抓包相关方法 ==========
  GetHiProfilerApps: async (deviceId: string): Promise<any[]> => {
    try {
      const apps = await App.GetHiProfilerApps(deviceId)
      return apps || []
    } catch (error) {
      console.error('[HDC API] GetHiProfilerApps failed:', error)
      return []
    }
  },

  StartHiProfilerCapture: async (deviceId: string, pid: number, bundleName: string, processName: string): Promise<void> => {
    try {
      await App.StartHiProfilerCapture(deviceId, pid, bundleName, processName)
    } catch (error) {
      console.error('[HDC API] StartHiProfilerCapture failed:', error)
      throw error
    }
  },

  StopHiProfilerCapture: async (deviceId: string, pid: number): Promise<void> => {
    try {
      await App.StopHiProfilerCapture(deviceId, pid)
    } catch (error) {
      console.error('[HDC API] StopHiProfilerCapture failed:', error)
      throw error
    }
  },

  StopAllHiProfilerCaptures: async (deviceId: string): Promise<number> => {
    try {
      return await App.StopAllHiProfilerCaptures(deviceId)
    } catch (error) {
      console.error('[HDC API] StopAllHiProfilerCaptures failed:', error)
      throw error
    }
  },

  GetHiProfilerCaptureStatus: async (deviceId: string): Promise<HiProfilerCaptureStatus> => {
    try {
      const status = await App.GetHiProfilerCaptureStatus(deviceId)
      return {
        state: (status?.state || 'idle') as HiProfilerCaptureStatus['state'],
        isCapturing: status?.isCapturing === true,
        deviceId,
        pid: Number(status?.pid || 0),
        bundleName: status?.bundleName || '',
        processName: status?.processName || '',
        localPort: Number(status?.localPort || 0),
        reason: status?.reason || ''
      }
    } catch (error) {
      console.error('[HDC API] GetHiProfilerCaptureStatus failed:', error)
      return { state: 'error', isCapturing: false, deviceId, reason: getRuntimeErrorMessage(error) }
    }
  },

  GetHiProfilerProcessStatus: async (deviceId: string, processName: string): Promise<{ alive: boolean; pid: number }> => {
    const status = await App.GetHiProfilerProcessStatus(deviceId, processName)
    return {
      alive: status?.alive === true,
      pid: Number(status?.pid || 0)
    }
  },

  onHiProfilerCaptureStateChanged: (callback: (status: HiProfilerCaptureStatus) => void): (() => void) => {
    return EventsOn('hiprofiler:captureStateChanged', (data: any) => {
      callback({
        state: (data?.state || 'idle') as HiProfilerCaptureStatus['state'],
        isCapturing: data?.isCapturing === true,
        deviceId: data?.deviceId || '',
        pid: Number(data?.pid || 0),
        bundleName: data?.bundleName || '',
        processName: data?.processName || '',
        reason: data?.reason || ''
      })
    })
  }
}
