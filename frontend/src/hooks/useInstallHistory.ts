import { useCallback, useEffect, useRef, useState } from 'react'
import { appAPI } from '@/lib/hdc-api/app'
import type {
  InstallAttemptResult,
  InstallHistoryItem,
  InstallPlatform
} from '@/types/install'

interface UseInstallHistoryResult {
  readonly history: InstallHistoryItem[]
  readonly isLoading: boolean
  readonly error: string | null
  readonly activeHistoryId: string | null
  readonly refreshHistory: () => Promise<void>
  readonly reinstall: (connectKey: string, historyId: string) => Promise<InstallAttemptResult>
  readonly remove: (historyId: string) => Promise<void>
  readonly clear: () => Promise<void>
}

const OPERATION_IN_PROGRESS_ERROR = '已有安装历史操作正在进行'

export function useInstallHistory(platform: InstallPlatform): UseInstallHistoryResult {
  const [history, setHistory] = useState<InstallHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)

  const activeHistoryIdRef = useRef<string | null>(null)
  const isClearActiveRef = useRef(false)
  const isMountedRef = useRef(true)
  const currentPlatformRef = useRef(platform)
  const requestIdRef = useRef(0)

  currentPlatformRef.current = platform

  const refreshHistory = useCallback(async (): Promise<void> => {
    if (!isMountedRef.current || currentPlatformRef.current !== platform) return

    const requestId = ++requestIdRef.current
    setIsLoading(true)

    try {
      const nextHistory = await appAPI.getInstallHistory(platform)
      if (
        isMountedRef.current &&
        currentPlatformRef.current === platform &&
        requestIdRef.current === requestId
      ) {
        setHistory(nextHistory)
        setError(null)
      }
    } catch (loadError: unknown) {
      if (
        isMountedRef.current &&
        currentPlatformRef.current === platform &&
        requestIdRef.current === requestId
      ) {
        setError(loadError instanceof Error ? loadError.message : '加载安装历史失败')
      }
      throw loadError
    } finally {
      if (
        isMountedRef.current &&
        currentPlatformRef.current === platform &&
        requestIdRef.current === requestId
      ) {
        setIsLoading(false)
      }
    }
  }, [platform])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    setHistory([])
    void refreshHistory().catch((error: unknown) => {
      console.error('[useInstallHistory] Failed to load install history:', error)
    })

    return () => {
      requestIdRef.current += 1
    }
  }, [refreshHistory])

  const beginHistoryOperation = useCallback((historyId: string): void => {
    if (activeHistoryIdRef.current !== null || isClearActiveRef.current) {
      throw new Error(OPERATION_IN_PROGRESS_ERROR)
    }
    activeHistoryIdRef.current = historyId
    setActiveHistoryId(historyId)
  }, [])

  const endHistoryOperation = useCallback((historyId: string): void => {
    if (activeHistoryIdRef.current !== historyId) return

    activeHistoryIdRef.current = null
    if (isMountedRef.current) {
      setActiveHistoryId(null)
    }
  }, [])

  const reinstall = useCallback(async (
    connectKey: string,
    historyId: string
  ): Promise<InstallAttemptResult> => {
    beginHistoryOperation(historyId)
    const operationPlatform = platform

    try {
      try {
        return await appAPI.reinstallAppFromHistory(connectKey, historyId)
      } finally {
        if (currentPlatformRef.current === operationPlatform) {
          try {
            await refreshHistory()
          } catch (error: unknown) {
            console.error('[useInstallHistory] Failed to refresh after reinstall:', error)
          }
        }
      }
    } finally {
      endHistoryOperation(historyId)
    }
  }, [beginHistoryOperation, endHistoryOperation, platform, refreshHistory])

  const remove = useCallback(async (historyId: string): Promise<void> => {
    beginHistoryOperation(historyId)
    const operationPlatform = platform

    try {
      await appAPI.deleteInstallHistory(operationPlatform, historyId)
      if (currentPlatformRef.current === operationPlatform) {
        await refreshHistory()
      }
    } finally {
      endHistoryOperation(historyId)
    }
  }, [beginHistoryOperation, endHistoryOperation, platform, refreshHistory])

  const clear = useCallback(async (): Promise<void> => {
    if (activeHistoryIdRef.current !== null || isClearActiveRef.current) {
      throw new Error(OPERATION_IN_PROGRESS_ERROR)
    }

    isClearActiveRef.current = true
    const operationPlatform = platform

    try {
      await appAPI.clearInstallHistory(operationPlatform)
      if (currentPlatformRef.current === operationPlatform) {
        await refreshHistory()
      }
    } finally {
      isClearActiveRef.current = false
    }
  }, [platform, refreshHistory])

  return {
    history,
    isLoading,
    error,
    activeHistoryId,
    refreshHistory,
    reinstall,
    remove,
    clear
  }
}
