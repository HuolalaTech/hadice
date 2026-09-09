import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Download,
  FolderOpen,
  AlertCircle,
  Loader2,
  FileText,
  HardDrive,
  Clock,
  Folder
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { NoDeviceState } from '@/components/layout/NoDeviceState'
import { useDeviceStore } from '@/store/deviceStore'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { isHdcAvailable } from '@/lib/hdc'
import { captureEvent } from '@/lib/posthog'
import { formatFileSize } from '@/lib/format'
import { EventsOn } from '../../wailsjs/runtime/runtime'

/**
 * 安装包信息类型（平台无关）
 */
interface InstallPackageInfo {
  filePath: string
  fileSize: number
  extractedHapPath?: string
  appName: string
  icon?: string
  layeredIcon?: {
    background?: string
    foreground?: string
  }
  bundleName: string
  versionName: string
  versionCode: number
  vendor?: string
  moduleName?: string
  moduleDescription?: string
  minAPIVersion?: number
  targetAPIVersion?: number
  compileSdkVersion?: string
  compileMode?: string
  virtualMachine?: string
  deviceTypes?: string[]
  permissions: Array<{
    name: string
    reason?: string
    usedScene?: {
      abilities?: string[]
      when?: string
    }
  }>
  abilities?: Array<{
    name: string
    label?: string
    description?: string
    launchType?: string
    supportWindowMode?: string[]
    skills?: Array<{
      actions?: string[]
      entities?: string[]
      uris?: Array<{
        scheme?: string
        host?: string
        path?: string
      }>
    }>
  }>
  nativeCode?: string[]
}

/**
 * HapAppInfo 向后兼容别名
 * @deprecated 使用 InstallPackageInfo 代替
 */
type HapAppInfo = InstallPackageInfo


/**
 * 格式化日期时间
 */
function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

/**
 * 应用安装页面
 */
