/**
 * 录屏相关 API
 */

import * as App from '../../../bindings/Hadice/backend/appservice'
import type {
  HdcResult,
  ScreenshotResult,
  ScreenshotHistoryItem
} from '@/types/hdc'

/**
 * 录屏相关 API
 */
export const screenRecordAPI = {
  startScreenRecord: async (connectKey: string): Promise<{ success: boolean; fileName?: string; error?: string }> => {
    try {
      const result = await App.StartScreenRecord(connectKey)
      return {
        success: result.success === true,
        fileName: result.fileName as string | undefined,
        error: result.error as string | undefined
      }
    } catch (error) {
      console.error('[HDC API] startScreenRecord failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '启动录屏失败'
      }
    }
  },

  stopScreenRecord: async (connectKey: string): Promise<HdcResult> => {
    try {
      const result = await App.StopScreenRecord(connectKey)
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] stopScreenRecord failed:', error)
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : '停止录屏失败'
      }
    }
  },

  queryScreenRecordFile: async (connectKey: string, fileName: string, maxWaitTime: number, checkInterval: number): Promise<{ success: boolean; uri?: string; filePath?: string; error?: string }> => {
    try {
      const result = await App.QueryScreenRecordFile(connectKey, fileName, maxWaitTime, checkInterval)
      return {
        success: result.success === true,
        uri: result.uri as string | undefined,
        filePath: result.filePath as string | undefined,
        error: result.error as string | undefined
      }
    } catch (error) {
      console.error('[HDC API] queryScreenRecordFile failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '查询录屏文件失败'
      }
    }
  },

  copyScreenRecordFileToTmp: async (connectKey: string, uri: string, originalPath: string, fileName: string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    try {
      const result = await App.CopyScreenRecordFileToTmp(connectKey, uri, originalPath, fileName)
      return {
        success: result.success === true,
        filePath: result.filePath as string | undefined,
        error: result.error as string | undefined
      }
    } catch (error) {
      console.error('[HDC API] copyScreenRecordFileToTmp failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '复制录屏文件失败'
      }
    }
  },

  downloadScreenRecordFile: async (connectKey: string, devicePath: string, savePath: string, fileName: string): Promise<ScreenshotResult> => {
    try {
      const result = await App.DownloadScreenRecordFile(connectKey, devicePath, savePath, fileName)
      if (result.success && result.data) {
        return {
          success: true,
          data: {
            localPath: result.data.localPath as string,
            fileName: result.data.fileName as string,
            timestamp: result.data.timestamp as number,
            width: 0, // 视频文件没有宽高
            height: 0,
            size: result.data.size as number
          }
        }
      }
      return {
        success: false,
        error: result.error as string || '下载录屏文件失败'
      }
    } catch (error) {
      console.error('[HDC API] downloadScreenRecordFile failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '下载录屏文件失败'
      }
    }
  },

  getScreenRecordHistory: async (targetPath?: string): Promise<ScreenshotHistoryItem[]> => {
    try {
      const history = await App.GetScreenRecordHistory(targetPath || '')
      return history.map(item => ({
        localPath: item.localPath as string,
        fileName: item.fileName as string,
        timestamp: item.timestamp as number,
        size: item.size as number
      }))
    } catch (error) {
      console.error('[HDC API] getScreenRecordHistory failed:', error)
      return []
    }
  }
}
