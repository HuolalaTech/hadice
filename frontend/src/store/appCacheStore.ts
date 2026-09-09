import { create } from 'zustand'
import type { AppInfo } from '@/types/hdc'
import { hdcAPI } from '@/lib/hdc-api'
import { capturePostHogException } from '@/lib/posthog'

interface AppCacheState {
  apps: Map<string, AppInfo>
  appsArray: AppInfo[]
  lastUpdate: number
  cacheExpiry: number
  isLoading: boolean
  isInitializingOnlineInfo: boolean
  isDiskCacheLoaded: boolean
  onOnlineInfoUpdate?: (packageName: string, appInfo: AppInfo) => void

  updateApps: (apps: AppInfo[]) => void
  updateApp: (packageName: string, updates: Partial<AppInfo>) => void
  getAppByPackageName: (packageName: string) => AppInfo | null
  matchAppByProcessName: (processName: string) => AppInfo | null
  clearCache: () => void
  isExpired: () => boolean
  setLoading: (loading: boolean) => void
  loadAppsIfNeeded: (connectKey: string) => Promise<void>
  loadFromDiskCache: () => Promise<boolean>
  initializeOnlineAppInfo: (connectKey: string, onUpdate?: (packageName: string, appInfo: AppInfo) => void) => Promise<void>
  setOnlineInfoUpdateCallback: (callback?: (packageName: string, appInfo: AppInfo) => void) => void
}

let isLoadingFromDisk = false
let isLoadingFromDevice = false

