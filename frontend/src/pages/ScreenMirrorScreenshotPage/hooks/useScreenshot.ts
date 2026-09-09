import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { captureEvent } from '@/lib/posthog'
import { isHdcAvailable } from '@/lib/hdc'
import type { ScreenshotInfo, ScreenshotHistoryItem } from '@/types/hdc'
import { getImageDimensions } from '../utils/format'

/**
 * 加载图片为 base64
 */
async function loadImageAsBase64(filePath: string): Promise<string | null> {
  if (!isHdcAvailable()) return null

  try {
    const base64Data = await window.hdc.readImageAsBase64(filePath)
    return base64Data
  } catch (error) {
    console.error('[Screenshot] Failed to load image:', error)
    return null
  }
}

/**
 * 截图相关 Hook
 */
export function useScreenshot(
  selectedDevice: { connectKey: string; platform?: string } | null,
  format: 'jpeg' | 'png',
  customSavePath: string | null
) {
  const [currentScreenshot, setCurrentScreenshot] = useState<ScreenshotInfo | null>(null)
  const [history, setHistory] = useState<ScreenshotHistoryItem[]>([])
  const [imageCache, setImageCache] = useState<Record<string, string>>({})
  const [imageDimensions, setImageDimensions] = useState<Record<string, { width: number; height: number }>>({})
  const [isCapturing, setIsCapturing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  /**
   * 加载图片尺寸
   */
  const loadImageDimensionsFn = useCallback(async (filePath: string, imageData: string): Promise<void> => {
    if (imageDimensions[filePath]) {
      return
    }

    try {
      const dimensions = await getImageDimensions(imageData)
      setImageDimensions((prev) => ({
        ...prev,
        [filePath]: dimensions
      }))
    } catch (error) {
      console.error('[Screenshot] Failed to load image dimensions:', error)
      setImageDimensions((prev) => ({
        ...prev,
        [filePath]: { width: 1260, height: 2720 }
      }))
    }
  }, [imageDimensions])

  /**
   * 加载截图历史（包括截图和录屏）
   */
  const loadHistory = useCallback(async () => {
    if (!isHdcAvailable()) return

    setIsLoading(true)
    try {
      const targetPath = customSavePath || undefined
      const [screenshotHistory, recordHistory] = await Promise.all([
        window.hdc.getScreenshotHistory(targetPath),
        window.hdc.getScreenRecordHistory(targetPath)
      ])

      const allHistory = [...screenshotHistory, ...recordHistory].sort((a, b) => b.timestamp - a.timestamp)
      setHistory(allHistory)

      allHistory.forEach(async (item) => {
        if (imageCache[item.localPath]) {
          return
        }

        try {
          if (item.fileName.endsWith('.mp4')) {
            const firstFrame = await window.hdc.extractVideoFirstFrame(item.localPath)
            if (firstFrame) {
              setImageCache((currentCache) => ({
                ...currentCache,
                [item.localPath]: firstFrame
              }))
            }
          } else {
            const data = await loadImageAsBase64(item.localPath)
            if (data) {
              setImageCache((currentCache) => ({
                ...currentCache,
                [item.localPath]: data
              }))
              await loadImageDimensionsFn(item.localPath, data)
            }
          }
        } catch (error) {
          console.error('[Screenshot] Error loading file:', item.localPath, error)
        }
      })
    } catch (error) {
      console.error('[Screenshot] Failed to load history:', error)
      toast.error('加载截图历史失败')
    } finally {
      setIsLoading(false)
    }
  }, [loadImageDimensionsFn, customSavePath, imageCache])

  /**
   * 截取屏幕截图
   */
  const handleCapture = useCallback(async () => {
    if (!selectedDevice || !isHdcAvailable()) return

    setIsCapturing(true)
    try {
      const targetPath = customSavePath || ''
      const result = await window.hdc.takeScreenshot(selectedDevice.connectKey, targetPath, format)

      if (result.success && result.data) {
        const screenshotData = result.data
        captureEvent('screenshot taken', {
          format,
          width: screenshotData.width,
          height: screenshotData.height,
          size: screenshotData.size,
          platform: selectedDevice.platform || 'harmony',
        })
        setCurrentScreenshot(screenshotData)

        // 立即将新截图添加到历史记录的开头
        const newHistoryItem: ScreenshotHistoryItem = {
          localPath: screenshotData.localPath,
          fileName: screenshotData.fileName,
          timestamp: screenshotData.timestamp,
          size: screenshotData.size
        }
        setHistory((prev) => {
          // 移除可能存在的相同路径项，然后将新项添加到开头
          const filtered = prev.filter((item) => item.localPath !== screenshotData.localPath)
          return [newHistoryItem, ...filtered]
        })

        try {
          const imageData = await loadImageAsBase64(screenshotData.localPath)
          if (imageData) {
            setImageCache((prev) => ({
              ...prev,
              [screenshotData.localPath]: imageData
            }))
            if (screenshotData.width > 0 && screenshotData.height > 0) {
              setImageDimensions((prev) => ({
                ...prev,
                [screenshotData.localPath]: {
                  width: screenshotData.width,
                  height: screenshotData.height
                }
              }))
            } else {
              await loadImageDimensionsFn(screenshotData.localPath, imageData)
            }
          }
        } catch (error) {
          console.error('[Screenshot] Error loading image after capture:', error)
        }

        toast.success('截图成功')
        // 异步刷新历史记录以确保数据同步
        loadHistory()
      } else {
        toast.error(result.error || '截图失败')
      }
    } catch (error) {
      console.error('[Screenshot] Capture error:', error)
      toast.error('截图失败')
    } finally {
      setIsCapturing(false)
    }
  }, [selectedDevice, format, customSavePath, loadImageDimensionsFn, loadHistory])

  /**
   * 打开文件并定位
   */
  const handleOpenFile = useCallback(async (filePath: string) => {
    if (!isHdcAvailable()) return

    try {
      const result = await window.hdc.openScreenshotFile(filePath)
      if (result.success) {
        toast.success('已打开文件')
      } else {
        toast.error(result.error || '打开失败')
      }
    } catch (error) {
      console.error('[Screenshot] Failed to open file:', error)
      toast.error('打开失败')
    }
  }, [])

  /**
   * 复制图片到剪贴板或复制文件路径
   */
  const handleCopyImage = useCallback(async (filePath: string) => {
    if (!isHdcAvailable()) {
      toast.error('HDC API 不可用')
      return
    }

    try {
      if (filePath.endsWith('.mp4')) {
        const result = await window.hdc.copyFilePathToClipboard(filePath)
        if (result.success) {
          toast.success('已复制文件路径到剪贴板')
        } else {
          toast.error(result.error || '复制文件路径失败')
        }
        return
      }

      const result = await window.hdc.copyImageToClipboard(filePath)
      if (result.success) {
        toast.success('已复制到剪贴板')
      } else {
        toast.error(result.error || '复制失败')
      }
    } catch (error) {
      console.error('[Screenshot] Copy error:', error)
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      toast.error(`复制失败: ${errorMessage}`)
    }
  }, [])

  /**
   * 放大查看（仅支持图片，视频不支持）
   */
  const handleViewImage = useCallback(async (filePath: string): Promise<string | null> => {
    if (filePath.endsWith('.mp4')) {
      return null
    }

    const imageData = imageCache[filePath] || (await loadImageAsBase64(filePath))
    return imageData
  }, [imageCache])

  /**
   * 删除单个截图
   */
  const handleDeleteScreenshot = useCallback(async (target: ScreenshotHistoryItem) => {
    if (!isHdcAvailable()) return false

    try {
      const result = await window.hdc.deleteScreenshot(target.localPath)
      if (result.success) {
        toast.success('删除成功')
        if (currentScreenshot?.localPath === target.localPath) {
          setCurrentScreenshot(null)
        }
        setImageCache((prev) => {
          const newCache = { ...prev }
          delete newCache[target.localPath]
          return newCache
        })
        setImageDimensions((prev) => {
          const newDimensions = { ...prev }
          delete newDimensions[target.localPath]
          return newDimensions
        })
        loadHistory()
        return true
      } else {
        toast.error(result.error || '删除失败')
        return false
      }
    } catch (error) {
      console.error('[Screenshot] Delete error:', error)
      toast.error('删除失败')
      return false
    }
  }, [currentScreenshot, loadHistory])

  /**
   * 设置当前截图（供录屏等外部调用）
   */
  const setCurrentScreenshotFromExternal = useCallback((info: ScreenshotInfo) => {
    setCurrentScreenshot(info)
    
    // 立即将新文件添加到历史记录的开头
    const newHistoryItem: ScreenshotHistoryItem = {
      localPath: info.localPath,
      fileName: info.fileName,
      timestamp: info.timestamp,
      size: info.size
    }
    setHistory((prev) => {
      // 移除可能存在的相同路径项，然后将新项添加到开头
      const filtered = prev.filter((item) => item.localPath !== info.localPath)
      return [newHistoryItem, ...filtered]
    })

    // 如果是视频文件，加载第一帧
    if (info.fileName.endsWith('.mp4')) {
      window.hdc.extractVideoFirstFrame(info.localPath).then((firstFrame) => {
        if (firstFrame) {
          setImageCache((prev) => ({
            ...prev,
            [info.localPath]: firstFrame
          }))
        }
      }).catch((error) => {
        console.error('[Screenshot] Error loading video first frame:', error)
      })
    } else {
      // 如果是图片文件，加载图片
      loadImageAsBase64(info.localPath).then((imageData) => {
        if (imageData) {
          setImageCache((prev) => ({
            ...prev,
            [info.localPath]: imageData
          }))
          loadImageDimensionsFn(info.localPath, imageData).catch((error) => {
            console.error('[Screenshot] Error loading image dimensions:', error)
          })
        }
      }).catch((error) => {
        console.error('[Screenshot] Error loading image:', error)
      })
    }
  }, [loadImageDimensionsFn])

  // 当路径变化时重新加载历史
  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  return {
    currentScreenshot,
    history,
    imageCache,
    imageDimensions,
    isCapturing,
    isLoading,
    handleCapture,
    handleOpenFile,
    handleCopyImage,
    handleViewImage,
    handleDeleteScreenshot,
    loadHistory,
    setCurrentScreenshotFromExternal
  }
}
