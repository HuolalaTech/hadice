import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Settings2, Search, RefreshCw, Copy, Check } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useDeviceStore } from '@/store/deviceStore'
import type { SystemProperties } from '@/types/hdc'
import { isHdcAvailable } from '@/lib/hdc'
import { captureEvent } from '@/lib/posthog'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { NoDeviceState } from '@/components/layout/NoDeviceState'

/**
 * 系统信息页面
 */
export function SystemInfoPage(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()

  const [properties, setProperties] = useState<SystemProperties>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!selectedDevice || !isHdcAvailable()) return

    setIsLoading(true)
    try {
      const platform = selectedDevice.platform as 'harmonyos' | 'android'
      const props = await window.hdc.getSystemProperties(selectedDevice.connectKey, platform)
      setProperties(props)
    } catch (error) {
      console.error('[SystemInfo] Failed to fetch data:', error)
    } finally {
      setIsLoading(false)
    }
  }, [selectedDevice])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // 复制属性
  const handleCopy = (key: string, value: string) => {
    navigator.clipboard.writeText(`${key}=${value}`)
    captureEvent('system info copied', { key })
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  // 搜索过滤
  const filteredProperties = useMemo(() => {
    let entries = Object.entries(properties)

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      entries = entries.filter(
        ([key, value]) =>
          key.toLowerCase().includes(term) || value.toLowerCase().includes(term)
      )
    }

    entries.sort((a, b) => a[0].localeCompare(b[0]))
    return entries
  }, [properties, searchTerm])

  // 高亮搜索关键词
  const highlightText = (text: string) => {
    if (!searchTerm) return text
    const parts = text.split(new RegExp(`(${searchTerm})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === searchTerm.toLowerCase() ? (
        <span key={i} className="bg-yellow-500/30 text-yellow-200 px-0.5 rounded">
          {part}
        </span>
      ) : (
        part
      )
    )
  }

  if (!selectedDevice) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Settings2 className="h-6 w-6 text-primary" />
            系统信息
            <WindowToggleButton />
            <HelpToggleButton />
          </h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <NoDeviceState />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full flex flex-col">
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Settings2 className="h-6 w-6 text-primary" />
          系统信息
          <WindowToggleButton />
            <HelpToggleButton />
        </h1>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {/* 搜索栏 */}
      <div className="mb-4 flex items-center gap-3 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索属性名或值..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {filteredProperties.length} / {Object.keys(properties).length} 项
        </span>
      </div>

      {/* 属性表格 */}
      <Card className="flex-1 min-h-0 overflow-hidden">
        {/* 表头 */}
        <div className="grid grid-cols-[1fr_1fr_auto] gap-4 px-4 py-2 border-b text-xs font-medium text-muted-foreground bg-secondary/30">
          <span>属性名</span>
          <span>值</span>
          <span className="w-8"></span>
        </div>

        {/* 表格内容 */}
        <ScrollArea className="h-[calc(100%-36px)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredProperties.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              {searchTerm ? '未找到匹配的属性' : '暂无数据'}
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {filteredProperties.map(([key, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-[1fr_1fr_auto] gap-4 px-4 py-1.5 hover:bg-secondary/30 transition-colors group items-center"
                >
                  <span
                    className="font-mono text-sm text-muted-foreground truncate"
                    title={key}
                  >
                    {highlightText(key)}
                  </span>
                  <span className="font-mono text-sm truncate" title={value}>
                    {highlightText(value)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleCopy(key, value)}
                  >
                    {copiedKey === key ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>
    </div>
  )
}
