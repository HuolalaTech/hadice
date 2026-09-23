import React, { useState } from 'react'
import { Maximize2, FileText, Copy, Image, Video, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ScreenshotHistoryItem } from '@/types/hdc'
import { formatTimeShort } from '../utils/format'

interface ScreenshotCardProps {
  item: ScreenshotHistoryItem
  isNew?: boolean
  imageData?: string | null
  width: number
  onView: () => void
  onOpen: () => void
  onCopy: () => void
  onDelete: () => Promise<boolean>
}

/**
 * 截图卡片组件
 */
export function ScreenshotCard({
  item,
  isNew = false,
  imageData,
  width,
  onView,
  onOpen,
  onCopy,
  onDelete
}: ScreenshotCardProps): React.JSX.Element {
  const [isHovered, setIsHovered] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const isVideo = item.fileName.endsWith('.mp4')

  const handleDelete = async (): Promise<void> => {
    if (isDeleting) return
    setIsDeleting(true)
    try {
      await onDelete()
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div
      className="relative flex-shrink-0 group cursor-pointer rounded-lg overflow-hidden border-2 border-transparent hover:border-primary/50 transition-all flex flex-col"
      style={{ width: `${width}px`, height: '100%' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 缩略图 */}
      <div className="flex-1 bg-secondary/30 overflow-hidden relative min-h-0 flex items-center justify-center">
        {imageData ? (
          <img
            src={imageData}
            alt={item.fileName}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Image className="h-8 w-8 text-muted-foreground opacity-30" />
          </div>
        )}

        {/* NEW 标签 */}
        {isNew && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-primary text-primary-foreground text-xs font-bold rounded">
            NEW
          </div>
        )}

        {/* 悬停蒙层 */}
        {isHovered && (
          <div className="absolute inset-0 bg-black/60 flex flex-col transition-opacity">
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3">
              {!isVideo && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onView()
                  }}
                  className="gap-2 bg-white/20 hover:bg-white/30 text-white border-white/30"
                >
                  <Maximize2 className="h-4 w-4" />
                  <span className="text-sm">放大查看</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen()
                }}
                className="gap-2 bg-white/20 hover:bg-white/30 text-white border-white/30"
              >
                <FileText className="h-4 w-4" />
                <span className="text-sm">打开文件</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onCopy()
                }}
                className="gap-2 bg-white/20 hover:bg-white/30 text-white border-white/30"
              >
                <Copy className="h-4 w-4" />
                <span className="text-sm">复制</span>
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={isDeleting}
              onClick={(e) => {
                e.stopPropagation()
                void handleDelete()
              }}
              className="w-full shrink-0 gap-2 rounded-none border-t border-white/20 text-red-300 hover:bg-red-500/15 hover:text-red-200"
            >
              <Trash2 className="h-4 w-4" />
              <span className="text-sm">{isDeleting ? '删除中...' : '删除文件'}</span>
            </Button>
          </div>
        )}
      </div>

      {/* 信息 */}
      <div className="p-2 bg-card">
        <p className="text-xs text-muted-foreground font-mono text-center">
          {formatTimeShort(item.timestamp)}
        </p>
        {item.fileName.endsWith('.mp4') && (
          <p className="text-xs text-muted-foreground text-center mt-0.5">
            <Video className="h-3 w-3 inline mr-1" />
            录屏
          </p>
        )}
      </div>
    </div>
  )
}






