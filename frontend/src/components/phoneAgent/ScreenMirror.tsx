import React, { RefObject } from 'react'
import { MonitorSmartphone } from 'lucide-react'

interface ScreenMirrorProps {
  isStreaming: boolean
  isStreamingLoading: boolean
  streamError: string | null
  displaySize: { width: number; height: number } | null
  imgRef: RefObject<HTMLImageElement | null>
  canvasRef?: RefObject<HTMLCanvasElement | null>
  isAndroid?: boolean
  onImageClick?: (event: React.MouseEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onMouseDown?: (event: React.MouseEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onMouseMove?: (event: React.MouseEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onMouseUp?: (event: React.MouseEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onMouseLeave?: () => void
  onTouchStart?: (event: React.TouchEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onTouchMove?: (event: React.TouchEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onTouchEnd?: (event: React.TouchEvent<HTMLImageElement | HTMLCanvasElement>) => void
}

const containerStyle: React.CSSProperties = {
  maxHeight: '100%',
  maxWidth: '100%',
  objectFit: 'contain',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none'
}

const placeholderStyle: React.CSSProperties = {
  aspectRatio: '9 / 19.5',
  height: '100%',
  width: 'auto',
  border: '2px dashed hsl(var(--primary) / 0.3)',
  borderRadius: '0.5rem',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center'
}

/**
 * 投屏组件
 * 显示设备屏幕镜像（复用 ScreenMirrorView 的渲染逻辑）
 * 支持触摸和鼠标事件
 */
export function ScreenMirror({
  isStreaming,
  isStreamingLoading,
  streamError,
  imgRef,
  canvasRef,
  isAndroid,
  onImageClick,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onTouchStart,
  onTouchMove,
  onTouchEnd
}: ScreenMirrorProps): React.JSX.Element {
  return (
    <div className="h-full flex flex-col bg-muted/30">
      {/* 投屏显示区域 */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-3">
        {isAndroid ? (
          /* Android: canvas 始终存在于 DOM，通过 display 控制可见性
             这样 useScreenMirror 中的 canvasRef.current 在投屏启动前就已可用 */
          <div className="relative h-full w-full flex items-center justify-center">
            <canvas
              ref={canvasRef}
              onMouseDown={onMouseDown as React.MouseEventHandler<HTMLCanvasElement>}
              onMouseMove={onMouseMove as React.MouseEventHandler<HTMLCanvasElement>}
              onMouseUp={onMouseUp as React.MouseEventHandler<HTMLCanvasElement>}
              onMouseLeave={onMouseLeave}
              onTouchStart={onTouchStart as React.TouchEventHandler<HTMLCanvasElement>}
              onTouchMove={onTouchMove as React.TouchEventHandler<HTMLCanvasElement>}
              onTouchEnd={onTouchEnd as React.TouchEventHandler<HTMLCanvasElement>}
              className="h-full w-auto cursor-pointer select-none border-2 border-primary/50 rounded-lg shadow-lg touch-none"
              style={{
                ...containerStyle,
                display: isStreaming ? 'block' : 'none'
              }}
            />
            {!isStreaming && (
              <div className="text-center text-muted-foreground absolute" style={placeholderStyle}>
                <MonitorSmartphone className="h-16 w-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg">点击"投屏"开始</p>
                <p className="text-sm mt-2">将显示设备屏幕内容</p>
              </div>
            )}
          </div>
        ) : (
          /* HarmonyOS: img 在投屏时渲染 */
          <div className="relative h-full w-full flex items-center justify-center">
            {isStreaming ? (
              <img
                ref={imgRef}
                onClick={onImageClick as React.MouseEventHandler<HTMLImageElement>}
                onMouseDown={onMouseDown as React.MouseEventHandler<HTMLImageElement>}
                onMouseMove={onMouseMove as React.MouseEventHandler<HTMLImageElement>}
                onMouseUp={onMouseUp as React.MouseEventHandler<HTMLImageElement>}
                onMouseLeave={onMouseLeave}
                onTouchStart={onTouchStart as React.TouchEventHandler<HTMLImageElement>}
                onTouchMove={onTouchMove as React.TouchEventHandler<HTMLImageElement>}
                onTouchEnd={onTouchEnd as React.TouchEventHandler<HTMLImageElement>}
                className="h-full w-auto cursor-pointer select-none border-2 border-primary/50 rounded-lg shadow-lg touch-none"
                style={containerStyle}
                alt="设备屏幕"
                draggable={false}
              />
            ) : (
              <div className="text-center text-muted-foreground" style={placeholderStyle}>
                <MonitorSmartphone className="h-16 w-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg">点击"投屏"开始</p>
                <p className="text-sm mt-2">将显示设备屏幕内容</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {streamError && (
        <div className="px-3 pb-3">
          <div className="p-2 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-xs">
            {streamError}
          </div>
        </div>
      )}

      {/* 加载状态 */}
      {isStreamingLoading && (
        <div className="px-3 pb-3">
          <div className="text-center text-sm text-muted-foreground">
            {isStreaming ? '停止中...' : '连接中...'}
          </div>
        </div>
      )}
    </div>
  )
}
