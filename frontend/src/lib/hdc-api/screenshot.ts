/**
 * 截图相关 API
 */

import * as App from '../../../bindings/Hadice/backend/appservice'
import { captureEvent } from '@/lib/posthog'
import type {
  HdcResult,
  ScreenshotResult,
  ScreenshotHistoryItem
} from '@/types/hdc'

/**
 * 截图相关 API
 */
export const screenshotAPI = {
  takeScreenshot: async (connectKey: string, targetPath?: string, format?: string): Promise<ScreenshotResult> => {
    try {
      const result = await App.TakeScreenshot(connectKey, targetPath || '', format || 'jpeg')
      if (result.success && result.data) {
        captureEvent('screenshot taken', {
          format: format || 'jpeg',
          width: result.data.width,
          height: result.data.height,
          size: result.data.size,
        })
        return {
          success: true,
          data: {
            localPath: result.data.localPath,
            fileName: result.data.fileName,
            timestamp: result.data.timestamp,
            width: result.data.width,
            height: result.data.height,
            size: result.data.size
          }
        }
      }
      return {
        success: false,
        error: result.error || '截图失败'
      }
    } catch (error) {
      console.error('[HDC API] takeScreenshot failed:', error)
      throw error
    }
  },

  getScreenshotHistory: async (targetPath?: string): Promise<ScreenshotHistoryItem[]> => {
    try {
      const history = await App.GetScreenshotHistory(targetPath || '')
      return history.map(item => ({
        localPath: item.localPath,
        fileName: item.fileName,
        timestamp: item.timestamp,
        size: item.size
      }))
    } catch (error) {
      console.error('[HDC API] getScreenshotHistory failed:', error)
      return []
    }
  },

  deleteScreenshot: async (filePath: string): Promise<HdcResult> => {
    try {
      const result = await App.DeleteScreenshot(filePath)
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] deleteScreenshot failed:', error)
      throw error
    }
  },

  clearScreenshotHistory: async (targetPath?: string): Promise<HdcResult> => {
    try {
      const result = await App.ClearScreenshotHistory(targetPath || '')
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] clearScreenshotHistory failed:', error)
      throw error
    }
  },

  openScreenshotFolder: async (targetPath?: string): Promise<HdcResult> => {
    try {
      const result = await App.OpenScreenshotFolder(targetPath || '')
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] openScreenshotFolder failed:', error)
      throw error
    }
  },

  openScreenshotFile: async (filePath: string): Promise<HdcResult> => {
    try {
      const result = await App.OpenScreenshotFile(filePath)
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] openScreenshotFile failed:', error)
      throw error
    }
  },

  getDefaultScreenshotPath: async (): Promise<string> => {
    try {
      return await App.GetDefaultScreenshotPath()
    } catch (error) {
      console.error('[HDC API] getDefaultScreenshotPath failed:', error)
      return ''
    }
  },

  readImageAsBase64: async (filePath: string): Promise<string | null> => {
    try {
      return await App.ReadImageAsBase64(filePath)
    } catch (error) {
      console.error('[HDC API] readImageAsBase64 failed:', error)
      return null
    }
  },

  /** 提取视频第一帧并返回 base64 图片数据 */
  extractVideoFirstFrame: async (videoPath: string): Promise<string | null> => {
    try {
      return await App.ExtractVideoFirstFrame(videoPath)
    } catch (error) {
      console.error('[HDC API] extractVideoFirstFrame failed:', error)
      return null
    }
  },

  copyImageToClipboard: async (filePath: string): Promise<HdcResult> => {
    try {
      const result = await App.CopyImageToClipboard(filePath)
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] copyImageToClipboard failed:', error)
      throw error
    }
  },

  copyFilePathToClipboard: async (filePath: string): Promise<HdcResult> => {
    try {
      const result = await App.CopyFilePathToClipboard(filePath)
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] copyFilePathToClipboard failed:', error)
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : '复制文件路径失败'
      }
    }
  },

  selectScreenshotPath: async (): Promise<string | null> => {
    try {
      return await App.SelectScreenshotPath()
    } catch (error) {
      console.error('[HDC API] selectScreenshotPath failed:', error)
      return null
    }
  }
}
