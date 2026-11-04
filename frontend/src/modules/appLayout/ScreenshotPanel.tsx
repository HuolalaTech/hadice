import React, { useMemo, useRef, useState, useEffect } from 'react'
import type { LayoutBounds } from './types'

interface ScreenshotPanelProps {
  b64?: string
  mime?: string
  highlight?: LayoutBounds | null
  naturalWidth?: number
  naturalHeight?: number
  /** 截图原图像素坐标 + 原图宽高（供映射到布局 bounds） */
  onPick?: (imgX: number, imgY: number, imgW: number, imgH: number) => void
}

export function ScreenshotPanel({
  b64,
  mime = 'image/png',
  highlight,
  naturalWidth,
  naturalHeight,
  onPick
}: ScreenshotPanelProps): React.JSX.Element {
  const imgRef = useRef<HTMLImageElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0, nw: 0, nh: 0 })

  const src = useMemo(() => {
    if (!b64) return ''
    return `data:${mime};base64,${b64}`
  }, [b64, mime])

  useEffect(() => {
    function measure(): void {
      const img = imgRef.current
      if (!img) return
      setBox({
        w: img.clientWidth,
        h: img.clientHeight,
        nw: img.naturalWidth || naturalWidth || 0,
        nh: img.naturalHeight || naturalHeight || 0
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [src, naturalWidth, naturalHeight])

  const overlay = useMemo(() => {
    if (!highlight || !box.nw || !box.nh || !box.w || !box.h) return null
    const sx = box.w / box.nw
    const sy = box.h / box.nh
    return {
      left: highlight.left * sx,
      top: highlight.top * sy,
      width: Math.max(1, (highlight.right - highlight.left) * sx),
      height: Math.max(1, (highlight.bottom - highlight.top) * sy)
    }
  }, [highlight, box])

  function handleClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (!onPick || !box.nw || !box.nh || !box.w || !box.h) return
    const img = imgRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    const localX = e.clientX - rect.left
    const localY = e.clientY - rect.top
    if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return
    const imgX = Math.round((localX / box.w) * box.nw)
    const imgY = Math.round((localY / box.h) * box.nh)
    onPick(imgX, imgY, box.nw, box.nh)
  }

  if (!src) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-muted-foreground">
        暂无截图
      </div>
    )
  }

  return (
    <div className="relative flex h-full items-start justify-center overflow-hidden p-2">
      <div className="relative inline-block max-w-full" onClick={handleClick}>
        <img
          ref={imgRef}
          src={src}
          alt="layout screenshot"
          className="max-h-[calc(100vh-220px)] max-w-full object-contain select-none"
          draggable={false}
          onLoad={() => {
            const img = imgRef.current
            if (!img) return
            setBox({
              w: img.clientWidth,
              h: img.clientHeight,
              nw: img.naturalWidth || naturalWidth || 0,
              nh: img.naturalHeight || naturalHeight || 0
            })
          }}
        />
        {overlay && (
          <div
            className="pointer-events-none absolute border-2 border-red-500 bg-red-500/15"
            style={{
              left: overlay.left,
              top: overlay.top,
              width: overlay.width,
              height: overlay.height
            }}
          />
        )}
      </div>
    </div>
  )
}
