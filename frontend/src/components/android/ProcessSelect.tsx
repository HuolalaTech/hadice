import React, { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { ChevronDown, Search, Loader2 } from 'lucide-react'
import type { AndroidApp } from '@/types/hdc'
import { networkCaptureAPI } from '@/lib/hdc-api/network-capture'

export interface ProcessSelectHandle {
  fetchApps: () => Promise<AndroidApp[]>
}

interface ProcessSelectProps {
  deviceId: string
  value: AndroidApp | null
  onChange: (app: AndroidApp | null) => void
  disabled?: boolean
}

export const ProcessSelect = forwardRef<ProcessSelectHandle, ProcessSelectProps>(function ProcessSelect(
  { deviceId, value, onChange, disabled },
  ref
) {
  const [apps, setApps] = useState<AndroidApp[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const fetchApps = useCallback(async (): Promise<AndroidApp[]> => {
    if (!deviceId) return []
    setLoading(true)
    try {
      const result = await networkCaptureAPI.GetAndroidDebuggableApps(deviceId)
      setApps(result || [])
      return result || []
    } catch {
      setApps([])
      return []
    } finally {
      setLoading(false)
    }
  }, [deviceId])

  useImperativeHandle(ref, () => ({ fetchApps }), [fetchApps])

  useEffect(() => {
    fetchApps()
  }, [fetchApps])

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 打开时聚焦搜索框并刷新进程列表
  useEffect(() => {
    if (open) {
      fetchApps()
      setTimeout(() => searchInputRef.current?.focus(), 0)
    } else {
      setSearch('')
    }
  }, [open, fetchApps])

  const filteredApps = apps.filter(app =>
    app.processName.toLowerCase().includes(search.toLowerCase()) ||
    app.packageName.toLowerCase().includes(search.toLowerCase()) ||
    app.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleSelect = (app: AndroidApp): void => {
    onChange(app)
    setOpen(false)
  }

  const displayText = value
    ? `${value.processName || value.packageName}`
    : '选择进程...'

  return (
    <div ref={containerRef} className="relative flex-shrink min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md border bg-background text-sm h-9 w-[240px] max-w-[240px] min-w-0 ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-accent/50'
        } ${!value ? 'text-muted-foreground' : ''}`}
      >
        <span className="truncate flex-1 text-left" dir={value ? 'rtl' : undefined}>
          {displayText}
        </span>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 flex-shrink-0 opacity-50" />
        )}
      </button>

      {open && !disabled && (
        <div className="absolute top-full left-0 mt-1 w-[360px] bg-popover border rounded-md shadow-lg z-50">
          <div className="flex items-center gap-2 p-2 border-b">
            <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="搜索应用..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="h-[280px] overflow-y-auto">
            {loading && apps.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                加载中...
              </div>
            ) : filteredApps.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                {search ? '没有匹配的应用' : '没有可调试的应用'}
              </div>
            ) : (
              <div className="py-1">
                {filteredApps.map((app) => {
                  const isSelected = value?.processName === app.processName && value?.pid === app.pid
                  return (
                    <div
                      key={`${app.processName}-${app.pid}`}
                      className={`px-3 py-2 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-accent/50'
                      }`}
                      onClick={() => handleSelect(app)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {app.processName || app.packageName}
                        </span>
                        {app.debuggable && (
                          <span className="text-[10px] px-1 py-0 border rounded text-muted-foreground">
                            debug
                          </span>
                        )}
                      </div>
                      {app.name && app.name !== app.processName && app.name !== app.packageName && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          应用: {app.name}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        包名: {app.packageName}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        PID: {app.pid}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="p-2 border-t text-xs text-muted-foreground text-center">
            共 {filteredApps.length} 个可调试应用
          </div>
        </div>
      )}
    </div>
  )
})
