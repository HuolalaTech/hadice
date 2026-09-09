import React, { useState, useCallback, useMemo } from 'react'
import { Play, Square, Camera, Video, Settings, Smartphone, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScreenMirror } from '@/components/phoneAgent/ScreenMirror'
import { ChatPanel } from '@/components/phoneAgent/ChatPanel'
import { LLMConfigDialog } from '@/components/phoneAgent/LLMConfigDialog'
import { useDeviceStore } from '@/store/deviceStore'
import { useScreenMirror } from '@/pages/ScreenMirrorScreenshotPage/hooks/useScreenMirror'
import { useScreenshot } from '@/pages/ScreenMirrorScreenshotPage/hooks/useScreenshot'
import { useScreenRecord } from '@/pages/ScreenMirrorScreenshotPage/hooks/useScreenRecord'
import { useTouchEvents } from '@/pages/ScreenMirrorScreenshotPage/hooks/useTouchEvents'
import { createCoordinateConverter } from '@/pages/ScreenMirrorScreenshotPage/utils/coordinates'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { NoDeviceState } from '@/components/layout/NoDeviceState'
import { captureEvent } from '@/lib/posthog'

/**
 * AI自动化页面
 * 左右分栏布局：左侧投屏(35%)，右侧聊天界面(65%)
 */
export function AIAutomationPage(): React.JSX.Element {
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const { selectedDevice } = useDeviceStore()

  // 截屏和录屏相关状态
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg')
  const [customSavePath, setCustomSavePath] = useState<string | null>(null)

  // 投屏相关状态和操作
  const {
    isStreaming,
    isStreamingLoading,
    streamError,
    displaySize,
    imgRef,
    canvasRef,
    handleStartStreaming,
    handleStopStreaming
  } = useScreenMirror(selectedDevice, '0.7')

  // 截图相关
  const { isCapturing, handleCapture, loadHistory, setCurrentScreenshotFromExternal } = useScreenshot(
    selectedDevice,
    format,
    customSavePath
  )

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
  // Android scrcpy：控制通道的坐标空间为视频流分辨率，传 null 让 converter 使用 canvas.width/height
  // HarmonyOS：需要设备实际分辨率
  const isAndroid = selectedDevice?.platform === 'android'
  const convertToDeviceCoordinates = useMemo(
    () => createCoordinateConverter(isAndroid ? canvasRef : imgRef, isAndroid ? null : displaySize),
    [isAndroid, canvasRef, imgRef, displaySize]
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
    handleTouchEnd
  } = useTouchEvents(selectedDevice, isStreaming, convertToDeviceCoordinates)

  const toggleStreaming = useCallback(() => {
    if (isStreaming) {
      handleStopStreaming()
    } else {
      handleStartStreaming()
    }
  }, [isStreaming, handleStartStreaming, handleStopStreaming])

  if (!selectedDevice) {
    return (
      <div className="h-full flex flex-col p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Smartphone className="h-6 w-6 text-primary" />
            </div>
            AI自动化
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
    <div className="h-full flex flex-col">
      {/* 顶部导航栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Smartphone className="h-6 w-6 text-primary" />
          </div>
          AI自动化
          <WindowToggleButton />
            <HelpToggleButton />
        </h1>
        <div className="flex items-center gap-2">
          {/* 投屏按钮 */}
          {!isStreaming ? (
            <Button 
              onClick={toggleStreaming} 
              disabled={isStreamingLoading}
              className="gap-2 bg-orange-600 hover:bg-orange-700"
            >
              <Play className="h-4 w-4" />
              {isStreamingLoading ? '连接中...' : '投屏'}
            </Button>
          ) : (
            <Button 
              onClick={toggleStreaming} 
              disabled={isStreamingLoading}
              variant="destructive"
              className="gap-2"
            >
              <Square className="h-4 w-4" />
              {isStreamingLoading ? '停止中...' : '停止'}
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
            variant="outline"
            size="icon"
            onClick={() => {
              captureEvent('ai config opened')
              setConfigDialogOpen(true)
            }}
            className="h-9 w-9"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 主内容区：左右分栏 */}
      <div className="flex-1 flex overflow-hidden gap-0">
        {/* 左侧：投屏组件 (35%) */}
        <div className="w-[35%] border-r border-border flex-shrink-0 overflow-hidden">
          <ScreenMirror
            isStreaming={isStreaming}
            isStreamingLoading={isStreamingLoading}
            streamError={streamError}
            displaySize={displaySize}
            imgRef={imgRef}
            canvasRef={canvasRef}
            isAndroid={isAndroid}
            onImageClick={handleImageClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        </div>

        {/* 右侧：聊天界面 (65%) */}
        <div className="flex-1 overflow-hidden">
          <ChatPanel />
        </div>
      </div>

      {/* LLM配置对话框 */}
      <LLMConfigDialog open={configDialogOpen} onOpenChange={setConfigDialogOpen} />
    </div>
  )
}
