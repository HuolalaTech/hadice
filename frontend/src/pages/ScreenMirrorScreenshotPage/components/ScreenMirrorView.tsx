import React, { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { Card } from '@/components/ui/card'

interface ScreenMirrorViewProps {
  isStreaming: boolean
  isAndroid: boolean
  isH264: boolean
  displaySize: { width: number; height: number } | null
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
  displaySize,
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
  const containerRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    edge: ResizeEdge
    startX: number
    startY: number
    startWidth: number
    startHeight: number
  } | null>(null)
  const [preferredHeight, setPreferredHeight] = useState<number | null>(null)
  const [maxFrameHeight, setMaxFrameHeight] = useState<number | null>(null)

  const aspectRatio = useMemo(() => {
    if (displaySize?.width && displaySize?.height) {
      return displaySize.width / displaySize.height
    }
    return 9 / 19.5
  }, [displaySize])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateMaximumSize = () => {
      const { width, height } = container.getBoundingClientRect()
      setMaxFrameHeight(Math.max(0, Math.min(height, width / aspectRatio)))
    }

    updateMaximumSize()
    const observer = new ResizeObserver(updateMaximumSize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [aspectRatio])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      const container = containerRef.current
      if (!drag || !container) return

      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      const horizontalDirection = drag.edge.includes('e') ? 1 : drag.edge.includes('w') ? -1 : 0
      const verticalDirection = drag.edge.includes('s') ? 1 : drag.edge.includes('n') ? -1 : 0

      let scale: number
      if (horizontalDirection && verticalDirection) {
        // Project the pointer movement onto the corner's diagonal so the frame
        // always keeps the device aspect ratio.
        const vectorX = horizontalDirection * drag.startWidth
        const vectorY = verticalDirection * drag.startHeight
        scale = 1 + (deltaX * vectorX + deltaY * vectorY) /
          (drag.startWidth ** 2 + drag.startHeight ** 2)
      } else if (horizontalDirection) {
        scale = 1 + (deltaX * horizontalDirection) / drag.startWidth
      } else {
        scale = 1 + (deltaY * verticalDirection) / drag.startHeight
      }

      const bounds = container.getBoundingClientRect()
      const maximumHeight = Math.min(bounds.height, bounds.width / aspectRatio)
      const minimumHeight = Math.min(180, maximumHeight)
      const nextHeight = Math.min(maximumHeight, Math.max(minimumHeight, drag.startHeight * scale))
      setPreferredHeight(nextHeight)
    }

    const finishResize = () => {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [aspectRatio])

  const startResize = useCallback((edge: ResizeEdge, event: React.PointerEvent<HTMLDivElement>) => {
    const frame = frameRef.current
    if (!frame) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const bounds = frame.getBoundingClientRect()
    dragRef.current = {
      edge,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: bounds.width,
      startHeight: bounds.height
    }
    document.body.style.cursor = resizeCursors[edge]
    document.body.style.userSelect = 'none'
  }, [])

  const renderedHeight = maxFrameHeight === null
    ? preferredHeight
    : Math.min(preferredHeight ?? maxFrameHeight, maxFrameHeight)

  const containerStyle: React.CSSProperties = {
    maxHeight: '100%',
    maxWidth: '100%',
    objectFit: 'contain',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none'
  }

  const placeholderStyle: React.CSSProperties = {
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  }

  return (
    <Card
      ref={containerRef}
      className="w-[400px] flex items-center justify-center overflow-visible bg-transparent border-0 shadow-none min-w-0 relative flex-shrink-0 p-0"
    >
      <div
        ref={frameRef}
        className="relative flex items-center justify-center select-none border-2 border-dashed border-primary/50 rounded-lg shadow-lg"
        style={{
          aspectRatio,
          height: renderedHeight === null ? '100%' : `${renderedHeight}px`,
          maxHeight: '100%',
          maxWidth: '100%',
          userSelect: 'none',
          WebkitUserSelect: 'none'
        }}
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
          className="h-full w-full cursor-pointer select-none rounded-[calc(0.5rem-2px)] touch-none"
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
          className="h-full w-full cursor-pointer select-none rounded-[calc(0.5rem-2px)] touch-none"
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
        {resizeHandles.map(({ edge, className }) => (
          <div
            key={edge}
            className={`absolute z-20 ${className}`}
            style={{ cursor: resizeCursors[edge], touchAction: 'none' }}
            onPointerDown={(event) => startResize(edge, event)}
            title="拖动调整投屏大小"
          />
        ))}
      </div>
    </Card>
  )
}

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const resizeCursors: Record<ResizeEdge, React.CSSProperties['cursor']> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize'
}

const resizeHandles: Array<{ edge: ResizeEdge; className: string }> = [
  { edge: 'n', className: '-top-1.5 left-3 right-3 h-3' },
  { edge: 's', className: '-bottom-1.5 left-3 right-3 h-3' },
  { edge: 'e', className: 'top-3 bottom-3 -right-1.5 w-3' },
  { edge: 'w', className: 'top-3 bottom-3 -left-1.5 w-3' },
  { edge: 'ne', className: '-top-1.5 -right-1.5 h-4 w-4' },
  { edge: 'nw', className: '-top-1.5 -left-1.5 h-4 w-4' },
  { edge: 'se', className: '-bottom-1.5 -right-1.5 h-4 w-4' },
  { edge: 'sw', className: '-bottom-1.5 -left-1.5 h-4 w-4' }
]
