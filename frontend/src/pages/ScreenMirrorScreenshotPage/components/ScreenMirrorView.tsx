import React, { RefObject } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { Card } from '@/components/ui/card'

interface ScreenMirrorViewProps {
  isStreaming: boolean
  isAndroid: boolean
  isH264: boolean
  imgRef: RefObject<HTMLImageElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  onImageClick: (event: React.MouseEvent<HTMLImageElement>) => void
  onMouseDown: (event: React.MouseEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onMouseMove: (event: React.MouseEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onMouseUp: (event: React.MouseEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onMouseLeave: () => void
  onTouchStart: (event: React.TouchEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onTouchMove: (event: React.TouchEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onTouchEnd: (event: React.TouchEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onTouchCancel?: (event: React.TouchEvent<HTMLImageElement | HTMLCanvasElement>) => void
  onWheel?: (event: React.WheelEvent<HTMLImageElement | HTMLCanvasElement>) => void
}

export function ScreenMirrorView({
  isStreaming,
  isAndroid,
  isH264,
  imgRef,
  canvasRef,
  onImageClick,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  onWheel
}: ScreenMirrorViewProps): React.JSX.Element {
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

  return (
    <Card className="w-[400px] flex items-center justify-center overflow-visible bg-transparent border-0 shadow-none min-w-0 relative flex-shrink-0 p-0">
      <div
        className="relative h-full w-auto flex items-center justify-center select-none"
        style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
        onMouseDownCapture={(event) => event.preventDefault()}
        onTouchStartCapture={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown as React.MouseEventHandler<HTMLCanvasElement>}
          onMouseMove={onMouseMove as React.MouseEventHandler<HTMLCanvasElement>}
          onMouseUp={onMouseUp as React.MouseEventHandler<HTMLCanvasElement>}
          onMouseLeave={onMouseLeave}
          onTouchStart={onTouchStart as React.TouchEventHandler<HTMLCanvasElement>}
          onTouchMove={onTouchMove as React.TouchEventHandler<HTMLCanvasElement>}
          onTouchEnd={onTouchEnd as React.TouchEventHandler<HTMLCanvasElement>}
          onTouchCancel={onTouchCancel as React.TouchEventHandler<HTMLCanvasElement>}
          onWheel={onWheel as React.WheelEventHandler<HTMLCanvasElement>}
          draggable={false}
          className="h-full w-auto cursor-pointer select-none border-2 border-primary/50 rounded-lg shadow-lg touch-none"
          style={{ ...containerStyle, display: isStreaming && (isAndroid || isH264) ? 'block' : 'none' }}
        />
        <img
          ref={imgRef}
          onClick={onImageClick}
          onMouseDown={onMouseDown as React.MouseEventHandler<HTMLImageElement>}
          onMouseMove={onMouseMove as React.MouseEventHandler<HTMLImageElement>}
          onMouseUp={onMouseUp as React.MouseEventHandler<HTMLImageElement>}
          onMouseLeave={onMouseLeave}
          onTouchStart={onTouchStart as React.TouchEventHandler<HTMLImageElement>}
          onTouchMove={onTouchMove as React.TouchEventHandler<HTMLImageElement>}
          onTouchEnd={onTouchEnd as React.TouchEventHandler<HTMLImageElement>}
          onTouchCancel={onTouchCancel as React.TouchEventHandler<HTMLImageElement>}
          onWheel={onWheel as React.WheelEventHandler<HTMLImageElement>}
          className="h-full w-auto cursor-pointer select-none border-2 border-primary/50 rounded-lg shadow-lg touch-none"
          style={{ ...containerStyle, display: isStreaming && !isH264 && !isAndroid ? 'block' : 'none' }}
          alt="设备屏幕"
          draggable={false}
        />
        {!isStreaming && (
          <div className="text-center text-muted-foreground" style={placeholderStyle}>
            <MonitorSmartphone className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <p className="text-lg">点击"投屏"开始</p>
            <p className="text-sm mt-2">将显示设备屏幕内容</p>
          </div>
        )}
      </div>
    </Card>
  )
}
