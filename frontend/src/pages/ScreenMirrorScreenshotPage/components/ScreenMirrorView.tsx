import React, { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { Card } from '@/components/ui/card'

interface ScreenMirrorViewProps {
  isStreaming: boolean
  isAndroid: boolean
  isH264: boolean
  displaySize: { width: number; height: number } | null
  rotationQuarterTurns: number
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
  rotationQuarterTurns,
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
      const { height } = container.getBoundingClientRect()
      if (height > 0) {
        setMaxFrameHeight(getMaximumFrameHeight(height, aspectRatio, rotationQuarterTurns))
      }
    }

    updateMaximumSize()
    const observer = new ResizeObserver(updateMaximumSize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [aspectRatio, rotationQuarterTurns])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      const container = containerRef.current
      if (!drag || !container) return

      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      const horizontalDirection = drag.edge.includes('e') ? 1 : drag.edge.includes('w') ? -1 : 0
      const verticalDirection = drag.edge.includes('s') ? 1 : drag.edge.includes('n') ? -1 : 0
      const angle = -rotationQuarterTurns * Math.PI / 2
      const cos = Math.round(Math.cos(angle))
      const sin = Math.round(Math.sin(angle))

      let scale: number
      if (horizontalDirection && verticalDirection) {
        // Project the pointer movement onto the corner's diagonal so the frame
        // always keeps the device aspect ratio.
        const logicalVectorX = horizontalDirection * drag.startWidth
        const logicalVectorY = verticalDirection * drag.startHeight
        const vectorX = logicalVectorX * cos - logicalVectorY * sin
        const vectorY = logicalVectorX * sin + logicalVectorY * cos
        scale = 1 + (deltaX * vectorX + deltaY * vectorY) /
          (drag.startWidth ** 2 + drag.startHeight ** 2)
      } else {
        const logicalDirectionX = horizontalDirection
        const logicalDirectionY = verticalDirection
        const directionX = logicalDirectionX * cos - logicalDirectionY * sin
        const directionY = logicalDirectionX * sin + logicalDirectionY * cos
        const projectedDelta = deltaX * directionX + deltaY * directionY
        const startLength = horizontalDirection ? drag.startWidth : drag.startHeight
        scale = 1 + projectedDelta / startLength
      }

      const bounds = container.getBoundingClientRect()
      const maximumHeight = getMaximumFrameHeight(
        bounds.height,
        aspectRatio,
        rotationQuarterTurns
      )
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
  }, [aspectRatio, rotationQuarterTurns])

  const startResize = useCallback((edge: ResizeEdge, event: React.PointerEvent<HTMLDivElement>) => {
    const frame = frameRef.current
    if (!frame) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      edge,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: frame.offsetWidth,
      startHeight: frame.offsetHeight
    }
    document.body.style.cursor = getResizeCursor(edge, rotationQuarterTurns)
    document.body.style.userSelect = 'none'
  }, [rotationQuarterTurns])

  const renderedHeight = maxFrameHeight === null
    ? preferredHeight
    : Math.min(preferredHeight ?? maxFrameHeight, maxFrameHeight)
  const logicalWidth = renderedHeight === null ? null : renderedHeight * aspectRatio
  const isSideways = rotationQuarterTurns % 2 === 1
  const stageWidth = renderedHeight === null
    ? MAX_FRAME_SHORT_EDGE
    : isSideways ? renderedHeight : logicalWidth
  const frameTransform = getFrameTransform(
    rotationQuarterTurns,
    logicalWidth ?? 0,
    renderedHeight ?? 0
  )

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
      className="h-full overflow-visible bg-transparent border-0 shadow-none min-w-0 relative flex-shrink-0 p-0"
      style={{ width: `${stageWidth}px` }}
    >
      <div
        ref={frameRef}
        className="absolute left-0 top-0 flex items-center justify-center select-none border-2 border-dashed border-primary/50 rounded-lg shadow-lg"
        style={{
          aspectRatio,
          height: renderedHeight === null ? '100%' : `${renderedHeight}px`,
          maxHeight: '100%',
          maxWidth: '100%',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          transform: frameTransform,
          transformOrigin: 'top left'
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
            style={{ cursor: getResizeCursor(edge, rotationQuarterTurns), touchAction: 'none' }}
            onPointerDown={(event) => startResize(edge, event)}
            title="拖动调整投屏大小"
          />
        ))}
      </div>
    </Card>
  )
}

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const MAX_FRAME_SHORT_EDGE = 400

function getMaximumFrameHeight(
  containerHeight: number,
  aspectRatio: number,
  rotationQuarterTurns: number
): number {
  const shortEdgeLimit = aspectRatio <= 1
    ? MAX_FRAME_SHORT_EDGE / aspectRatio
    : MAX_FRAME_SHORT_EDGE
  const isSideways = rotationQuarterTurns % 2 === 1
  const verticalLimit = isSideways ? containerHeight / aspectRatio : containerHeight
  return Math.max(0, Math.min(shortEdgeLimit, verticalLimit))
}

function getFrameTransform(rotationQuarterTurns: number, width: number, height: number): string {
  const rotation = ((rotationQuarterTurns % 4) + 4) % 4
  if (rotation === 1) return `matrix(0, -1, 1, 0, 0, ${width})`
  if (rotation === 2) return `matrix(-1, 0, 0, -1, ${width}, ${height})`
  if (rotation === 3) return `matrix(0, 1, -1, 0, ${height}, 0)`
  return 'none'
}

function getResizeCursor(
  edge: ResizeEdge,
  rotationQuarterTurns: number
): React.CSSProperties['cursor'] {
  const logicalX = edge.includes('e') ? 1 : edge.includes('w') ? -1 : 0
  const logicalY = edge.includes('s') ? 1 : edge.includes('n') ? -1 : 0
  const angle = -rotationQuarterTurns * Math.PI / 2
  const screenX = Math.round(logicalX * Math.cos(angle) - logicalY * Math.sin(angle))
  const screenY = Math.round(logicalX * Math.sin(angle) + logicalY * Math.cos(angle))

  if (screenX === 0) return 'ns-resize'
  if (screenY === 0) return 'ew-resize'
  return screenX * screenY > 0 ? 'nwse-resize' : 'nesw-resize'
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
