import React, { useCallback } from 'react'
import { FolderSync, RefreshCw, Smartphone, Monitor, ArrowRight, ArrowLeft } from 'lucide-react'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { Button } from '@/components/ui/button'
import { useDeviceStore } from '@/store/deviceStore'
import { FileBrowserPane } from '@/components/file/FileBrowserPane'
import { TransferQueue } from '@/components/file/TransferQueue'
import { useFileBrowser } from '@/hooks/useFileBrowser'
import { useFileTransfer } from '@/hooks/useFileTransfer'
import { isHdcAvailable } from '@/lib/hdc'
import { captureEvent } from '@/lib/posthog'
import type { FileItem } from '@/types/hdc'

/**
 * 文件传输页面
 */
export function FileTransferPage(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()
  const platform = selectedDevice?.platform || 'harmonyos'

  // 设备文件浏览器
  const deviceBrowser = useFileBrowser(true, selectedDevice, platform)

  // 本地文件浏览器
  const localBrowser = useFileBrowser(false, null, 'local')

  // 传输完成回调 - 刷新目标目录
  const handleTransferComplete = useCallback((targetDir: string, isDevice: boolean) => {
    if (isDevice) {
      if (targetDir === deviceBrowser.path) {
        deviceBrowser.loadDirectory()
      } else {
        deviceBrowser.setPath(targetDir)
      }
    } else {
      if (targetDir === localBrowser.path || (targetDir === '/' && !localBrowser.path)) {
        localBrowser.loadDirectory()
      } else {
        localBrowser.setPath(targetDir)
      }
    }
  }, [deviceBrowser, localBrowser])

  // 文件传输管理
  const { transferTasks, scrollAreaRef, addTransferTask, removeTask } = useFileTransfer(selectedDevice, platform)

  // 处理路径输入键盘事件
  const handleDevicePathInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      deviceBrowser.handlePathInputSubmit()
    }
  }, [deviceBrowser])

  const handleLocalPathInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      localBrowser.handlePathInputSubmit()
    }
  }, [localBrowser])

  // 推送到设备
  const handlePushToDevice = useCallback(() => {
    if (!selectedDevice || localBrowser.selectedFiles.size === 0) {
      console.warn('[FileTransfer] No files selected or no device')
      return
    }

    console.log('[FileTransfer] Pushing files:', Array.from(localBrowser.selectedFiles))
    console.log('[FileTransfer] Available files:', localBrowser.files.map(f => ({ name: f.name, path: f.path })))

    localBrowser.selectedFiles.forEach((filePath) => {
      const file = localBrowser.files.find((f) => f.path === filePath)
      if (!file) {
        console.warn('[FileTransfer] File not found:', filePath)
        return
      }

      const targetPath = `${deviceBrowser.path}/${file.name}`
      console.log('[FileTransfer] Adding transfer task:', {
        sourcePath: filePath,
        targetPath,
        fileName: file.name
      })
      
      addTransferTask(
        filePath,
        targetPath,
        'push',
        file.name,
        file.isDirectory,
        file.size,
        handleTransferComplete
      )
    })

    localBrowser.setSelectedFiles(new Set())
  }, [selectedDevice, localBrowser, deviceBrowser.path, addTransferTask, handleTransferComplete])

  // 拉取到本地
  const handlePullToLocal = useCallback(() => {
    if (!selectedDevice || deviceBrowser.selectedFiles.size === 0) {
      console.warn('[FileTransfer] No files selected or no device')
      return
    }

    console.log('[FileTransfer] Pulling files:', Array.from(deviceBrowser.selectedFiles))
    console.log('[FileTransfer] Available files:', deviceBrowser.files.map(f => ({ name: f.name, path: f.path })))

    deviceBrowser.selectedFiles.forEach((filePath) => {
      const file = deviceBrowser.files.find((f) => f.path === filePath)
      if (!file) {
        console.warn('[FileTransfer] File not found:', filePath)
        return
      }

      // 确保目标路径格式正确（移除多余的斜杠）
      const cleanLocalPath = localBrowser.path.endsWith('/') ? localBrowser.path.slice(0, -1) : localBrowser.path
      const targetPath = `${cleanLocalPath}/${file.name}`
      
      console.log('[FileTransfer] Adding transfer task:', {
        sourcePath: filePath,
        targetPath,
        fileName: file.name
      })
      
      addTransferTask(
        filePath,
        targetPath,
        'pull',
        file.name,
        file.isDirectory,
        file.size,
        handleTransferComplete
      )
    })

    deviceBrowser.setSelectedFiles(new Set())
  }, [selectedDevice, deviceBrowser, localBrowser.path, addTransferTask, handleTransferComplete])

  // 删除设备文件
  const handleDeleteDeviceFile = useCallback(async (file: FileItem) => {
    
    if (!selectedDevice || !isHdcAvailable()) {
      console.warn('[FileTransfer] Device not selected or HDC not available')
      return
    }

    try {
      const result = await window.hdc.deleteDeviceFile(selectedDevice.connectKey, file.path, platform)
      if (result.success) {
        captureEvent('device file deleted', { file_name: file.name, file_type: file.isDirectory ? 'directory' : 'file' })
        // 刷新列表
        await deviceBrowser.loadDirectory()
      } else {
      }
    } catch (error) {
    }
  }, [selectedDevice, deviceBrowser.loadDirectory, platform])

  // 删除本地文件
  const handleDeleteLocalFile = useCallback(async (file: FileItem) => {
    
    if (!isHdcAvailable()) {
      console.warn('[FileTransfer] HDC not available')
      return
    }

    try {
      const result = await window.hdc.deleteLocalFile(file.path)
      if (result.success) {
        // 刷新列表
        await localBrowser.loadDirectory()
      } else {
      }
    } catch (error) {
    }
  }, [localBrowser.loadDirectory])

  return (
    <div className="p-6 h-full flex flex-col">
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <FolderSync className="h-6 w-6 text-primary" />
          文件传输
          <WindowToggleButton />
            <HelpToggleButton />
        </h1>
      </div>

      {/* 双窗格文件管理器 */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* 设备文件窗格 */}
        <FileBrowserPane
          title="设备文件"
          icon={Smartphone}
          path={deviceBrowser.path}
          pathInput={deviceBrowser.pathInput}
          files={deviceBrowser.files}
          loading={deviceBrowser.loading}
          error={deviceBrowser.error}
          selectedFiles={deviceBrowser.selectedFiles}
          scrollAreaRef={deviceBrowser.scrollAreaRef}
          onPathInputChange={deviceBrowser.handlePathInputChange}
          onPathInputSubmit={deviceBrowser.handlePathInputSubmit}
          onPathInputKeyDown={handleDevicePathInputKeyDown}
          onNavigateUp={deviceBrowser.navigateUp}
          onNavigateHome={deviceBrowser.navigateHome}
          onRefresh={deviceBrowser.loadDirectory}
          onFileClick={deviceBrowser.handleFileClick}
          pathHistory={deviceBrowser.history}
          onPathHistorySelect={deviceBrowser.navigateTo}
          onRemovePathHistory={deviceBrowser.removeFromHistory}
          isDevice={true}
          onDeleteFile={handleDeleteDeviceFile}
          actionButton={
            <Button
              variant={deviceBrowser.selectedFiles.size > 0 ? 'default' : 'outline'}
              size="sm"
              onClick={handlePullToLocal}
              disabled={!selectedDevice || deviceBrowser.selectedFiles.size === 0}
              className="h-7"
            >
              拉取到本地 <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          }
        />

        {/* 本地文件窗格 */}
        <FileBrowserPane
          title="本地文件"
          icon={Monitor}
          path={localBrowser.path}
          pathInput={localBrowser.pathInput}
          files={localBrowser.files}
          loading={localBrowser.loading}
          error={localBrowser.error}
          selectedFiles={localBrowser.selectedFiles}
          scrollAreaRef={localBrowser.scrollAreaRef}
          onPathInputChange={localBrowser.handlePathInputChange}
          onPathInputSubmit={localBrowser.handlePathInputSubmit}
          onPathInputKeyDown={handleLocalPathInputKeyDown}
          onNavigateUp={localBrowser.navigateUp}
          onNavigateHome={localBrowser.navigateHome}
          onRefresh={localBrowser.loadDirectory}
          onFileClick={localBrowser.handleFileClick}
          showOpenButton={true}
          pathHistory={localBrowser.history}
          onPathHistorySelect={localBrowser.navigateTo}
          onRemovePathHistory={localBrowser.removeFromHistory}
          isDevice={false}
          onDeleteFile={handleDeleteLocalFile}
          actionButton={
            <Button
              variant={localBrowser.selectedFiles.size > 0 ? 'default' : 'outline'}
              size="sm"
              onClick={handlePushToDevice}
              disabled={!selectedDevice || localBrowser.selectedFiles.size === 0}
              className="h-7"
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> 推送到设备
            </Button>
          }
        />
      </div>

      {/* 传输队列 */}
      <TransferQueue
        tasks={transferTasks}
        scrollAreaRef={scrollAreaRef}
        onRemoveTask={removeTask}
      />
    </div>
  )
}