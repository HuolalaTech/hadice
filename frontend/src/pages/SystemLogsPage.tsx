import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import {
  FileText,
  Pause,
  Play,
  Trash2,
  Download,
  ChevronDown
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useDeviceStore } from '@/store/deviceStore'
import { useAppCacheStore } from '@/store/appCacheStore'
import { useLogViewStore } from '@/store/logViewStore'
import { AppMultiSelect } from '@/components/app/AppMultiSelect'
import { LogViewToggle } from '@/components/log/LogViewToggle'
import { LogListView } from '@/components/log/LogListView'
import { SuppressionRuleManager } from '@/components/log/SuppressionRuleManager'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { isHdcAvailable, isAndroidDevice } from '@/lib/hdc'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { NoDeviceState } from '@/components/layout/NoDeviceState'
import { cn } from '@/lib/utils'
import type { LogcatLogLevel } from '@/lib/hdc-api/hilog'
import { deviceAPI } from '@/lib/hdc-api/device'
import { captureEvent } from '@/lib/posthog'
import { useLogStream } from '@/hooks/useLogStream'

type HarmonyLogLevel = 'D' | 'I' | 'W' | 'E' | 'F'

// ── LogLevelMultiSelect ──────────────────────────────────────────────────────

interface LogLevelMultiSelectProps {
  selectedLevels: string[]
  onSelectedLevelsChange: (levels: string[]) => void
  platform: 'harmonyos' | 'android'
}

