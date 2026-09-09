/**
 * 设备管理相关 API
 */

import * as App from '../../../bindings/Hadice/backend/appservice'
import type {
  HdcDevice,
  HdcResult,
  DeviceDetailInfo,
  BatteryInfo,
  MemoryInfo,
  StorageInfo,
  CpuUsageInfo,
  NetworkInfo,
  SystemRuntime,
  SystemProperties,
  Platform
} from '@/types/hdc'

/**
 * 设备管理相关 API
 */
export const deviceAPI = {
  /** 获取设备列表（基础信息） */
  listDevices: async (verbose?: boolean): Promise<HdcDevice[]> => {
    try {
      const devices = await App.ListDevices(verbose || false)
      return devices.map(d => ({
        connectKey: d.connectKey,
        connectionType: d.connectionType as 'USB' | 'TCP',
        status: d.status as 'Connected' | 'Offline' | 'Unauthorized' | 'Unknown',
        deviceName: d.deviceName,
        productName: d.productName,
        model: d.model,
        displayName: d.displayName
      }))
    } catch (error) {
      console.error('[HDC API] listDevices failed:', error)
      throw error
    }
  },

  /** 获取设备列表（包含产品名称、型号等） */
  listDevicesWithInfo: async (): Promise<HdcDevice[]> => {
    try {
      const devices = await App.ListDevicesWithInfo()
      return devices.map(d => ({
        connectKey: d.connectKey,
        connectionType: d.connectionType as 'USB' | 'TCP',
        status: d.status as 'Connected' | 'Offline' | 'Unauthorized' | 'Unknown',
        deviceName: d.deviceName,
        productName: d.productName,
        model: d.model,
        displayName: d.displayName
      }))
    } catch (error) {
      console.error('[HDC API] listDevicesWithInfo failed:', error)
      throw error
    }
  },

  /** 等待设备连接 */
  waitForDevice: async (connectKey?: string): Promise<HdcResult> => {
    try {
      const result = await App.WaitForDevice(connectKey || '')
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] waitForDevice failed:', error)
      throw error
    }
  },

  /** 获取 HDC 版本 */
  getVersion: async (): Promise<string> => {
    try {
      const version = await App.GetHdcVersion()
      return version
    } catch (error) {
      console.error('[HDC API] ❌ getVersion 失败')
      console.error('[HDC API] 错误详情:', {
        message: error instanceof Error ? error.message : '未知错误',
        stack: error instanceof Error ? error.stack : undefined,
        error
      })
      return 'Unknown'
    }
  },

  /** 检查服务状态 */
  checkServer: async (): Promise<{ client: string; server: string }> => {
    try {
      const info = await App.CheckServer()
      const result = {
        client: info.client || 'Unknown',
        server: info.server || 'Unknown'
      }
      console.log('[HDC API] Client 版本:', result.client)
      console.log('[HDC API] Server 版本:', result.server)
      if (result.client === 'Unknown') {
        console.warn('[HDC API] ⚠️ 无法检测到 Client 版本')
      }
      return result
    } catch (error) {
      console.error('[HDC API] 错误详情:', {
        message: error instanceof Error ? error.message : '未知错误',
        stack: error instanceof Error ? error.stack : undefined,
        error
      })
      return { client: 'Unknown', server: 'Unknown' }
    }
  },

  /** 启动服务 */
  startServer: async (): Promise<HdcResult> => {
    try {
      const result = await App.StartServer()
      const hdcResult = {
        success: result.success,
        output: result.output,
        error: result.error
      }
      if (hdcResult.success) {
        console.log('[HDC API] ✅ startServer 成功')
      } else {
        console.error('[HDC API] ❌ startServer 失败:', hdcResult.error)
      }
      return hdcResult
    } catch (error) {
      console.error('[HDC API] ❌ startServer 异常')
      console.error('[HDC API] 错误详情:', {
        message: error instanceof Error ? error.message : '未知错误',
        stack: error instanceof Error ? error.stack : undefined,
        error
      })
      throw error
    }
  },

  /** 终止服务 */
  killServer: async (): Promise<HdcResult> => {
    try {
      const result = await App.KillServer()
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] killServer failed:', error)
      throw error
    }
  },

  /** 重启服务 */
  restartServer: async (): Promise<HdcResult> => {
    try {
      const result = await App.RestartServer()
      const hdcResult = {
        success: result.success,
        output: result.output,
        error: result.error
      }
      console.log('[HDC API] RestartServer 返回结果:', hdcResult)
      if (hdcResult.success) {
        console.log('[HDC API] ✅ restartServer 成功')
      } else {
        console.error('[HDC API] ❌ restartServer 失败:', hdcResult.error)
      }
      return hdcResult
    } catch (error) {
      console.error('[HDC API] ❌ restartServer 异常')
      console.error('[HDC API] 错误详情:', {
        message: error instanceof Error ? error.message : '未知错误',
        stack: error instanceof Error ? error.stack : undefined,
        error
      })
      throw error
    }
  },

  /** TCP 连接设备 */
  connect: async (ipPort: string): Promise<HdcResult> => {
    try {
      const result = await App.ConnectDevice(ipPort)
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] connect failed:', error)
      throw error
    }
  },

  /** 断开 TCP 连接 */
  disconnect: async (ipPort: string): Promise<HdcResult> => {
    try {
      const result = await App.DisconnectDevice(ipPort)
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] disconnect failed:', error)
      throw error
    }
  },

  /** 获取设备属性 */
  getDeviceProperty: async (connectKey: string, property: string): Promise<string> => {
    try {
      return await App.GetDeviceProperty(connectKey, property)
    } catch (error) {
      console.error('[HDC API] getDeviceProperty failed:', error)
      return ''
    }
  },

  /** 获取设备基本信息（产品名称和型号） */
  getDeviceInfo: async (connectKey: string): Promise<{ productName: string; model: string }> => {
    try {
      const info = await App.GetDeviceInfo(connectKey)
      return {
        productName: info.productName,
        model: info.model
      }
    } catch (error) {
      console.error('[HDC API] getDeviceInfo failed:', error)
      return { productName: '', model: '' }
    }
  },

  /** 获取设备完整详细信息（带 platform 参数） */
  getDeviceDetailInfo: async (connectKey: string, platform?: Platform): Promise<DeviceDetailInfo> => {
    try {
      if (platform) {
        const info = await App.GetDeviceDetailInfoByPlatform(connectKey, platform)
        return {
          productName: info.productName || 'Unknown',
          model: info.model || 'Unknown',
          brand: info.brand || 'Unknown',
          manufacturer: info.manufacturer || 'Unknown',
          deviceType: info.deviceType || 'Unknown',
          serialNumber: info.serialNumber || connectKey,
          osName: info.osName || 'Unknown',
          osVersion: info.osVersion || 'Unknown',
          apiVersion: info.apiVersion || 'Unknown',
          softwareVersion: info.softwareVersion || 'Unknown',
          ohosFullName: (info as any).ohosFullName || '',
          securityPatch: info.securityPatch || 'Unknown',
          kernelVersion: info.kernelVersion || 'Unknown',
          cpuAbi: info.cpuAbi || 'Unknown',
          hardwareVersion: info.hardwareVersion || 'Unknown'
        }
      }
      const info = await App.GetDeviceDetailInfo(connectKey)
      return {
        productName: info.productName || 'Unknown',
        model: info.model || 'Unknown',
        brand: info.brand || 'Unknown',
        manufacturer: info.manufacturer || 'Unknown',
        deviceType: info.deviceType || 'Unknown',
        serialNumber: info.serialNumber || connectKey,
        osName: info.osName || 'Unknown',
        osVersion: info.osVersion || 'Unknown',
        apiVersion: info.apiVersion || 'Unknown',
        softwareVersion: info.softwareVersion || 'Unknown',
        ohosFullName: info.ohosFullName || '',
        securityPatch: info.securityPatch || 'Unknown',
        kernelVersion: info.kernelVersion || 'Unknown',
        cpuAbi: info.cpuAbi || 'Unknown',
        hardwareVersion: info.hardwareVersion || 'Unknown'
      }
    } catch (error) {
      console.error('[HDC API] getDeviceDetailInfo failed:', error)
      throw error
    }
  },

  /** 获取电池信息（带 platform 参数） */
  getBatteryInfo: async (connectKey: string, platform?: Platform): Promise<BatteryInfo> => {
    try {
      if (platform) {
        const info = await App.GetBatteryInfoByPlatform(connectKey, platform)
        return {
          capacity: info.capacity,
          temperature: info.temperature,
          voltage: info.voltage,
          chargingStatus: info.chargingStatus as BatteryInfo['chargingStatus'],
          pluggedType: info.pluggedType as BatteryInfo['pluggedType'],
          technology: info.technology,
          health: info.health as BatteryInfo['health']
        }
      }
      const info = await App.GetBatteryInfo(connectKey)
      return {
        capacity: info.capacity,
        temperature: info.temperature,
        voltage: info.voltage,
        chargingStatus: info.chargingStatus as BatteryInfo['chargingStatus'],
        pluggedType: info.pluggedType as BatteryInfo['pluggedType'],
        technology: info.technology,
        health: info.health as BatteryInfo['health']
      }
    } catch (error) {
      console.error('[HDC API] getBatteryInfo failed:', error)
      throw error
    }
  },

  /** 获取内存信息（带 platform 参数） */
  getMemoryInfo: async (connectKey: string, platform?: Platform): Promise<MemoryInfo> => {
    try {
      if (platform) {
        const info = await App.GetMemoryInfoByPlatform(connectKey, platform)
        return {
          total: info.total,
          free: info.free,
          available: info.available,
          cached: info.cached,
          usedPercent: info.usedPercent
        }
      }
      const info = await App.GetMemoryInfo(connectKey)
      return {
        total: info.total,
        free: info.free,
        available: info.available,
        cached: info.cached,
        usedPercent: info.usedPercent
      }
    } catch (error) {
      console.error('[HDC API] getMemoryInfo failed:', error)
      throw error
    }
  },

  /** 获取存储信息（带 platform 参数） */
  getStorageInfo: async (connectKey: string, platform?: Platform): Promise<StorageInfo> => {
    try {
      if (platform) {
        const info = await App.GetStorageInfoByPlatform(connectKey, platform)
        return {
          total: info.total,
          used: info.used,
          available: info.available,
          usedPercent: info.usedPercent,
          mountPoint: info.mountPoint
        }
      }
      const info = await App.GetStorageInfo(connectKey)
      return {
        total: info.total,
        used: info.used,
        available: info.available,
        usedPercent: info.usedPercent,
        mountPoint: info.mountPoint
      }
    } catch (error) {
      console.error('[HDC API] getStorageInfo failed:', error)
      throw error
    }
  },

  /** 获取 CPU 使用信息（带 platform 参数） */
  getCpuUsageInfo: async (connectKey: string, platform?: Platform): Promise<CpuUsageInfo> => {
    try {
      if (platform) {
        const info = await App.GetCpuUsageInfoByPlatform(connectKey, platform)
        return {
          usagePercent: info.usagePercent,
          user: info.user,
          system: info.system,
          idle: info.idle
        }
      }
      const info = await App.GetCpuUsageInfo(connectKey)
      return {
        usagePercent: info.usagePercent,
        user: info.user,
        system: info.system,
        idle: info.idle
      }
    } catch (error) {
      console.error('[HDC API] getCpuUsageInfo failed:', error)
      throw error
    }
  },

  /** 获取网络信息（带 platform 参数） */
  getNetworkInfo: async (connectKey: string, platform?: Platform): Promise<NetworkInfo[]> => {
    try {
      if (platform) {
        const networks = await App.GetNetworkInfoByPlatform(connectKey, platform)
        return networks.map(n => ({
          interface: n.interface,
          ipAddress: n.ipAddress,
          macAddress: n.macAddress,
          netmask: n.netmask
        }))
      }
      const networks = await App.GetNetworkInfo(connectKey)
      return networks.map(n => ({
        interface: n.interface,
        ipAddress: n.ipAddress,
        macAddress: n.macAddress,
        netmask: n.netmask
      }))
    } catch (error) {
      console.error('[HDC API] getNetworkInfo failed:', error)
      throw error
    }
  },

  /** 获取系统运行信息（带 platform 参数） */
  getSystemRuntime: async (connectKey: string, platform?: Platform): Promise<SystemRuntime> => {
    try {
      if (platform) {
        const runtime = await App.GetSystemRuntimeByPlatform(connectKey, platform)
        return {
          uptime: runtime.uptime,
          loadAverage: runtime.loadAverage,
          currentTime: runtime.currentTime
        }
      }
      const runtime = await App.GetSystemRuntime(connectKey)
      return {
        uptime: runtime.uptime,
        loadAverage: runtime.loadAverage,
        currentTime: runtime.currentTime
      }
    } catch (error) {
      console.error('[HDC API] getSystemRuntime failed:', error)
      throw error
    }
  },

  /** 获取所有系统属性（带 platform 参数） */
  getSystemProperties: async (connectKey: string, platform?: Platform): Promise<SystemProperties> => {
    try {
      if (platform) {
        const props = await App.GetSystemPropertiesByPlatform(connectKey, platform)
        return props as SystemProperties
      }
      const props = await App.GetSystemProperties(connectKey)
      return props as SystemProperties
    } catch (error) {
      console.error('[HDC API] getSystemProperties failed:', error)
      return {}
    }
  },

  /** 获取设备唯一标识（带 platform 参数） */
  getDeviceUdid: async (connectKey: string, platform?: Platform): Promise<string> => {
    try {
      if (platform) {
        return await App.GetDeviceUdidByPlatform(connectKey, platform)
      }
      return await App.GetDeviceUdid(connectKey)
    } catch (error) {
      console.error('[HDC API] getDeviceUdid failed:', error)
      return ''
    }
  },

  /** 执行任意 HDC 命令 */
  execute: async (args: string[]): Promise<HdcResult> => {
    try {
      const result = await App.ExecuteHdc(args)
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] execute failed:', error)
      throw error
    }
  },

  /** 获取安卓设备应用列表 */
  getAndroidAppList: async (connectKey: string): Promise<{ apps: Array<{ packageName: string; appName: string; pid: number; isSystemApp: boolean; isRunning: boolean }> }> => {
    try {
      const result = await App.GetAndroidAppList(connectKey)
      return {
        apps: (result.apps || []).map((app: any) => ({
          packageName: app.packageName,
          appName: app.appName,
          pid: app.pid || 0,
          isSystemApp: app.isSystemApp,
          isRunning: app.isRunning
        }))
      }
    } catch (error) {
      console.error('[HDC API] getAndroidAppList failed:', error)
      return { apps: [] }
    }
  }
}
