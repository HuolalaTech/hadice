/**
 * 文件传输相关 API
 */

import * as App from '../../../bindings/Hadice/backend/appservice'
import { captureEvent } from '@/lib/posthog'
import type {
  HdcResult,
  DirectoryListResult
} from '@/types/hdc'

/**
 * 文件传输相关 API
 */
export const fileTransferAPI = {
  listDeviceDirectory: async (connectKey: string, path: string, platform: string): Promise<DirectoryListResult> => {
    try {
      const result = await App.ListDeviceDirectory(connectKey, path, platform)
      if (result.success) {
        return {
          success: true,
          items: (result.items as any[]).map((item: any) => ({
            name: item.name,
            path: item.path,
            isDirectory: item.isDirectory,
            size: item.size,
            modifiedTime: item.modifiedTime,
            permissions: item.permissions
          }))
        }
      }
      return {
        success: false,
        error: result.error as string
      }
    } catch (error: any) {
      console.error('[HDC API] listDeviceDirectory failed:', error)
      return {
        success: false,
        error: error.message
      }
    }
  },

  listLocalDirectory: async (path: string): Promise<DirectoryListResult> => {
    try {
      const result = await App.ListLocalDirectory(path)
      if (result.success) {
        return {
          success: true,
          items: (result.items as any[]).map((item: any) => ({
            name: item.name,
            path: item.path,
            isDirectory: item.isDirectory,
            size: item.size,
            modifiedTime: item.modifiedTime,
            permissions: item.permissions
          }))
        }
      }
      return {
        success: false,
        error: result.error as string
      }
    } catch (error: any) {
      console.error('[HDC API] listLocalDirectory failed:', error)
      return {
        success: false,
        error: error.message
      }
    }
  },

  pushFileToDevice: async (connectKey: string, localPath: string, devicePath: string, platform: string): Promise<HdcResult> => {
    try {
      const result = await App.PushFileToDevice(connectKey, localPath, devicePath, platform)
      if (result.success) {
        captureEvent('file pushed to device', { device_path: devicePath })
      }
      return result
    } catch (error: any) {
      console.error('[HDC API] pushFileToDevice failed:', error)
      return {
        success: false,
        output: '',
        error: error.message
      }
    }
  },

  pullFileFromDevice: async (connectKey: string, devicePath: string, localPath: string, platform: string): Promise<HdcResult> => {
    try {
      const result = await App.PullFileFromDevice(connectKey, devicePath, localPath, platform)
      if (result.success) {
        captureEvent('file pulled from device', { device_path: devicePath })
      }
      return result
    } catch (error: any) {
      console.error('[HDC API] pullFileFromDevice failed:', error)
      return {
        success: false,
        output: '',
        error: error.message
      }
    }
  },

  getUserHomeDirectory: async (): Promise<string> => {
    try {
      return await App.GetUserHomeDirectory()
    } catch (error: any) {
      console.error('[HDC API] getUserHomeDirectory failed:', error)
      return '/Users/mock'
    }
  },

  getUserDownloadsDirectory: async (): Promise<string> => {
    try {
      return await App.GetUserDownloadsDirectory()
    } catch (error: any) {
      console.error('[HDC API] getUserDownloadsDirectory failed:', error)
      const home = await fileTransferAPI.getUserHomeDirectory()
      return `${home}/Downloads`
    }
  },

  getUserDocumentsDirectory: async (): Promise<string> => {
    try {
      return await App.GetUserDocumentsDirectory()
    } catch (error: any) {
      console.error('[HDC API] getUserDocumentsDirectory failed:', error)
      const home = await fileTransferAPI.getUserHomeDirectory()
      return `${home}/Documents`
    }
  },

  openFileInSystem: async (filePath: string): Promise<HdcResult> => {
    try {
      return await App.OpenFileInSystem(filePath)
    } catch (error: any) {
      console.error('[HDC API] openFileInSystem failed:', error)
      return {
        success: false,
        output: '',
        error: error.message
      }
    }
  },

  getFileInfo: async (filePath: string): Promise<{ success: boolean; size?: number; modifiedTime?: number; error?: string }> => {
    try {
      const info = await App.GetFileInfo(filePath)
      if (info.success && info.data) {
        const data = info.data as { size?: number; modifiedTime?: number }
        return {
          success: true,
          size: data.size,
          modifiedTime: data.modifiedTime,
        }
      }
      return {
        success: false,
        error: info.error as string | undefined || '获取文件信息失败'
      }
    } catch (error) {
      console.error('[HDC API] getFileInfo failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取文件信息失败'
      }
    }
  },

  deleteLocalFile: async (filePath: string): Promise<HdcResult> => {
    try {
      return await App.DeleteLocalFile(filePath)
    } catch (error: any) {
      console.error('[HDC API] deleteLocalFile failed:', error)
      return {
        success: false,
        output: '',
        error: error.message
      }
    }
  },

  deleteDeviceFile: async (connectKey: string, filePath: string, platform: string): Promise<HdcResult> => {
    try {
      return await App.DeleteDeviceFile(connectKey, filePath, platform)
    } catch (error: any) {
      console.error('[HDC API] deleteDeviceFile failed:', error)
      return {
        success: false,
        output: '',
        error: error.message
      }
    }
  }
}