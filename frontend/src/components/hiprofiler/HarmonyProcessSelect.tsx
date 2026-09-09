import React, { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { ChevronDown, Search, Loader2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { HarmonyDebuggableApp } from '@/types/hdc'
import { networkCaptureAPI } from '@/lib/hdc-api/network-capture'

export interface HarmonyProcessSelectHandle {
  fetchApps: () => Promise<HarmonyDebuggableApp[]>
}

interface HarmonyProcessSelectProps {
  deviceId: string
  value: HarmonyDebuggableApp | null
  onChange: (app: HarmonyDebuggableApp | null) => void
  disabled?: boolean
}

export const HarmonyProcessSelect = forwardRef<HarmonyProcessSelectHandle, HarmonyProcessSelectProps>(function HarmonyProcessSelect(
  { deviceId, value, onChange, disabled },
  ref
) {
  const [apps, setApps] = useState<HarmonyDebuggableApp[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const fetchApps = useCallback(async (): Promise<HarmonyDebuggableApp[]> => {
    if (!deviceId) return []
    setLoading(true)
    try {
      const result = await networkCaptureAPI.GetHiProfilerApps(deviceId)
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
    app.bundleName.toLowerCase().includes(search.toLowerCase()) ||
    app.processName.toLowerCase().includes(search.toLowerCase()) ||
    app.appName.toLowerCase().includes(search.toLowerCase())
  )

  const handleSelect = (app: HarmonyDebuggableApp): void => {
    onChange(app)
    setOpen(false)
  }

  const displayText = value
    ? value.pid > 0
      ? `${value.appName || value.bundleName} (PID:${value.pid})`
      : `${value.appName || value.bundleName}（已退出）`
    : '选择进程...'

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md border bg-background text-sm h-9 min-w-[160px] max-w-[240px] ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-accent/50'
        } ${!value ? 'text-muted-foreground' : ''}`}
      >
        <span className="truncate flex-1 text-left">{displayText}</span>
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

          <ScrollArea className="max-h-[300px]">
            {loading && apps.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                加载中...
              </div>
            ) : filteredApps.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                {search ? '没有匹配的应用' : '没有可调试的应用（需debug签名）'}
              </div>
            ) : (
              <div className="py-1">
                {filteredApps.map((app) => {
                  const isSelected = value?.bundleName === app.bundleName && value?.pid === app.pid
                  return (
                    <div
                      key={`${app.bundleName}-${app.pid}`}
                      className={`px-3 py-2 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-accent/50'
                      }`}
                      onClick={() => handleSelect(app)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {app.appName || app.bundleName}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {app.processName || app.bundleName}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        PID: {app.pid}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>

          <div className="p-2 border-t text-xs text-muted-foreground text-center">
            共 {filteredApps.length} 个可调试应用
          </div>
        </div>
      )}
    </div>
  )
})
