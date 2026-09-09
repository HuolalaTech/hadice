/**
 * 应用日志管理相关 API
 */

import * as App from '../../../bindings/Hadice/backend/appservice'

/**
 * 应用日志管理相关 API
 */
export const logAPI = {
  /** 打开日志文件 */
  openLogFile: async (filePath: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.OpenLogFile(filePath)
      return {
        success: result.success === true,
        error: result.error as string | undefined
      }
    } catch (error) {
      console.error('[HDC API] openLogFile failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '打开日志文件失败'
      }
    }
  },

  /** 获取日志文件路径 */
  getLogFilePath: async (): Promise<string> => {
    try {
      return await App.GetLogFilePath()
    } catch (error) {
      console.error('[HDC API] getLogFilePath failed:', error)
      return ''
    }
  }
}
