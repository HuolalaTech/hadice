import { useState, useCallback, useEffect } from 'react'
import { isHdcAvailable } from '@/lib/hdc'

/**
 * 保存路径管理 Hook
 */
export function useSavePath() {
  const [savePath, setSavePath] = useState<string>('')
  const [customSavePath, setCustomSavePath] = useState<string | null>(null)

  /**
   * 获取默认保存路径
   */
  const loadDefaultPath = useCallback(async () => {
    if (!isHdcAvailable()) return

    try {
      const path = await window.hdc.getDefaultScreenshotPath()
      setSavePath(path)
    } catch (error) {
      console.error('[Screenshot] Failed to get default path:', error)
    }
  }, [])

  /**
   * 从 localStorage 加载保存的自定义路径
   */
  const loadSavedCustomPath = useCallback(() => {
    try {
      const savedPath = localStorage.getItem('screenshot-custom-save-path')
      if (savedPath) {
        setCustomSavePath(savedPath)
        setSavePath(savedPath)
        return savedPath
      }
    } catch (error) {
      console.error('[Screenshot] Failed to load saved custom path:', error)
    }
    return null
  }, [])

  /**
   * 保存自定义路径到 localStorage
   */
  const saveCustomPath = useCallback((path: string | null) => {
    try {
      if (path) {
        localStorage.setItem('screenshot-custom-save-path', path)
      } else {
        localStorage.removeItem('screenshot-custom-save-path')
      }
    } catch (error) {
      console.error('[Screenshot] Failed to save custom path:', error)
    }
  }, [])

  // 初始化
  useEffect(() => {
    const savedPath = loadSavedCustomPath()
    if (!savedPath) {
      loadDefaultPath()
    }
  }, [loadDefaultPath, loadSavedCustomPath])

  return {
    savePath,
    customSavePath,
    setSavePath,
    setCustomSavePath,
    saveCustomPath
  }
}