export function AppInstallPage(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [appInfo, setAppInfo] = useState<HapAppInfo | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fileModifiedTime, setFileModifiedTime] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  /**
   * 处理解析 HAP 文件
   */
  const handleParseHapFile = useCallback(
    async (filePath: string) => {
      if (!isHdcAvailable()) {
        toast.error('HDC API 不可用')
        return
      }

      setIsParsing(true)
      setParseError(null)

      try {
        const result = await window.hdc.parseHapAppInfo(filePath)

        if (result.success && result.info) {
          setAppInfo(result.info)
        } else {
          setParseError(result.error || '解析失败')
          toast.error(result.error || '解析失败')
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '解析失败'
        setParseError(errorMsg)
        toast.error(errorMsg)
      } finally {
        setIsParsing(false)
      }
    },
    [isHdcAvailable]
  )

  /**
   * 处理拖放的文件
   */
  const handleDroppedFile = useCallback(
    async (filePath: string) => {
      const isAndroid = selectedDevice?.platform === 'android'
      const supportedExtensions = isAndroid
        ? ['.apk']
        : ['.hap', '.zip', '.gz', '.7z', '.tar', '.tgz']

      const fileName = filePath.toLowerCase()
      const isSupported = supportedExtensions.some(ext => fileName.endsWith(ext)) || (!isAndroid && fileName.endsWith('.tar.gz'))
      if (!isSupported) {
        toast.error(isAndroid ? '支持 .apk 格式文件' : '支持 .hap、.zip 等格式文件')
        return
      }

      setSelectedFile(filePath)
      setAppInfo(null)
      setParseError(null)
      setFileModifiedTime(null)

      // 获取文件信息（修改时间）
      try {
        const fileInfo = await window.hdc.getFileInfo(filePath)
        if (fileInfo.success && fileInfo.modifiedTime) {
          setFileModifiedTime(fileInfo.modifiedTime)
        }
      } catch (error) {
        console.error('[AppInstallPage] Get file info error:', error)
      }

      // 自动解析
      await handleParseHapFile(filePath)
    },
    [handleParseHapFile]
  )

  /**
   * 监听 Wails v3 文件拖放事件
   * Go 后端通过 app.Event.Emit("files-dropped") 转发拖放文件路径
   */
  useEffect(() => {
    const unlisten = EventsOn('files-dropped', (data: { files: string[] }) => {
      console.log('[AppInstallPage] File drop event:', data)
      if (data?.files && data.files.length > 0) {
        // 只处理第一个文件
        handleDroppedFile(data.files[0])
      }
    })

    // 清理监听器
    return () => {
      unlisten()
    }
  }, [handleDroppedFile])

  /**
   * 选择安装包文件
   */
  const handleSelectHapFile = useCallback(async () => {
    if (!isHdcAvailable()) {
      toast.error('HDC API 不可用')
      return
    }

    if (!selectedDevice) {
      toast.error('请先选择设备')
      return
    }

    try {
      const filePath = await window.hdc.selectHapFile(selectedDevice.connectKey)
      if (filePath) {
        captureEvent('install file selected', { file_path: filePath })
        setSelectedFile(filePath)
        setAppInfo(null)
        setParseError(null)
        setFileModifiedTime(null)
        
        try {
          const fileInfo = await window.hdc.getFileInfo(filePath)
          if (fileInfo.success && fileInfo.modifiedTime) {
            setFileModifiedTime(fileInfo.modifiedTime)
          }
        } catch (error) {
          console.error('[AppInstallPage] Get file info error:', error)
        }
        
        await handleParseHapFile(filePath)
      }
    } catch (error) {
      console.error('[AppInstallPage] Select file error:', error)
      toast.error('选择文件失败')
    }
  }, [isHdcAvailable, selectedDevice, handleParseHapFile])


  /**
   * 安装应用
   */
  const handleInstall = useCallback(async () => {
    if (!selectedFile) {
      toast.error('请先选择安装包')
      return
    }

    if (!selectedDevice || !isHdcAvailable()) {
      toast.error('请先选择设备')
      return
    }

    setIsInstalling(true)

    try {
      const result = await window.hdc.installApp(
        selectedDevice.connectKey,
        selectedFile
      )

      // 合并所有输出信息用于判断
      const allOutput = [result.output, result.error].filter(Boolean).join('\n').trim()
      const installResult = allOutput.toLowerCase()

      // 根据输出内容判断安装结果
      const isSuccess = installResult.includes('success') || 
        (result.success && !result.error && installResult.length > 0 && 
         !installResult.includes('error') && !installResult.includes('fail'))

      if (isSuccess) {
        toast.success('安装成功')
      } else if (installResult.includes('downgrade')) {
        toast.error('安装失败，无法降级安装，请先卸载')
      } else {
        const errorMsg = result.error || result.output || '安装失败，若已安装请卸载旧版再尝试'
        const finalErrorMsg = errorMsg.length > 50 ? '安装失败，若已安装请卸载旧版再尝试' : errorMsg
        toast.error(finalErrorMsg)
      }
    } catch (error) {
      console.error('[AppInstallPage] Install app error:', error)
      toast.error('安装失败，请检查文件路径和设备连接')
    } finally {
      setIsInstalling(false)
    }
  }, [selectedDevice, selectedFile, isHdcAvailable])

  // 未连接设备
  if (!selectedDevice) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Download className="h-6 w-6 text-primary" />
            应用安装
            <WindowToggleButton />
            <HelpToggleButton />
          </h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <NoDeviceState />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full flex flex-col overflow-y-auto">
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Download className="h-6 w-6 text-primary" />
          应用安装
          <WindowToggleButton />
            <HelpToggleButton />
        </h1>
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSelectHapFile}
            disabled={isParsing || isInstalling}
            variant="outline"
            className="gap-2"
          >
            <FolderOpen className="h-4 w-4" />
            选择安装包
          </Button>
          <Button
            onClick={handleInstall}
            disabled={isInstalling}
            className={`gap-2 ${!selectedFile ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isInstalling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在安装...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                安装应用
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 文件信息区域 */}
      {selectedFile && (
        <Card className="mb-4 flex-shrink-0">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-muted-foreground">文件路径</span>
                </div>
                <div className="text-sm font-mono break-all text-right flex-1 min-w-0">{selectedFile}</div>
              </div>
              {appInfo && (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <HardDrive className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm text-muted-foreground">文件大小</span>
                  </div>
                  <div className="text-sm font-semibold text-right">{formatFileSize(appInfo.fileSize)}</div>
                </div>
              )}
              {fileModifiedTime && (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm text-muted-foreground">修改时间</span>
                  </div>
                  <div className="text-sm text-right">{formatDateTime(fileModifiedTime)}</div>
                </div>
              )}
              {appInfo?.extractedHapPath && (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Folder className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm text-muted-foreground">解压路径</span>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        // 获取文件所在目录（上一级目录）
                        const filePath = appInfo.extractedHapPath!
                        // 处理不同操作系统的路径分隔符
                        const lastSlashIndex = Math.max(
                          filePath.lastIndexOf('/'),
                          filePath.lastIndexOf('\\')
                        )
                        const folderPath = lastSlashIndex > 0 
                          ? filePath.substring(0, lastSlashIndex)
                          : filePath
                        const result = await window.hdc.openFolder(folderPath)
                        if (!result.success) {
                          toast.error(result.error || '打开文件夹失败')
                        }
                      } catch (error) {
                        toast.error('打开文件夹失败')
                      }
                    }}
                    className="text-sm font-mono break-all text-right flex-1 min-w-0 text-blue-500 hover:text-blue-600 hover:underline cursor-pointer"
                    title="点击打开文件夹"
                  >
                    {appInfo.extractedHapPath}
                  </button>
                </div>
              )}
              {isParsing && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在解析安装包信息...
                </div>
              )}
              {parseError && (
                <div className="flex items-center gap-2 text-sm text-destructive pt-2">
                  <AlertCircle className="h-4 w-4" />
                  {parseError}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 应用信息展示 */}
      {appInfo && (
        <Card className="mb-4 flex-shrink-0">
          <CardContent className="pt-6">
            {/* 应用图标和名称区域 */}
            <div className="flex items-center gap-4 mb-6 pb-4 border-b">
              {(appInfo.icon || appInfo.layeredIcon) && (
                <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-secondary/50 flex items-center justify-center overflow-hidden relative">
                  {appInfo.layeredIcon ? (
                    <div className="w-full h-full relative">
                      {appInfo.layeredIcon.background && (
                        <img
                          src={appInfo.layeredIcon.background}
                          alt={`${appInfo.appName} 背景`}
                          className="w-full h-full rounded-lg object-cover absolute inset-0"
                        />
                      )}
                      {appInfo.layeredIcon.foreground && (
                        <img
                          src={appInfo.layeredIcon.foreground}
                          alt={`${appInfo.appName} 前景`}
                          className="w-full h-full rounded-lg object-cover absolute inset-0"
                        />
                      )}
                    </div>
                  ) : appInfo.icon ? (
                    <img
                      src={appInfo.icon}
                      alt={appInfo.appName}
                      className="w-full h-full rounded-lg object-cover"
                    />
                  ) : null}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xl font-bold mb-2">{appInfo.appName}</div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>
                    {appInfo.versionName} ({appInfo.versionCode})
                  </span>
                  <span className="text-muted-foreground/50">|</span>
                  <span className="font-mono break-all">{appInfo.bundleName}</span>
                </div>
              </div>
            </div>

            <Tabs defaultValue="basic" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="basic">基本信息</TabsTrigger>
                <TabsTrigger value="permissions">权限列表</TabsTrigger>
                <TabsTrigger value="abilities">能力信息</TabsTrigger>
              </TabsList>

              {/* 基本信息 */}
              <TabsContent value="basic" className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm text-muted-foreground">厂商</span>
                    <div className="text-sm mt-1 font-medium">{appInfo.vendor}</div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">模块名</span>
                    <div className="text-sm mt-1 font-medium">{appInfo.moduleName}</div>
                  </div>
                  {appInfo.moduleDescription && (
                    <div className="col-span-2">
                      <span className="text-sm text-muted-foreground">模块描述</span>
                      <div className="text-sm mt-1">{appInfo.moduleDescription}</div>
                    </div>
                  )}
                  {appInfo.minAPIVersion && (
                    <div>
                      <span className="text-sm text-muted-foreground">最小 API 版本</span>
                      <div className="font-mono text-sm mt-1">{appInfo.minAPIVersion}</div>
                    </div>
                  )}
                  {appInfo.targetAPIVersion && (
                    <div>
                      <span className="text-sm text-muted-foreground">目标 API 版本</span>
                      <div className="font-mono text-sm mt-1">{appInfo.targetAPIVersion}</div>
                    </div>
                  )}
                  {appInfo.compileSdkVersion && (
                    <div>
                      <span className="text-sm text-muted-foreground">编译 SDK 版本</span>
                      <div className="text-sm mt-1">{appInfo.compileSdkVersion}</div>
                    </div>
                  )}
                  {appInfo.compileMode && (
                    <div>
                      <span className="text-sm text-muted-foreground">编译模式</span>
                      <div className="text-sm mt-1">{appInfo.compileMode}</div>
                    </div>
                  )}
                  {appInfo.virtualMachine && (
                    <div>
                      <span className="text-sm text-muted-foreground">虚拟机版本</span>
                      <div className="text-sm mt-1">{appInfo.virtualMachine}</div>
                    </div>
                  )}
                  {appInfo.deviceTypes && appInfo.deviceTypes.length > 0 && (
                    <div className="col-span-2">
                      <span className="text-sm text-muted-foreground">设备类型</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {appInfo.deviceTypes.map((type, idx) => (
                          <Badge key={idx} variant="secondary">
                            {type}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {appInfo.nativeCode && appInfo.nativeCode.length > 0 && (
                    <div className="col-span-2">
                      <span className="text-sm text-muted-foreground">Native 架构</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {appInfo.nativeCode.map((code, idx) => (
                          <Badge key={idx} variant="secondary">
                            {code}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* 权限列表 */}
              <TabsContent value="permissions" className="mt-4">
                {appInfo.permissions.length > 0 ? (
                  <div className="space-y-2">
                    {appInfo.permissions.map((perm, idx) => (
                      <div key={idx} className="bg-secondary/30 rounded-lg p-3">
                        <div className="font-semibold text-sm">{perm.name}</div>
                        {perm.reason && (
                          <div className="text-xs text-muted-foreground mt-1">{perm.reason}</div>
                        )}
                        {perm.usedScene && (
                          <div className="text-xs text-muted-foreground mt-1">
                            使用场景: {perm.usedScene.when || 'always'}
                            {perm.usedScene.abilities && perm.usedScene.abilities.length > 0 && (
                              <span className="ml-2">
                                能力: {perm.usedScene.abilities.join(', ')}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">无权限要求</div>
                )}
              </TabsContent>

              {/* 能力信息 */}
              <TabsContent value="abilities" className="mt-4">
                {appInfo.abilities && appInfo.abilities.length > 0 ? (
                  <div className="space-y-3">
                    {appInfo.abilities.map((ability, idx) => (
                      <div key={idx} className="bg-secondary/30 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-semibold">{ability.name}</div>
                          {ability.launchType && (
                            <Badge variant="outline">{ability.launchType}</Badge>
                          )}
                        </div>
                        {ability.label && (
                          <div className="text-sm text-muted-foreground mb-1">标签: {ability.label}</div>
                        )}
                        {ability.description && (
                          <div className="text-sm text-muted-foreground mb-2">{ability.description}</div>
                        )}
                        {ability.supportWindowMode && ability.supportWindowMode.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {ability.supportWindowMode.map((mode, modeIdx) => (
                              <Badge key={modeIdx} variant="secondary" className="text-xs">
                                {mode}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {ability.skills && ability.skills.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <div className="text-xs font-semibold text-muted-foreground">支持的 URL Schemes:</div>
                            {ability.skills.map((skill, skillIdx) => {
                              if (!skill.uris || skill.uris.length === 0) return null
                              return (
                                <div key={skillIdx} className="text-xs text-muted-foreground pl-2">
                                  {skill.uris
                                    .map((uri) => uri.scheme || `${uri.host || ''}${uri.path || ''}`)
                                    .filter(Boolean)
                                    .join(', ')}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">无能力信息</div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* 未选择文件时的提示信息 */}
      {!selectedFile && (
        <Card
          ref={dropZoneRef}
          className={`flex-1 flex items-center justify-center bg-black transition-all duration-200 ${
            isDragging ? 'ring-2 ring-primary bg-primary/10' : ''
          }`}
          // data-file-drop-target 是 @wailsio/runtime alpha.79 识别文件拖放区域的必需属性
          data-file-drop-target
        >
          <div className="text-center text-muted-foreground p-8">
            <Download className={`h-16 w-16 mx-auto mb-4 ${isDragging ? 'opacity-60 animate-pulse' : 'opacity-30'}`} />
            <p className="text-lg">点击"选择安装包"</p>
            <p className="text-sm mt-2">
              或将文件拖放到此处(支持{selectedDevice?.platform === 'android' ? '.apk' : '.hap、.hsp、.har、.zip、.gz、.7z、.tar等'}格式)
            </p>
          </div>
        </Card>
      )}

    </div>
  )
}
