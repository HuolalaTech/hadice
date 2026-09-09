/**
 * 应用管理相关 API
 */

import * as App from "../../../bindings/Hadice/backend/appservice"
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import type {
  HdcResult,
  AppListResult,
  AppFilterType,
  AppShortcutInfo,
  MissionInfo,
  AppRunningRecord
} from '@/types/hdc'

/**
 * 应用管理相关 API
 */
export const appAPI = {
  getAppList: async (connectKey: string, filter?: AppFilterType, incremental?: boolean, _loadDetails?: boolean, platform?: string): Promise<AppListResult> => {
    try {
      const result = await App.GetAppListByPlatform(connectKey, filter || 'all', incremental || false, platform || 'harmonyos')
      if (!result) {
        return { stats: { total: 0, system: 0, thirdParty: 0, running: 0 }, apps: [] }
      }
      return {
        stats: {
          total: result.stats?.total ?? 0,
          system: result.stats?.system ?? 0,
          thirdParty: result.stats?.thirdParty ?? 0,
          running: result.stats?.running ?? 0
        },
        apps: (result.apps ?? []).map((app: any) => ({
          packageName: app.packageName,
          appName: app.appName,
          version: app.version,
          versionCode: app.versionCode,
          size: app.size,
          icon: app.icon,
          isSystemApp: app.isSystemApp,
          isRunning: app.isRunning,
          isEnabled: app.isEnabled,
          installTime: app.installTime
        }))
      }
    } catch (error) {
      console.error('[HDC API] getAppList failed:', error)
      throw error
    }
  },

  // 获取在线应用信息（从华为应用市场）
  getOnlineAppInfo: async (packageName: string): Promise<{ name?: string; icon?: string }> => {
    try {
      const result = await App.GetOnlineAppInfo(packageName)
      return {
        name: result.name || undefined,
        icon: result.icon || undefined
      }
    } catch (error) {
      console.error('[HDC API] getOnlineAppInfo failed:', error)
      return {}
    }
  },

  onAppListUpdate: (callback: (event: string, data: any) => void): (() => void) => {
    const unsubscribeCache = EventsOn('app-list-cache', (data: any) => {
      callback('cache', data)
    })
    
    const unsubscribeBasic = EventsOn('app-list-basic', (data: any) => {
      callback('basic', data)
    })
    
    const unsubscribeDetail = EventsOn('app-detail-updated', (data: any) => {
      callback('detail-updated', data)
    })
    
    const unsubscribeIcon = EventsOn('app-icon-updated', (data: any) => {
      callback('icon-updated', data)
    })
    
    const unsubscribeError = EventsOn('app-detail-error', (data: any) => {
      callback('detail-error', data)
    })
    
    const unsubscribeComplete = EventsOn('app-list-complete', () => {
      callback('complete', {})
    })

    return () => {
      unsubscribeCache()
      unsubscribeBasic()
      unsubscribeDetail()
      unsubscribeIcon()
      unsubscribeError()
      unsubscribeComplete()
    }
  },

  startApp: async (connectKey: string, packageName: string, platform?: string): Promise<HdcResult> => {
    try {
      const result = await App.StartAppByPlatform(connectKey, packageName, platform || 'harmonyos')
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] startApp failed:', error)
      throw error
    }
  },

  stopApp: async (connectKey: string, packageName: string, platform?: string): Promise<HdcResult> => {
    try {
      const result = await App.StopAppByPlatform(connectKey, packageName, platform || 'harmonyos')
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] stopApp failed:', error)
      throw error
    }
  },

  clearAppData: async (connectKey: string, packageName: string, platform?: string): Promise<HdcResult> => {
    try {
      const result = await App.ClearAppDataByPlatform(connectKey, packageName, platform || 'harmonyos')
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] clearAppData failed:', error)
      throw error
    }
  },

  uninstallApp: async (connectKey: string, packageName: string, platform?: string): Promise<HdcResult> => {
    try {
      const result = await App.UninstallAppByPlatform(connectKey, packageName, platform || 'harmonyos')
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] uninstallApp failed:', error)
      throw error
    }
  },

  getAppShortcuts: async (connectKey: string, packageName: string): Promise<{ success: boolean; shortcuts?: AppShortcutInfo[]; error?: string }> => {
    try {
      const shortcuts = await App.GetAppShortcuts(connectKey, packageName)
      return {
        success: true,
        shortcuts: shortcuts.map(s => ({
          id: s.id as string,
          label: s.label as string,
          labelId: s.labelId as number,
          icon: s.icon as string,
          iconId: s.iconId as number,
          bundleName: s.bundleName as string,
          moduleName: s.moduleName as string,
          isEnables: s.isEnables as boolean,
          isHomeShortcut: s.isHomeShortcut as boolean,
          isStatic: s.isStatic as boolean,
          intents: (s.intents as any[]) || []
        }))
      }
    } catch (error) {
      console.error('[HDC API] getAppShortcuts failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取快捷方式失败'
      }
    }
  },

  getMissionList: async (connectKey: string): Promise<{ success: boolean; missions?: MissionInfo[]; error?: string }> => {
    try {
      const missions = await App.GetMissionList(connectKey)
      return {
        success: true,
        missions: missions.map(m => ({
          missionId: m.missionId as number,
          missionName: m.missionName as string,
          lockedState: m.lockedState as number,
          missionAffinity: m.missionAffinity as string,
          abilityRecords: ((m.abilityRecords as any[]) || []).map(ar => ({
            abilityRecordId: ar.abilityRecordId as number,
            appName: ar.appName as string,
            mainName: ar.mainName as string,
            bundleName: ar.bundleName as string,
            abilityType: ar.abilityType as string,
            state: ar.state as string,
            startTime: ar.startTime as number,
            appState: ar.appState as string,
            ready: ar.ready as number,
            windowAttached: ar.windowAttached as number,
            launcher: ar.launcher as number,
            isKeepAlive: ar.isKeepAlive as boolean
          }))
        }))
      }
    } catch (error) {
      console.error('[HDC API] getMissionList failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取任务列表失败'
      }
    }
  },

  getAppRunningRecords: async (connectKey: string): Promise<{ success: boolean; records?: AppRunningRecord[]; error?: string }> => {
    try {
      const records = await App.GetAppRunningRecords(connectKey)
      return {
        success: true,
        records: records.map(r => ({
          recordId: r.recordId as number,
          processName: r.processName as string,
          pid: r.pid as number,
          uid: r.uid as number,
          state: r.state as string,
          uiExtensionProviders: ((r.uiExtensionProviders as any[]) || []).map(p => ({
            pid: p.pid as number
          })),
          rootCallers: ((r.rootCallers as any[]) || []).map(c => ({
            pid: c.pid as number
          }))
        }))
      }
    } catch (error) {
      console.error('[HDC API] getAppRunningRecords failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取运行记录失败'
      }
    }
  },

  getAppFullDetail: async (connectKey: string, packageName: string): Promise<{ success: boolean; packageName?: string; appName?: string; versionName?: string; versionCode?: number; installTime?: number; updateTime?: number; firstInstallTime?: number; isSystemApp?: boolean; isEnabled?: boolean; isPreInstallApp?: boolean; isNativeApp?: boolean; vendor?: string; targetVersion?: number; minSdkVersion?: number; uid?: number; gid?: number; codePath?: string; permissions?: any[]; abilities?: any[]; error?: string }> => {
    try {
      const detail = await App.GetAppFullDetail(connectKey, packageName)
      return {
        success: true,
        packageName: detail.packageName as string,
        appName: detail.appName as string,
        versionName: detail.versionName as string,
        versionCode: detail.versionCode as number,
        installTime: detail.installTime as number,
        updateTime: detail.updateTime as number,
        firstInstallTime: detail.firstInstallTime as number,
        isSystemApp: detail.isSystemApp as boolean,
        isEnabled: detail.isEnabled as boolean,
        isPreInstallApp: detail.isPreInstallApp as boolean,
        isNativeApp: detail.isNativeApp as boolean,
        vendor: detail.vendor as string,
        targetVersion: detail.targetVersion as number,
        minSdkVersion: detail.minSdkVersion as number,
        uid: detail.uid as number,
        gid: detail.gid as number,
        codePath: detail.codePath as string,
        permissions: detail.permissions as any[],
        abilities: detail.abilities as any[]
      }
    } catch (error) {
      console.error('[HDC API] getAppFullDetail failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取应用详情失败'
      }
    }
  },

  clearAppCacheFiles: async (connectKey: string, packageName: string): Promise<HdcResult> => {
    try {
      const result = await App.ClearAppCache(connectKey, packageName)
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] clearAppCacheFiles failed:', error)
      throw error
    }
  },

  selectHapFile: async (connectKey: string): Promise<string | null> => {
    try {
      return await App.SelectHapFile(connectKey)
    } catch (error) {
      console.error('[HDC API] selectHapFile failed:', error)
      return null
    }
  },

  installApp: async (connectKey: string, filePath: string): Promise<HdcResult> => {
    try {
      const result = await App.InstallApp(connectKey, filePath, false, false)
      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('[HDC API] installApp failed:', error)
      throw error
    }
  },

  parseHapAppInfo: async (filePath: string): Promise<{ success: boolean; error?: string; info?: any }> => {
    try {
      const info = await App.ParseHapAppInfo(filePath)
      return {
        success: true,
        info: {
          filePath: info.filePath,
          fileSize: info.fileSize,
          extractedHapPath: info.extractedHapPath,
          appName: info.appName,
          icon: info.icon,
          layeredIcon: info.layeredIcon,
          bundleName: info.bundleName,
          versionName: info.versionName,
          versionCode: info.versionCode,
          vendor: info.vendor,
          moduleName: info.moduleName,
          moduleDescription: info.moduleDescription,
          minAPIVersion: info.minAPIVersion,
          targetAPIVersion: info.targetAPIVersion,
          compileSdkVersion: info.compileSdkVersion,
          compileMode: info.compileMode,
          virtualMachine: info.virtualMachine,
          deviceTypes: info.deviceTypes,
          permissions: info.permissions,
          abilities: info.abilities,
          nativeCode: (info as any).nativeCode
        }
      }
    } catch (error) {
      console.error('[HDC API] parseHapAppInfo failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '解析失败'
      }
    }
  },

  parseAppPackageInfo: async (filePath: string): Promise<{ success: boolean; error?: string; info?: any }> => {
    try {
      const info = await App.ParseHapAppInfo(filePath)
      return {
        success: true,
        info: {
          filePath: info.filePath,
          fileSize: info.fileSize,
          extractedHapPath: info.extractedHapPath,
          appName: info.appName,
          icon: info.icon,
          layeredIcon: info.layeredIcon,
          bundleName: info.bundleName,
          versionName: info.versionName,
          versionCode: info.versionCode,
          vendor: info.vendor,
          moduleName: info.moduleName,
          moduleDescription: info.moduleDescription,
          minAPIVersion: info.minAPIVersion,
          targetAPIVersion: info.targetAPIVersion,
          compileSdkVersion: info.compileSdkVersion,
          compileMode: info.compileMode,
          virtualMachine: info.virtualMachine,
          deviceTypes: info.deviceTypes,
          permissions: info.permissions,
          abilities: info.abilities,
          nativeCode: (info as any).nativeCode
        }
      }
    } catch (error) {
      console.error('[HDC API] parseAppPackageInfo failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '解析失败'
      }
    }
  },

  // 打开文件夹
  openFolder: async (folderPath: string): Promise<HdcResult> => {
    try {
      return await App.OpenFolder(folderPath)
    } catch (error) {
      console.error('[HDC API] openFolder failed:', error)
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : '打开文件夹失败'
      }
    }
  },

  getCachedAppList: async (): Promise<AppListResult | null> => {
    try {
      const result = await App.GetCachedAppList()
      if (!result || !result.apps) {
        return null
      }
      return {
        stats: {
          total: (result.stats as any)?.total || 0,
          system: (result.stats as any)?.system || 0,
          thirdParty: (result.stats as any)?.thirdParty || 0,
          running: (result.stats as any)?.running || 0
        },
        apps: ((result.apps as any[]) || []).map(app => ({
          packageName: app.packageName as string,
          appName: app.appName as string,
          version: '',
          versionCode: 0,
          size: 0,
          installTime: 0,
          isSystemApp: app.isSystemApp as boolean,
          isRunning: app.isRunning as boolean,
          isEnabled: true
        }))
      }
    } catch (error) {
      console.error('[HDC API] getCachedAppList failed:', error)
      return null
    }
  },

  getCachedAppIcon: async (packageName: string): Promise<string | null> => {
    try {
      const icon = await App.GetCachedAppIcon(packageName)
      return icon || null
    } catch (error) {
      console.error('[HDC API] getCachedAppIcon failed:', error)
      return null
    }
  },

  clearAppDiskCache: async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.ClearAppDiskCache()
      return {
        success: result.success as boolean,
        error: result.error as string | undefined
      }
    } catch (error) {
      console.error('[HDC API] clearAppDiskCache failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '清除缓存失败'
      }
    }
  }
}
