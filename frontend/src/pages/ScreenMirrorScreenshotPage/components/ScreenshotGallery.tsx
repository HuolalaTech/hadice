import React, { useEffect, useRef, useCallback, useMemo } from 'react'
import { Image } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { ScreenshotInfo, ScreenshotHistoryItem } from '@/types/hdc'
import { ScreenshotCard } from './ScreenshotCard'

interface ScreenshotGalleryProps {
  currentScreenshot: ScreenshotInfo | null
  history: ScreenshotHistoryItem[]
  imageCache: Record<string, string>
  imageDimensions: Record<string, { width: number; height: number }>
  onView: (filePath: string) => void
  onOpen: (filePath: string) => void
  onCopy: (filePath: string) => void
}

/**
 * 截图画廊组件
 */
export function ScreenshotGallery({
  currentScreenshot,
  history,
  imageCache,
  imageDimensions,
  onView,
  onOpen,
  onCopy
}: ScreenshotGalleryProps): React.JSX.Element {
  const galleryContainerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = React.useState<number>(0)

  // 合并最新截图和历史记录，确保最新的显示在第一个位置
  // 按时间戳降序排序，最新的在最前面
  const allScreenshots = useMemo(() => {
    const all: ScreenshotHistoryItem[] = []
    
    // 如果有当前截图，优先使用它
    if (currentScreenshot) {
      all.push({
        localPath: currentScreenshot.localPath,
        fileName: currentScreenshot.fileName,
        timestamp: currentScreenshot.timestamp,
        size: currentScreenshot.size
      })
    }
    
    // 添加历史记录，排除与当前截图相同的项
    const filteredHistory = currentScreenshot
      ? history.filter((h) => h.localPath !== currentScreenshot.localPath)
      : history
    
    all.push(...filteredHistory)
    
    // 按时间戳降序排序，确保最新的在最前面
    return all.sort((a, b) => b.timestamp - a.timestamp)
  }, [currentScreenshot, history])

  // 监听容器高度变化
  useEffect(() => {
    const container = galleryContainerRef.current
    if (!container) return

    const updateHeight = () => {
      const height = container.clientHeight
      if (height > 0) {
        setContainerHeight(height)
      }
    }

    updateHeight()

    const resizeObserver = new ResizeObserver(() => {
      updateHeight()
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
    }
  }, [allScreenshots.length])

  /**
   * 根据容器高度和图片宽高比计算卡片宽度
   */
  const calculateCardWidth = useCallback(
    (filePath: string): number => {
      const dimensions = imageDimensions[filePath]
      if (!dimensions || containerHeight === 0) {
        return (containerHeight || 400) * (1260 / 2720)
      }

      const imageHeight = containerHeight - 40
      const width = (imageHeight * dimensions.width) / dimensions.height
      return width
    },
    [imageDimensions, containerHeight]
  )

  return (
    <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <CardContent className="flex-1 p-4 overflow-hidden flex flex-col">
        {allScreenshots.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Image className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg">暂无截图</p>
              <p className="text-sm mt-2">点击上方「截屏」按钮开始截图</p>
            </div>
          </div>
        ) : (
          <div ref={galleryContainerRef} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-x-auto overflow-y-hidden" id="screenshot-gallery">
              <div className="flex gap-4 h-full pb-2" style={{ alignItems: 'flex-start' }}>
                {allScreenshots.map((item, index) => {
                  const isNew = index === 0 && currentScreenshot?.localPath === item.localPath
                  const cardWidth = calculateCardWidth(item.localPath)
                  return (
                    <ScreenshotCard
                      key={item.localPath}
                      item={item}
                      isNew={isNew}
                      imageData={imageCache[item.localPath]}
                      width={cardWidth}
                      onView={() => onView(item.localPath)}
                      onOpen={() => onOpen(item.localPath)}
                      onCopy={() => onCopy(item.localPath)}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
