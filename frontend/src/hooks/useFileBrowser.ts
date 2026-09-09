import { useState, useEffect, useCallback, useRef } from 'react'
import { isHdcAvailable } from '@/lib/hdc'
import { usePathHistory } from './usePathHistory'
import type { FileItem } from '@/types/hdc'
import type { HdcDevice, Platform } from '@/types/hdc'

const ANDROID_DEFAULT_PATH = '/storage/emulated/0'
const HARMONYOS_DEFAULT_PATH = '/storage/media/100/local/files/Docs'

/**
 * 文件浏览器 Hook（用于设备或本地文件系统）
 */
export function useFileBrowser(
  isDevice: boolean,
  selectedDevice: HdcDevice | null,
  platform: Platform | string,
  initialPath?: string
) {
  const getDefaultPath = useCallback(() => {
    if (!isDevice) return ''
    if (platform === 'android') return ANDROID_DEFAULT_PATH
    return HARMONYOS_DEFAULT_PATH
  }, [isDevice, platform])

  const [path, setPath] = useState(initialPath || getDefaultPath())
  const [pathInput, setPathInput] = useState(initialPath || getDefaultPath())
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())

  const scrollPositions = useRef<Map<string, number>>(new Map())
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  const storageKey = isDevice ? `device-${selectedDevice?.connectKey}` : 'local'
  const { history, addToHistory, removeFromHistory } = usePathHistory(storageKey, initialPath || getDefaultPath(), isDevice)

  useEffect(() => {
    setPathInput(path)
  }, [path])

  const loadDirectory = useCallback(async () => {
    if (isDevice) {
      if (!selectedDevice || !isHdcAvailable()) {
        return
      }
      setLoading(true)
      setError(null)
      try {
        const result = await window.hdc.listDeviceDirectory(selectedDevice.connectKey, path, platform)
        if (result.success && result.items) {
          setFiles(result.items)
          setTimeout(() => {
            const savedPosition = scrollPositions.current.get(path)
            if (savedPosition !== undefined && scrollAreaRef.current) {
              const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
              if (viewport) {
                viewport.scrollTop = savedPosition
              }
            }
          }, 50)
        } else {
          setError(result.error || '加载失败')
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : '加载失败')
      } finally {
        setLoading(false)
      }
    } else {
      if (!isHdcAvailable() || !path) {
        return
      }
      setLoading(true)
      setError(null)
      try {
        const result = await window.hdc.listLocalDirectory(path)
        if (result.success && result.items) {
          setFiles(result.items)
          setTimeout(() => {
            const savedPosition = scrollPositions.current.get(path)
            if (savedPosition !== undefined && scrollAreaRef.current) {
              const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
              if (viewport) {
                viewport.scrollTop = savedPosition
              }
            }
          }, 50)
        } else {
          setError(result.error || '加载失败')
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
  }, [isDevice, selectedDevice, path, platform])

  const navigateUp = useCallback(() => {
    if (path === '/') return
    
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (viewport) {
        scrollPositions.current.set(path, viewport.scrollTop)
      }
    }
    
    const parentPath = isDevice
      ? path.split('/').slice(0, -1).join('/') || '/'
      : path.split(/[/\\]/).slice(0, -1).join('/') || '/'
    setPath(parentPath)
    setSelectedFiles(new Set())
  }, [path, isDevice])

  const navigateTo = useCallback((newPath: string) => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (viewport) {
        scrollPositions.current.set(path, viewport.scrollTop)
      }
    }
    setPath(newPath)
    setSelectedFiles(new Set())
    addToHistory(newPath)
  }, [path, addToHistory])

  const navigateHome = useCallback(async () => {
    if (isDevice) {
      setPath(getDefaultPath())
    } else {
      if (isHdcAvailable()) {
        const homePath = await window.hdc.getUserHomeDirectory()
        setPath(homePath)
      }
    }
    setSelectedFiles(new Set())
  }, [isDevice, getDefaultPath])

  const handlePathInputChange = useCallback((value: string) => {
    setPathInput(value)
  }, [])

  const handlePathInputSubmit = useCallback(() => {
    if (pathInput.trim() && pathInput.trim() !== path) {
      navigateTo(pathInput.trim())
    }
  }, [pathInput, path, navigateTo])

  const handleFileClick = useCallback((file: FileItem) => {
    if (file.isDirectory) {
      navigateTo(file.path)
    } else {
      setSelectedFiles((prev) => {
        const next = new Set(prev)
        if (next.has(file.path)) {
          next.delete(file.path)
        } else {
          next.add(file.path)
        }
        return next
      })
    }
  }, [navigateTo])

  useEffect(() => {
    loadDirectory()
  }, [loadDirectory])

  useEffect(() => {
    if (!isDevice && isHdcAvailable()) {
      window.hdc.getUserDownloadsDirectory().then((downloadsPath) => {
        setPath(downloadsPath)
        setPathInput(downloadsPath)
      })
    } else if (isDevice) {
      const defaultPath = getDefaultPath()
      setPath(defaultPath)
      setPathInput(defaultPath)
    }
  }, [isDevice, getDefaultPath])

  useEffect(() => {
    if (isDevice && platform) {
      const defaultPath = getDefaultPath()
      setPath(defaultPath)
      setPathInput(defaultPath)
      setSelectedFiles(new Set())
    }
  }, [platform])

  return {
    path,
    pathInput,
    files,
    loading,
    error,
    selectedFiles,
    scrollAreaRef,
    history,
    setPath,
    setPathInput,
    setSelectedFiles,
    loadDirectory,
    navigateUp,
    navigateTo,
    navigateHome,
    handlePathInputChange,
    handlePathInputSubmit,
    handleFileClick,
    removeFromHistory
  }
}