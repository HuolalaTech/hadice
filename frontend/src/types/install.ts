export type InstallPlatform = 'android' | 'harmonyos'

export type InstallSourceType = 'local' | 'url'

interface PreparedInstallPackageInfo {
  readonly filePath: string
  readonly fileSize: number
  readonly appName: string
  readonly icon?: string
  readonly bundleName: string
  readonly versionName: string
  readonly versionCode: number
  readonly minAPIVersion?: number
  readonly targetAPIVersion?: number
  readonly permissions: readonly Record<string, unknown>[]
  readonly extractedHapPath?: string
  readonly layeredIcon?: Readonly<Record<string, string>>
  readonly vendor?: string
  readonly moduleName?: string
  readonly moduleDescription?: string
  readonly compileSdkVersion?: string
  readonly compileMode?: string
  readonly virtualMachine?: string
  readonly deviceTypes?: readonly string[]
  readonly abilities?: readonly Record<string, unknown>[]
  readonly nativeCode?: readonly string[]
}

export interface PreparedInstallPackage {
  readonly filePath: string
  readonly info: PreparedInstallPackageInfo
}

export interface InstallHistoryItem {
  readonly id: string
  readonly platform: InstallPlatform
  readonly sourceType: InstallSourceType
  readonly source: string
  readonly fileName: string
  readonly fileSize: number
  readonly cachedPath: string
  readonly sha256: string
  readonly appName?: string
  readonly packageName?: string
  readonly versionName?: string
  readonly versionCode?: number
  readonly installedAt: number
  readonly success: boolean
  readonly error?: string
}

export interface InstallAttemptResult {
  readonly success: boolean
  readonly output?: string
  readonly error?: string
  readonly historyWarning?: string
  readonly cachedPath?: string
}