export const useAppCacheStore = create<AppCacheState>((set, get) => ({
  apps: new Map(),
  appsArray: [],
  lastUpdate: 0,
  cacheExpiry: 5 * 60 * 1000,
  isLoading: false,
  isInitializingOnlineInfo: false,
  isDiskCacheLoaded: false,
  onOnlineInfoUpdate: undefined,

  updateApps: (apps) => {
    const appsMap = new Map<string, AppInfo>()
    apps.forEach((app) => {
      appsMap.set(app.packageName, app)
    })
    set({
      apps: appsMap,
      appsArray: apps,
      lastUpdate: Date.now(),
      isLoading: false,
      isDiskCacheLoaded: true
    })
  },

  updateApp: (packageName, updates) => {
    const { apps, appsArray } = get()
    const app = apps.get(packageName)
    if (!app) return

    const updatedApp = { ...app, ...updates }
    const newApps = new Map(apps)
    newApps.set(packageName, updatedApp)

    const newAppsArray = appsArray.map(a => a.packageName === packageName ? updatedApp : a)

    set({
      apps: newApps,
      appsArray: newAppsArray
    })

    const { onOnlineInfoUpdate } = get()
    if (onOnlineInfoUpdate) {
      onOnlineInfoUpdate(packageName, updatedApp)
    }
  },

  setLoading: (loading) => {
    set({ isLoading: loading })
  },

  loadFromDiskCache: async (): Promise<boolean> => {
    if (isLoadingFromDisk) {
      return false
    }
    isLoadingFromDisk = true

    try {
      const cachedResult = await hdcAPI.getCachedAppList()
      if (cachedResult && cachedResult.apps && cachedResult.apps.length > 0) {
        const appsWithIcons = await Promise.all(
          cachedResult.apps.map(async (app) => {
            if (!app.icon) {
              const cachedIcon = await hdcAPI.getCachedAppIcon(app.packageName)
              if (cachedIcon) {
                return { ...app, icon: cachedIcon }
              }
            }
            return app
          })
        )
        
        get().updateApps(appsWithIcons)
        console.log('[AppCacheStore] Loaded', appsWithIcons.length, 'apps from disk cache')
        return true
      }
      return false
    } catch (error) {
      console.error('[AppCacheStore] Failed to load from disk cache:', error)
      return false
    } finally {
      isLoadingFromDisk = false
    }
  },

  loadAppsIfNeeded: async (connectKey: string) => {
    const { isDiskCacheLoaded } = get()
    
    if (isLoadingFromDevice) {
      return
    }

    if (!isDiskCacheLoaded) {
      const loaded = await get().loadFromDiskCache()
      if (loaded) {
        return
      }
    }

    if (typeof window === 'undefined' || typeof window.hdc === 'undefined') {
      return
    }

    isLoadingFromDevice = true
    set({ isLoading: true })

    try {
      const result = await window.hdc.getAppList(connectKey, 'all', true, false)
      
      if (result && result.apps && result.apps.length > 0) {
        get().updateApps(result.apps)
      }
    } catch (error) {
      console.error('[AppCacheStore] Failed to load apps:', error)
      if (error instanceof Error) {
        capturePostHogException(error, { feature: 'app_manager', action: 'load_apps' })
      }
      set({ isLoading: false })
    } finally {
      isLoadingFromDevice = false
    }
  },

  getAppByPackageName: (packageName) => {
    const { apps, isDiskCacheLoaded } = get()
    if (isDiskCacheLoaded) {
      return apps.get(packageName) || null
    }
    return apps.get(packageName) || null
  },

  matchAppByProcessName: (processName) => {
    const { apps } = get()
    if (!processName) {
      return null
    }

    const cleanProcessName = processName.split('/').pop() || processName

    const exactMatch = apps.get(cleanProcessName)
    if (exactMatch) {
      return exactMatch
    }

    for (const [packageName, app] of apps.entries()) {
      if (cleanProcessName.startsWith(packageName + ':') || cleanProcessName.startsWith(packageName + '/')) {
        return app
      }
    }

    for (const [packageName, app] of apps.entries()) {
      if (cleanProcessName.startsWith(packageName)) {
        return app
      }
    }

    for (const [packageName, app] of apps.entries()) {
      if (cleanProcessName.includes(packageName)) {
        return app
      }
    }

    return null
  },

  clearCache: () => {
    set({
      apps: new Map(),
      appsArray: [],
      lastUpdate: 0,
      isLoading: false,
      isDiskCacheLoaded: false
    })
    isLoadingFromDisk = false
    isLoadingFromDevice = false
  },

  isExpired: () => {
    const { lastUpdate, cacheExpiry, isDiskCacheLoaded } = get()
    if (lastUpdate === 0 && !isDiskCacheLoaded) {
      return true
    }
    if (isDiskCacheLoaded && lastUpdate === 0) {
      return false
    }
    return Date.now() - lastUpdate > cacheExpiry
  },

  initializeOnlineAppInfo: async (connectKey, onUpdate) => {
    const { isInitializingOnlineInfo, apps } = get()
    
    if (isInitializingOnlineInfo) {
      return
    }

    if (onUpdate) {
      set({ onOnlineInfoUpdate: onUpdate })
    }

    const appsNeedingInfo: string[] = []
    apps.forEach((app, packageName) => {
      if (!app.appName || app.appName === packageName || !app.icon) {
        appsNeedingInfo.push(packageName)
      }
    })

    if (appsNeedingInfo.length === 0) {
      return
    }

    set({ isInitializingOnlineInfo: true })

    try {
      const batchSize = 10
      for (let i = 0; i < appsNeedingInfo.length; i += batchSize) {
        const batch = appsNeedingInfo.slice(i, i + batchSize)
        
        const promises = batch.map(async (packageName) => {
          try {
            const onlineInfo = await hdcAPI.getOnlineAppInfo(packageName)
            
            if (onlineInfo.name || onlineInfo.icon) {
              const updates: Partial<AppInfo> = {}
              if (onlineInfo.name) {
                updates.appName = onlineInfo.name
              }
              if (onlineInfo.icon) {
                updates.icon = onlineInfo.icon
              }
              
              get().updateApp(packageName, updates)
            }
          } catch (error) {
            console.error(`[AppCacheStore] Failed to get online info for ${packageName}:`, error)
          }
        })

        await Promise.allSettled(promises)
        
        if (i + batchSize < appsNeedingInfo.length) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
    } catch (error) {
      console.error('[AppCacheStore] Failed to initialize online app info:', error)
    } finally {
      set({ isInitializingOnlineInfo: false })
    }
  },

  setOnlineInfoUpdateCallback: (callback) => {
    set({ onOnlineInfoUpdate: callback })
  }
}))