import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY_PREFIX = 'path-history-'
const DEVICE_DEFAULT_PATH = '/data/local/tmp'

/**
 * 路径历史记录管理 Hook
 * 用于记录和恢复输入过的文件路径
 */
export function usePathHistory(storageKey: string, initialPath: string, isDevice: boolean = false) {
  const [history, setHistory] = useState<string[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  // 从 localStorage 加载历史记录
  useEffect(() => {
    const key = `${STORAGE_KEY_PREFIX}${storageKey}`
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        const paths = JSON.parse(stored) as string[]
        setHistory(paths)
      } else {
        // 初始化默认路径
        let defaultPaths: string[] = []
        
        // 如果是设备侧，添加 /data/local/tmp 作为第一条候选项
        if (isDevice) {
          defaultPaths = [DEVICE_DEFAULT_PATH]
          if (initialPath && initialPath !== DEVICE_DEFAULT_PATH) {
            defaultPaths.push(initialPath)
          }
        } else if (initialPath) {
          defaultPaths = [initialPath]
        }
        
        if (defaultPaths.length > 0) {
          setHistory(defaultPaths)
        }
      }
    } catch (error) {
      console.error('[usePathHistory] Failed to load history:', error)
      // 加载失败时，设置默认的候选路径
      let defaultPaths: string[] = []
      if (isDevice) {
        defaultPaths = [DEVICE_DEFAULT_PATH]
        if (initialPath && initialPath !== DEVICE_DEFAULT_PATH) {
          defaultPaths.push(initialPath)
        }
      } else if (initialPath) {
        defaultPaths = [initialPath]
      }
      if (defaultPaths.length > 0) {
        setHistory(defaultPaths)
      }
    }
    setIsLoaded(true)
  }, [storageKey, initialPath, isDevice])

  // 添加路径到历史记录
  const addToHistory = useCallback((path: string) => {
    if (!path || !path.trim()) return

    setHistory((prev) => {
      // 如果路径已经存在，移到最前面
      const filtered = prev.filter((p) => p !== path)
      const updated = [path, ...filtered].slice(0, 20) // 最多保存 20 条记录

      // 保存到 localStorage
      const key = `${STORAGE_KEY_PREFIX}${storageKey}`
      try {
        localStorage.setItem(key, JSON.stringify(updated))
      } catch (error) {
        console.error('[usePathHistory] Failed to save history:', error)
      }

      return updated
    })
  }, [storageKey])

  // 清空历史记录
  const clearHistory = useCallback(() => {
    setHistory([])
    const key = `${STORAGE_KEY_PREFIX}${storageKey}`
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.error('[usePathHistory] Failed to clear history:', error)
    }
  }, [storageKey])

  // 从历史中移除特定路径
  const removeFromHistory = useCallback((path: string) => {
    setHistory((prev) => {
      const updated = prev.filter((p) => p !== path)
      const key = `${STORAGE_KEY_PREFIX}${storageKey}`
      try {
        localStorage.setItem(key, JSON.stringify(updated))
      } catch (error) {
        console.error('[usePathHistory] Failed to save history:', error)
      }
      return updated
    })
  }, [storageKey])

  return {
    history,
    isLoaded,
    addToHistory,
    clearHistory,
    removeFromHistory
  }
}
