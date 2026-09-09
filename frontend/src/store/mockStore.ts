import { create } from 'zustand'
import type { MockConfig } from '@/types/hdc'
import * as App from '../../bindings/Hadice/backend/appservice.js'

interface MockState {
  /** Mock 配置 */
  config: MockConfig

  /**
   * 设置 Mock 配置
   */
  setConfig: (config: MockConfig) => void

  /**
   * 推送Mock配置到Sophon客户端
   */
  pushConfigToClient: (deviceId: string) => Promise<void>
}

/**
 * Mock 状态管理 Store
 */
export const useMockStore = create<MockState>((set, get) => ({
  config: {
    enabled: false,
    rules: []
  },

  setConfig: (config: MockConfig) => {
    set({ config })
    // 保存到本地存储
    try {
      localStorage.setItem('mock-config', JSON.stringify(config))
    } catch (error) {
      console.error('[MockStore] 保存配置失败:', error)
    }

    // ✅ 配置更新时,推送到所有正在抓包的设备
    try {
      const { pushConfigToClient } = get()
      // 动态导入networkCaptureStore避免循环依赖
      import('./networkCaptureStore').then(({ useNetworkCaptureStore }) => {
        const deviceStates = useNetworkCaptureStore.getState().deviceStates
        // 遍历所有正在抓包的设备
        deviceStates.forEach((state, deviceId) => {
          if (state.isCapturing) {
            console.log(`[MockStore] 配置已更新,推送到抓包设备: ${deviceId}`)
            pushConfigToClient(deviceId).catch(err => {
              console.error(`[MockStore] 推送配置到设备 ${deviceId} 失败:`, err)
            })
          }
        })
      })
    } catch (error) {
      console.error('[MockStore] 推送配置到抓包设备失败:', error)
    }
  },

  // ✅ 新增：推送到Sophon客户端
  pushConfigToClient: async (deviceId: string) => {
    try {
      const { config } = get()
      console.log('[MockStore] 准备推送配置到设备:', deviceId, '配置:', config)
      await App.PushMockConfigToClient(deviceId, JSON.stringify(config))
      console.log('[MockStore] 配置已成功推送到设备:', deviceId)
    } catch (error) {
      console.error('[MockStore] 推送配置到设备失败:', deviceId, error)
      throw error
    }
  }
}))

// 从本地存储加载配置
try {
  const savedConfig = localStorage.getItem('mock-config')
  if (savedConfig) {
    const config = JSON.parse(savedConfig) as MockConfig
    useMockStore.getState().setConfig(config)
  }
} catch (error) {
  console.error('[MockStore] 加载配置失败:', error)
}



