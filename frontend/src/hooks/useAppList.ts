import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useDeviceStore } from '@/store/deviceStore'
import { useAppCacheStore } from '@/store/appCacheStore'
import { isHdcAvailable } from '@/lib/hdc'
import type { AppInfo, AppStats, AppFilterType } from '@/types/hdc'

let globalFetchPromise: Promise<void> | null = null
let globalUnsubscribe: (() => void) | null = null

export function useAppList(filter: AppFilterType) {
  const { selectedDevice } = useDeviceStore()
  const { updateApps, appsArray, isDiskCacheLoaded, loadFromDiskCache } = useAppCacheStore()

  const [apps, setApps] = useState<AppInfo[]>([])
  const [stats, setStats] = useState<AppStats>({
    total: 0,
    system: 0,
    thirdParty: 0,
    running: 0
  })
  const [isLoading, setIsLoading] = useState(false)
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set())

  const isMountedRef = useRef(true)
  const hasInitRef = useRef(false)

  const handleImageError = useCallback((packageName: string) => {
    setFailedIcons((prev) => {
      if (prev.has(packageName)) {
        return prev
      }
      return new Set(prev).add(packageName)
    })
  }, [])

  const fetchAppList = useCallback(async () => {
    if (!selectedDevice || !isHdcAvailable()) return

    if (globalFetchPromise) {
      return globalFetchPromise
    }

    setIsLoading(true)
    setApps([])
    setStats({ total: 0, system: 0, thirdParty: 0, running: 0 })

    globalFetchPromise = (async () => {
      try {
        if (globalUnsubscribe) {
          globalUnsubscribe()
          globalUnsubscribe = null
        }

        globalUnsubscribe = window.hdc.onAppListUpdate((event, data) => {
          if (!isMountedRef.current) {
            return
          }

          if (event === 'cache') {
            if (!isMountedRef.current) return
            console.log('[useAppList] Received disk cache data')
            if (data?.apps && data.apps.length > 0) {
              setApps(data.apps)
              setStats(data.stats ?? { total: 0, system: 0, thirdParty: 0, running: 0 })
              setIsLoading(false)
              updateApps(data.apps)
            }
          } else if (event === 'basic') {
            if (!isMountedRef.current) return
            setApps(data?.apps ?? [])
            setStats(data?.stats ?? { total: 0, system: 0, thirdParty: 0, running: 0 })
            setIsLoading(false)
          } else if (event === 'detail-updated') {
            if (!isMountedRef.current) return
            setApps((prevApps) => {
              return prevApps.map((app) => {
                if (app.packageName === data.packageName) {
                  const updated = { ...app }
                  if (data.appName) {
                    updated.appName = data.appName
                  }
                  if (data.icon) {
                    updated.icon = data.icon
                  }
                  return updated
                }
                return app
              })
            })
          } else if (event === 'icon-updated') {
            if (!isMountedRef.current) return
            setApps((prevApps) => {
              return prevApps.map((app) => {
                if (app.packageName === data.packageName) {
                  return { ...app, icon: data.icon }
                }
                return app
              })
            })
          } else if (event === 'complete') {
            if (!isMountedRef.current) return
            console.log('[useAppList] All app icons loaded')
            setApps((currentApps) => {
              if (isMountedRef.current) {
                updateApps(currentApps)
              }
              return currentApps
            })
          } else if (event === 'error') {
            if (!isMountedRef.current) return
            console.error('[useAppList] Failed to load app list:', data.error)
            setIsLoading(false)
          }
        })

        await window.hdc.getAppList(selectedDevice.connectKey, filter, true, true, selectedDevice.platform)
      } catch (error) {
        console.error('[useAppList] Failed to fetch app list:', error)
        setIsLoading(false)
      } finally {
        globalFetchPromise = null
      }
    })()

    return globalFetchPromise
  }, [selectedDevice?.connectKey, selectedDevice?.platform, filter, updateApps])

  useEffect(() => {
    isMountedRef.current = true
    hasInitRef.current = false
    return () => {
      isMountedRef.current = false
      hasInitRef.current = false
      if (globalUnsubscribe) {
        globalUnsubscribe()
        globalUnsubscribe = null
      }
      globalFetchPromise = null
    }
  }, [])

  useEffect(() => {
    if (!selectedDevice) {
      return
    }

    if (hasInitRef.current) {
      return
    }
    hasInitRef.current = true

    let isCancelled = false

    const initializeData = async () => {
      if (!isDiskCacheLoaded) {
        const loaded = await loadFromDiskCache()
        if (loaded && !isCancelled) {
          const cachedApps = useAppCacheStore.getState().appsArray
          if (cachedApps.length > 0) {
            setApps(cachedApps)
            setStats({
              total: cachedApps.length,
              system: cachedApps.filter((a) => a.isSystemApp).length,
              thirdParty: cachedApps.filter((a) => !a.isSystemApp).length,
              running: cachedApps.filter((a) => a.isRunning).length
            })
            setIsLoading(false)
          }
        }
      } else {
        const cachedApps = appsArray
        if (cachedApps.length > 0) {
          setApps(cachedApps)
          setStats({
            total: cachedApps.length,
            system: cachedApps.filter((a) => a.isSystemApp).length,
            thirdParty: cachedApps.filter((a) => !a.isSystemApp).length,
            running: cachedApps.filter((a) => a.isRunning).length
          })
          setIsLoading(false)
        }
      }

      if (!isCancelled) {
        await fetchAppList()
      }
    }

    initializeData()

    return () => {
      isCancelled = true
    }
  }, [selectedDevice?.connectKey])

  useEffect(() => {
    setApps([])
    setStats({ total: 0, system: 0, thirdParty: 0, running: 0 })
    hasInitRef.current = false
  }, [filter])

  const computedStats = useMemo(() => {
    return {
      total: apps.length,
      system: apps.filter((a) => a.isSystemApp).length,
      thirdParty: apps.filter((a) => !a.isSystemApp).length,
      running: apps.filter((a) => a.isRunning).length
    }
  }, [apps])

  useEffect(() => {
    setStats(computedStats)
  }, [computedStats])

  return {
    apps,
    stats,
    isLoading,
    failedIcons,
    fetchAppList,
    handleImageError
  }
}