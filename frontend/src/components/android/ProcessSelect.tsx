import React, { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { ChevronDown, Search, Loader2 } from 'lucide-react'
import type { AndroidApp } from '@/types/hdc'
import { networkCaptureAPI } from '@/lib/hdc-api/network-capture'
import { reconcileAndroidCaptureApp } from '@/lib/capture-selected-app'
import {
  peekAndroidProcessListCache,
  setAndroidProcessListCache,
} from '@/lib/process-list-cache'

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
  const [listFetched, setListFetched] = useState(false)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const appsRef = useRef(apps)
  appsRef.current = apps

  const fetchApps = useCallback(async (): Promise<AndroidApp[]> => {
    if (!deviceId) return []
    // 已有列表时静默刷新，按钮不转圈
    if (appsRef.current.length === 0) setLoading(true)
    try {
      const result = await networkCaptureAPI.GetAndroidDebuggableApps(deviceId)
      const list = result || []
      setApps(list)
      setAndroidProcessListCache(deviceId, list)
      setListFetched(true)
      return list
    } catch {
      // 失败不清空列表，避免误判已卸载
      return appsRef.current
    } finally {
      setLoading(false)
    }
  }, [deviceId])

  useImperativeHandle(ref, () => ({ fetchApps }), [fetchApps])

  // 切回面板：有缓存直接回显，不打设备；无缓存才拉一次
  useEffect(() => {
    if (!deviceId) return
    const cached = peekAndroidProcessListCache<AndroidApp>(deviceId)
    if (cached) {
      setApps(cached.apps)
      setListFetched(true)
      return
    }
    setListFetched(false)
    setApps([])
    void fetchApps()
  }, [deviceId, fetchApps])

  // 列表成功拉取后：回填 PID；找不到则清除（已卸载）
  useEffect(() => {
    if (!listFetched || !value) return
    const next = reconcileAndroidCaptureApp(value, apps)
    if (next === null) {
      onChange(null)
      return
    }
    if (
      next.pid !== value.pid ||
      next.name !== value.name ||
      next.processName !== value.processName
    ) {
      onChange(next)
    }
  }, [apps, listFetched, value, onChange])

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

  // 打开下拉时才强制刷新进程列表（保证新鲜度）
  useEffect(() => {
    if (open) {
      void fetchApps()
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
