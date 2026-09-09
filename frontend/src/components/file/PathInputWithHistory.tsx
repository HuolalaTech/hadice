import React, { useRef, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { X, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 带历史记录的路径输入框组件
 */
export function PathInputWithHistory({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  placeholder = '输入路径...',
  history = [],
  onHistorySelect,
  onRemoveHistory,
  disabled = false,
  className
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  history?: string[]
  onHistorySelect: (path: string) => void
  onRemoveHistory: (path: string) => void
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  const [showHistory, setShowHistory] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 点击外部时关闭历史列表
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowHistory(false)
      }
    }

    if (showHistory) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [showHistory])

  const handleInputFocus = () => {
    if (history.length > 0) {
      setShowHistory(true)
    }
  }

  const handleSelectHistory = (path: string) => {
    onHistorySelect(path)
    setShowHistory(false)
  }

  const handleRemoveHistory = (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    onRemoveHistory(path)
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // 延迟关闭，给点击历史项一点时间
          setTimeout(() => setShowHistory(false), 150)
        }}
        onFocus={handleInputFocus}
        className={cn('flex-1 text-sm break-words whitespace-normal min-h-[2.5rem] h-auto py-1.5', className)}
        placeholder={placeholder}
        disabled={disabled}
      />

      {/* 历史记录下拉列表 */}
      {showHistory && history.length > 0 && (
        <div
          className="absolute top-full left-0 right-0 mt-1 bg-background border border-input rounded-md shadow-lg z-50 max-h-60 overflow-y-auto"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="p-1">
            {history.map((path, index) => (
              <div
                key={`${path}-${index}`}
                onClick={() => handleSelectHistory(path)}
                className="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer hover:bg-accent transition-colors group"
              >
                <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm flex-1 truncate text-foreground">{path}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => handleRemoveHistory(e, path)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
