import React, { useEffect, useState, useRef, useCallback } from 'react'
import { ChevronDown, Search, Loader2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { useDeviceStore } from '@/store/deviceStore'
import { processAPI } from '@/lib/hdc-api/process'
import type { ProcessInfo } from '@/types/hdc'

const MAX_SELECTION = 8

interface ProcessFilterProps {
  selectedPids: number[]
  onSelectionChange: (pids: number[]) => void
  disabled?: boolean
}

export function ProcessFilter({
  selectedPids,
  onSelectionChange,
  disabled
}: ProcessFilterProps): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const fetchProcesses = useCallback(async (): Promise<void> => {
    if (!selectedDevice) return
    setLoading(true)
    try {
      const platform = selectedDevice.platform === 'android' ? 'android' : 'harmonyos'
      const result = await processAPI.getProcessList(selectedDevice.connectKey, 'cpu', platform)
      setProcesses(result?.processes || [])
    } catch {
      setProcesses([])
    } finally {
      setLoading(false)
    }
  }, [selectedDevice])

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

  // 打开时刷新并聚焦搜索框
  useEffect(() => {
    if (open) {
      fetchProcesses()
      setTimeout(() => searchInputRef.current?.focus(), 0)
    } else {
      setSearch('')
    }
  }, [open, fetchProcesses])

  // 搜索防抖：输入时刷新进程列表
  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchProcesses()
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, open, fetchProcesses])

  const filteredProcesses = processes.filter(p =>
    p?.command?.toLowerCase().includes(search.toLowerCase()) ||
    String(p?.pid || '').includes(search)
  )

  const handleToggle = (pid: number): void => {
    if (selectedPids.includes(pid)) {
      onSelectionChange(selectedPids.filter(p => p !== pid))
    } else {
      if (selectedPids.length < MAX_SELECTION) {
        onSelectionChange([...selectedPids, pid])
      }
    }
  }

  const displayText = selectedPids.length === 0
    ? '进程筛选...'
    : `${selectedPids.length} 个进程`

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md border bg-background text-sm h-9 min-w-[140px] max-w-[280px] ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-accent/50'
        } ${selectedPids.length === 0 ? 'text-muted-foreground' : ''}`}
      >
        <span className="truncate flex-1 text-left">{displayText}</span>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 flex-shrink-0 opacity-50" />
        )}
      </button>

      {open && !disabled && (
        <div className="absolute top-full right-0 mt-1 bg-popover border rounded-md shadow-lg z-50 min-w-[300px] max-w-[600px]">
          <div className="flex items-center gap-2 p-2 border-b">
            <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="搜索进程..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {loading && processes.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                加载中...
              </div>
            ) : filteredProcesses.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                {search ? '没有匹配的进程' : '没有可用的进程'}
              </div>
            ) : (
              <div className="py-1">
                {filteredProcesses.map((proc) => {
                  const isSelected = selectedPids.includes(proc.pid)
                  const cpuStr = typeof proc.cpuPercent === 'number' ? proc.cpuPercent.toFixed(1) : '0.0'
                  const memStr = typeof proc.memPercent === 'number' ? proc.memPercent.toFixed(1) : '0.0'
                  return (
                    <div
                      key={proc.pid}
                      className={`flex items-center gap-3 px-3 py-1.5 cursor-pointer transition-colors whitespace-nowrap ${
                        isSelected
                          ? 'bg-primary/10'
                          : 'hover:bg-accent/50'
                      }`}
                      onClick={() => handleToggle(proc.pid)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleToggle(proc.pid)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="font-medium text-sm">{proc.command || proc.user || '-'}</span>
                      <span className="text-xs text-muted-foreground">PID: {proc.pid}</span>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                        <span>CPU: {cpuStr}%</span>
                        <span>MEM: {memStr}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="p-2 border-t text-xs text-muted-foreground flex justify-between">
            <span>共 {filteredProcesses.length} 个进程</span>
            <span>已选 {selectedPids.length}/{MAX_SELECTION}</span>
          </div>
        </div>
      )}
    </div>
  )
}