const LogLevelMultiSelect: React.FC<LogLevelMultiSelectProps> = ({
  selectedLevels,
  onSelectedLevelsChange,
  platform,
}) => {
  const [isOpen, setIsOpen] = useState(false)

  const harmonyLevels: { value: HarmonyLogLevel; label: string }[] = [
    { value: 'D', label: 'DEBUG' },
    { value: 'I', label: 'INFO' },
    { value: 'W', label: 'WARN' },
    { value: 'E', label: 'ERROR' },
    { value: 'F', label: 'FATAL' },
  ]

  const androidLevels: { value: LogcatLogLevel; label: string }[] = [
    { value: 'V', label: 'VERBOSE' },
    { value: 'D', label: 'DEBUG' },
    { value: 'I', label: 'INFO' },
    { value: 'W', label: 'WARN' },
    { value: 'E', label: 'ERROR' },
    { value: 'F', label: 'FATAL' },
  ]

  const allLevels = platform === 'android' ? androidLevels : harmonyLevels

  const handleLevelToggle = useCallback((level: string, checked: boolean) => {
    let newSelected: string[]
    if (checked) {
      newSelected = [...selectedLevels, level]
    } else {
      newSelected = selectedLevels.filter(l => l !== level)
    }
    onSelectedLevelsChange(newSelected)
  }, [selectedLevels, onSelectedLevelsChange])

  const displayText = selectedLevels.length === 0 ? '选择级别...' : selectedLevels.sort().join(',')
  const maxCount = platform === 'android' ? 6 : 5

  return (
    <div className="relative w-full">
      <Button
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full justify-between h-9 px-3"
      >
        <span className={cn(selectedLevels.length === 0 && "text-muted-foreground")}>
          {displayText}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 opacity-50 transition-transform', isOpen && 'rotate-180')}
        />
      </Button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-background border border-input rounded-md shadow-md z-50 min-w-[200px]">
          <ScrollArea className="h-48">
            <div className="p-1">
              {allLevels.map((level) => (
                <div
                  key={level.value}
                  className="flex items-center gap-2 p-2 hover:bg-accent rounded-sm cursor-pointer"
                  onClick={() =>
                    handleLevelToggle(level.value, !selectedLevels.includes(level.value))
                  }
                >
                  <Checkbox
                    checked={selectedLevels.includes(level.value)}
                    onCheckedChange={(checked) =>
                      handleLevelToggle(level.value, checked === true)
                    }
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="text-sm">{level.label}</span>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="p-2 border-t text-xs text-muted-foreground">
            已选 {selectedLevels.length}/{maxCount}
          </div>
        </div>
      )}

      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  )
}

// ── SystemLogsPage ───────────────────────────────────────────────────────────

export function SystemLogsPage(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()
  const { appsArray, loadAppsIfNeeded } = useAppCacheStore()
  const viewMode = useLogViewStore((s) => s.viewMode)

  const platform = useMemo(() => {
    return selectedDevice?.platform === 'android' ? 'android' : 'harmonyos'
  }, [selectedDevice?.platform])

  // ── Filter state (managed by page) ─────────────────────────────────────────
  const [levelFilter, setLevelFilter] = useState<string[]>(['W'])
  const [tagFilter, setTagFilter] = useState('')
  const [selectedApps, setSelectedApps] = useState<Array<{ packageName: string; appName: string; pid?: number }>>([])
  const [keywordFilter, setKeywordFilter] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [androidApps, setAndroidApps] = useState<Array<{ packageName: string; appName: string; pid?: number }>>([])

  // ── Terminal refs ──────────────────────────────────────────────────────────
  const terminalRef = useRef<HTMLDivElement>(null)

  // ── Derive backend / client filters ────────────────────────────────────────
  const backendFilters = useMemo(() => {
    const pids = selectedApps
      .filter((app) => app.pid !== undefined && app.pid > 0)
      .map((app) => String(app.pid))
    return { levels: levelFilter, pids }
  }, [levelFilter, selectedApps])

  const clientFilters = useMemo(() => ({
    keywordFilter,
    useRegex,
    tagFilter,
  }), [keywordFilter, useRegex, tagFilter])

  // ── useLogStream hook ──────────────────────────────────────────────────────
  const {
    isStreaming,
    isPaused,
    autoScroll,
    setAutoScroll,
    totalReceived,
    filteredEntries,
    stats,
    setTerminal,
    startStream,
    pause,
    resume,
    clearLogs,
  } = useLogStream({
    deviceKey: selectedDevice?.connectKey ?? null,
    platform,
    backendFilters,
    clientFilters,
    ringBufferCapacity: 100_000,
  })

  // ── Terminal initialization ────────────────────────────────────────────────
  useEffect(() => {
    if (!terminalRef.current || viewMode !== 'terminal') return

    const terminal = new Terminal({
      theme: {
        background: '#0a0a0b',
        foreground: '#fafafa',
        cursor: '#fafafa',
        black: '#000000',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#fafafa',
        brightBlack: '#525252',
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#eab308',
        brightBlue: '#3b82f6',
        brightMagenta: '#a855f7',
        brightCyan: '#06b6d4',
        brightWhite: '#ffffff'
      },
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: 11,
      cursorBlink: false,
      disableStdin: true,
      scrollback: 10000
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    terminal.open(terminalRef.current)

    // Register terminal with the log stream hook
    setTerminal(terminal)

    const fitTerminal = () => {
      try {
        fitAddon.fit()
      } catch (error) {
        console.warn('[SystemLogs] Failed to fit terminal:', error)
      }
    }

    setTimeout(fitTerminal, 100)

    const handleResize = () => {
      fitTerminal()
    }
    window.addEventListener('resize', handleResize)

    const resizeObserver = new ResizeObserver(() => {
      fitTerminal()
    })
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current)
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      setTerminal(null)
      terminal.dispose()
    }
  }, [setTerminal, viewMode])

  // ── Auto-start stream when device is connected ──────────────────────────────
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!selectedDevice || !isHdcAvailable() || isStreaming) {
      return
    }

    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        startStream()
      }
    }, 200)

    return () => {
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice?.connectKey])

  // ── Fit addon on view mode switch back to terminal ─────────────────────────
  useEffect(() => {
    if (viewMode === 'terminal' && terminalRef.current) {
      const timer = setTimeout(() => {
        try {
          // The fit addon is internal to the terminal init effect.
          // We trigger a resize event which the listener will handle.
          window.dispatchEvent(new Event('resize'))
        } catch (error) {
          console.error('[SystemLogs] Error fitting terminal:', error)
        }
      }, 100)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [viewMode])

  // ── Handle pause toggle ────────────────────────────────────────────────────
  const handlePauseToggle = useCallback(() => {
    if (isPaused) {
      resume()
    } else {
      pause()
    }
  }, [isPaused, pause, resume])

  // ── Handle clear ───────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    captureEvent('hilog cleared', { platform })
    clearLogs()
  }, [platform, clearLogs])

  // ── Handle save ────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (filteredEntries.length === 0 || !isHdcAvailable()) {
      return
    }

    try {
      const logText = filteredEntries.map((entry) => entry.raw).join('\n')
      const prefix = platform === 'android' ? 'logcat' : 'hilog'
      const defaultFileName = `${prefix}_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`

      const result = await window.hdc.saveLogsToFile(logText, defaultFileName)

      if (result && result.success) {
        captureEvent('system logs saved', { log_count: filteredEntries.length, platform })
        console.log('[SystemLogs] Logs saved to:', result.filePath)
      } else if (result && result.error && result.error !== '用户取消') {
        console.error('[SystemLogs] Failed to save logs:', result.error)
      }
    } catch (error) {
      console.error('[SystemLogs] Failed to save logs:', error)
    }
  }, [filteredEntries, platform])

  // ── Load apps ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDevice || !isHdcAvailable()) return

    const loadApps = async () => {
      if (isAndroidDevice(selectedDevice.platform)) {
        try {
          const result = await deviceAPI.getAndroidAppList(selectedDevice.connectKey)
          const apps = result.apps.map(app => ({
            packageName: app.packageName,
            appName: app.appName || app.packageName,
            pid: app.pid || undefined
          }))
          setAndroidApps(apps)
        } catch (error) {
          console.error('[SystemLogs] Failed to load android apps:', error)
          setAndroidApps([])
        }
      } else {
        loadAppsIfNeeded(selectedDevice.connectKey).catch((error) => {
          console.error('[SystemLogs] Failed to load apps:', error)
        })
      }
    }

    loadApps()
  }, [selectedDevice?.connectKey, selectedDevice?.platform, loadAppsIfNeeded])

  // ── Display apps ───────────────────────────────────────────────────────────
  const displayApps = useMemo(() => {
    return platform === 'android' ? androidApps : appsArray
  }, [platform, androidApps, appsArray])

  const platformLabel = platform === 'android' ? 'Android Logcat' : '鸿蒙 Hilog'

  // ── No device selected ─────────────────────────────────────────────────────
  if (!selectedDevice) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            系统日志
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

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="p-6 h-full flex flex-col">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <FileText className="h-6 w-6 text-primary" />
          系统日志
          <WindowToggleButton />
          <HelpToggleButton />
        </h1>
        <div className="flex items-center gap-2">
          <LogViewToggle />
          <Button
            key={isPaused ? 'paused' : 'playing'}
            variant={isPaused ? 'default' : 'outline'}
            size="sm"
            onClick={handlePauseToggle}
            className="gap-2"
          >
            {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {isPaused ? '继续' : '暂停'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleClear} className="gap-2">
            <Trash2 className="h-4 w-4" />
            清空
          </Button>
          <Button
            variant={autoScroll ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAutoScroll(!autoScroll)}
          >
            自动滚动
          </Button>
        </div>
      </div>

      {/* ── Filter Toolbar ──────────────────────────────────────────────────── */}
      <Card className="p-[3.6px] mb-4 flex-shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 w-[15%] min-w-0">
            <span className="text-sm text-muted-foreground whitespace-nowrap">级别:</span>
            <div className="flex-1 min-w-0">
              <LogLevelMultiSelect
                selectedLevels={levelFilter}
                onSelectedLevelsChange={setLevelFilter}
                platform={platform}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 w-[15%] min-w-0">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Tag:</span>
            <Input
              placeholder="tag1,tag2"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="flex-1 min-w-0"
            />
          </div>

          <div className="flex items-center gap-2 max-w-1/2 min-w-0">
            <span className="text-sm text-muted-foreground whitespace-nowrap">应用名:</span>
            <div className="flex-1 min-w-0">
              <AppMultiSelect
                selectedPackageNames={selectedApps.map((app) => app.packageName)}
                onSelectedAppsChange={setSelectedApps}
                maxCount={5}
                placeholder="选择应用..."
                apps={displayApps}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm text-muted-foreground whitespace-nowrap">关键字:</span>
            <div className="relative flex-1 min-w-0">
              <Input
                placeholder="搜索关键字..."
                value={keywordFilter}
                onChange={(e) => setKeywordFilter(e.target.value)}
                className="flex-1 min-w-0 pr-20"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <div className="flex items-center gap-1.5 ml-2">
                  <Checkbox
                    id="useRegex"
                    checked={useRegex}
                    onCheckedChange={(checked) => setUseRegex(checked === true)}
                  />
                  <label
                    htmlFor="useRegex"
                    className="text-xs text-muted-foreground cursor-pointer select-none"
                  >
                    正则
                  </label>
                </div>
              </div>
            </div>
          </div>

          <SuppressionRuleManager platform={platform} />

          <Button variant="outline" size="sm" onClick={handleSave} className="gap-2">
            <Download className="h-4 w-4" />
            保存日志
          </Button>
        </div>
      </Card>

      {/* ── Log Display Area (Terminal or List) ──────────────────────────────── */}
      {viewMode === 'terminal' ? (
        <Card className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div
            ref={terminalRef}
            className="flex-1 w-full h-full"
            style={{ minHeight: 0, minWidth: 0 }}
          />
        </Card>
      ) : (
        <Card className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <LogListView entries={filteredEntries} platform={platform} autoScroll={autoScroll} stats={stats} />
        </Card>
      )}
    </div>
  )
}
