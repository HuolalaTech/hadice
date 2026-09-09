import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { isHdcAvailable } from '@/lib/hdc'
import type { ScreenshotInfo } from '@/types/hdc'
import { captureEvent } from '@/lib/posthog'

/**
 * 录屏相关 Hook
 */
export function useScreenRecord(
  selectedDevice: { connectKey: string; platform?: string } | null,
  customSavePath: string | null,
  onRecordComplete?: (info: ScreenshotInfo) => void,
  onHistoryReload?: () => void
) {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingFileName, setRecordingFileName] = useState<string | null>(null)

  /**
   * 开始录屏
   */
  const handleStartRecord = useCallback(async () => {
    if (!selectedDevice || !isHdcAvailable()) return

    setIsRecording(true)
    try {
      const result = await window.hdc.startScreenRecord(selectedDevice.connectKey)
      if (result.success && result.fileName) {
        setRecordingFileName(result.fileName)
        captureEvent('screen recording started', { platform: selectedDevice.platform || 'harmony' })
        toast.success('录屏已开始')
      } else {
        toast.error(result.error || '启动录屏失败')
        setIsRecording(false)
        setRecordingFileName(null)
      }
    } catch (error) {
      console.error('[ScreenRecord] Start error:', error)
      toast.error('启动录屏失败')
      setIsRecording(false)
      setRecordingFileName(null)
    }
  }, [selectedDevice])

  /**
   * 停止录屏
   */
  const handleStopRecord = useCallback(async () => {
    if (!selectedDevice || !isHdcAvailable() || !recordingFileName) return

    try {
      const stopResult = await window.hdc.stopScreenRecord(selectedDevice.connectKey)
      if (!stopResult.success) {
        toast.error(stopResult.error || '停止录屏失败')
        return
      }

      toast.success('录屏已停止，正在处理文件...')
      setIsRecording(false)

      await new Promise((resolve) => setTimeout(resolve, 2000))

      const queryResult = await window.hdc.queryScreenRecordFile(
        selectedDevice.connectKey,
        recordingFileName,
        30,
        2
      )

      if (!queryResult.success) {
        toast.error(queryResult.error || '查询录屏文件失败')
        setRecordingFileName(null)
        return
      }

      const copyResult = await window.hdc.copyScreenRecordFileToTmp(
        selectedDevice.connectKey,
        queryResult.uri || '',
        queryResult.filePath || '',
        recordingFileName
      )

      if (!copyResult.success || !copyResult.filePath) {
        toast.error(copyResult.error || '复制录屏文件失败')
        setRecordingFileName(null)
        return
      }

      const deviceTmpFilePath = copyResult.filePath
      const targetPath = customSavePath || ''
      const downloadResult = await window.hdc.downloadScreenRecordFile(
        selectedDevice.connectKey,
        deviceTmpFilePath,
        targetPath,
        recordingFileName
      )

      if (downloadResult.success && downloadResult.data) {
        const recordInfo = downloadResult.data
        const recordInfoWithDimensions = {
          ...recordInfo,
          width: 0,
          height: 0
        }
        if (onRecordComplete) {
          onRecordComplete(recordInfoWithDimensions)
        }
        captureEvent('screen recording stopped', { file_name: recordingFileName, platform: selectedDevice.platform || 'harmony' })
        toast.success('录屏文件已保存')
        if (onHistoryReload) {
          onHistoryReload()
        }
      } else {
        toast.error(downloadResult.error || '下载录屏文件失败')
      }

      setRecordingFileName(null)
    } catch (error) {
      console.error('[ScreenRecord] Stop error:', error)
      toast.error('停止录屏失败')
      setIsRecording(false)
      setRecordingFileName(null)
    }
  }, [selectedDevice, recordingFileName, customSavePath, onRecordComplete, onHistoryReload])

  return {
    isRecording,
    recordingFileName,
    handleStartRecord,
    handleStopRecord
  }
}






