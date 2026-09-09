import React, { useState, useCallback, useMemo } from 'react'
import {
  Camera,
  Video,
  RefreshCw,
  MonitorSmartphone,
  Play,
  Square,
  Settings
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDeviceStore } from '@/store/deviceStore'
import { useScreenMirror } from './hooks/useScreenMirror'
import { useScreenshot } from './hooks/useScreenshot'
import { useScreenRecord } from './hooks/useScreenRecord'
import { useTouchEvents } from './hooks/useTouchEvents'
import { useSavePath } from './hooks/useSavePath'
import { createCoordinateConverter } from './utils/coordinates'
import { ScreenMirrorView } from './components/ScreenMirrorView'
import { ControlButtons } from './components/ControlButtons'
import { ScreenshotGallery } from './components/ScreenshotGallery'
import { SettingsDialog } from './components/SettingsDialog'
import { PreviewDialog } from './components/PreviewDialog'
import { DeleteDialog } from './components/DeleteDialog'
import type { ScreenshotHistoryItem } from '@/types/hdc'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { NoDeviceState } from '@/components/layout/NoDeviceState'

/**
 * 投屏截屏页面
 */
export function ScreenMirrorScreenshotPage(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()

  // 设置相关状态
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg')
  const [videoQuality, setVideoQuality] = useState<'0.2' | '0.3' | '0.4' | '0.5' | '0.6' | '0.7' | '0.8' | '0.9'>('0.9')
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)

  // 预览和删除弹窗状态
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false)
  const [previewImageData, setPreviewImageData] = useState<string>('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ScreenshotHistoryItem | null>(null)

  // 保存路径管理
  const { savePath, customSavePath, setSavePath, setCustomSavePath, saveCustomPath } = useSavePath()

  // 投屏相关
  const {
    isStreaming,
    isStreamingLoading,
    streamError,
    displaySize,
    isH264,
    imgRef,
    canvasRef,
    handleStartStreaming,
    handleStopStreaming,
    handleControlAction
  } = useScreenMirror(selectedDevice, videoQuality)

  const isAndroid = selectedDevice?.platform === 'android'

  // 截图相关
  const {
    currentScreenshot,
    history,
    imageCache,
    imageDimensions,
    isCapturing,
    handleCapture,
    handleOpenFile,
    handleCopyImage,
    handleViewImage,
    handleDeleteScreenshot,
    loadHistory,
    setCurrentScreenshotFromExternal
  } = useScreenshot(selectedDevice, format, customSavePath)

  // 录屏相关
  const { isRecording, recordingFileName, handleStartRecord, handleStopRecord } = useScreenRecord(
    selectedDevice,
    customSavePath,
    (info) => {
      // 录屏完成后设置当前截图，确保显示在第一个位置
      setCurrentScreenshotFromExternal(info)
    },
    loadHistory
  )

  // 坐标转换器
  // H.264（Android/HarmonyOS）使用 Canvas 解码分辨率；JPEG 回退使用图片自然尺寸。
  const convertToDeviceCoordinates = useMemo(
    () =>
      createCoordinateConverter(
        isAndroid || isH264 ? canvasRef : imgRef,
        isAndroid ? null : displaySize,
      ),
    [isAndroid, isH264, canvasRef, imgRef, displaySize],
  )

  // 触摸事件处理
  const {
    handleImageClick,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    handleWheel
  } = useTouchEvents(selectedDevice, isStreaming, convertToDeviceCoordinates)

  /**
   * 处理查看图片
   */
  const handleView = useCallback(async (filePath: string) => {
    const imageData = await handleViewImage(filePath)
    if (imageData) {
      setPreviewImageData(imageData)
      setPreviewDialogOpen(true)
    }
  }, [handleViewImage])

  /**
   * 处理删除截图
   */
  const handleDelete = useCallback(async () => {
    if (deleteTarget) {
      await handleDeleteScreenshot(deleteTarget)
      setDeleteDialogOpen(false)
      setDeleteTarget(null)
    }
  }, [deleteTarget, handleDeleteScreenshot])

  /**
   * 选择保存路径
   */
  const handleSelectSavePath = useCallback(async () => {
    if (!window.hdc) return

    try {
      const selectedPath = await window.hdc.selectScreenshotPath()
      if (selectedPath) {
        setCustomSavePath(selectedPath)
        setSavePath(selectedPath)
        saveCustomPath(selectedPath)
      }
    } catch (error) {
      console.error('[Screenshot] Failed to select path:', error)
    }
  }, [setCustomSavePath, setSavePath, saveCustomPath])

  // 未连接设备
  if (!selectedDevice) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <MonitorSmartphone className="h-6 w-6 text-primary" />
            投屏截屏
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
    <div className="p-2 h-full flex flex-col overflow-hidden">
      {/* 标题栏 */}
      <div className="mb-2 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MonitorSmartphone className="h-6 w-6 text-primary" />
          投屏截屏
          <WindowToggleButton />
            <HelpToggleButton />
        </h1>
        <div className="flex items-center gap-1">
          {/* 投屏按钮 */}
          {!isStreaming ? (
            <Button onClick={handleStartStreaming} disabled={isStreamingLoading} className="gap-2">
              <Play className="h-4 w-4" />
              {isStreamingLoading ? '连接中...' : '投屏'}
            </Button>
          ) : (
            <Button onClick={handleStopStreaming} disabled={isStreamingLoading} variant="destructive" className="gap-2">
              <Square className="h-4 w-4" />
              {isStreamingLoading ? '停止中...' : '投屏'}
            </Button>
          )}

          {/* 截屏按钮 */}
          <Button onClick={handleCapture} disabled={isCapturing} className="gap-2">
            {isCapturing ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                截图中...
              </>
            ) : (
              <>
                <Camera className="h-4 w-4" />
                截屏
              </>
            )}
          </Button>

          {/* 录屏按钮 */}
          {isRecording ? (
            <Button
              variant="destructive"
              onClick={handleStopRecord}
              disabled={!recordingFileName}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4 animate-spin" />
              录屏
            </Button>
          ) : (
            <Button variant="outline" onClick={handleStartRecord} disabled={isCapturing} className="gap-2">
              <Video className="h-4 w-4" />
              录屏
            </Button>
          )}

          {/* 设置按钮 */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsDialogOpen(true)}
            className="h-9 w-9"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 错误提示 */}
      {streamError && (
        <div className="mb-2 p-2 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm">
          {streamError}
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex-1 flex gap-1 min-h-0 overflow-hidden">
        {/* 左侧：投屏显示区域和控制按钮 */}
        <div className="flex gap-1 flex-shrink-0">
          <ScreenMirrorView
            isStreaming={isStreaming}
            isAndroid={isAndroid}
            isH264={isH264}
            imgRef={imgRef}
            canvasRef={canvasRef}
            onImageClick={handleImageClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
            onWheel={handleWheel}
          />

          <ControlButtons isStreaming={isStreaming} onAction={handleControlAction} />
        </div>

        {/* 右侧：图片画廊 */}
        <ScreenshotGallery
          currentScreenshot={currentScreenshot}
          history={history}
          imageCache={imageCache}
          imageDimensions={imageDimensions}
          onView={handleView}
          onOpen={handleOpenFile}
          onCopy={handleCopyImage}
        />
      </div>

      {/* 设置弹窗 */}
      <SettingsDialog
        open={settingsDialogOpen}
        onOpenChange={setSettingsDialogOpen}
        format={format}
        onFormatChange={setFormat}
        savePath={savePath}
        onSavePathChange={(path) => {
          setSavePath(path)
          setCustomSavePath(path)
          saveCustomPath(path)
        }}
        videoQuality={videoQuality}
        onVideoQualityChange={setVideoQuality}
        platform={selectedDevice?.platform}
      />

      {/* 全屏预览弹窗 */}
      <PreviewDialog
        open={previewDialogOpen}
        onOpenChange={(open) => {
          setPreviewDialogOpen(open)
          if (!open) {
            setPreviewImageData('')
          }
        }}
        imageData={previewImageData}
      />

      {/* 删除确认弹窗 */}
      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        target={deleteTarget}
        onConfirm={handleDelete}
      />
    </div>
  )
}
