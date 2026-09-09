import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  ListTree,
  Search,
  RefreshCw,
  ArrowUpDown,
  MoreHorizontal,
  XCircle,
  Skull,
  Clock,
  Activity,
  Zap,
  Package
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useDeviceStore } from '@/store/deviceStore'
import { useAppCacheStore } from '@/store/appCacheStore'
import { useProcessCacheStore } from '@/store/processCacheStore'
import { AppDetailDialog } from '@/components/dialogs/AppDetailDialog'
import type {
  ProcessInfo,
  ProcessStats,
  ProcessSortField,
  ProcessListResult,
  AppInfo
} from '@/types/hdc'
import { isHdcAvailable } from '@/lib/hdc'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { NoDeviceState } from '@/components/layout/NoDeviceState'
import { captureEvent } from '@/lib/posthog'

/**
 * 格式化内存显示
 */
function formatMem(size: string): string {
  if (!size) return '-'
  // 已经有单位的直接返回
  if (size.includes('G') || size.includes('M') || size.includes('K')) {
    return size
  }
  // 数字转换
  const num = parseFloat(size)
  if (isNaN(num)) return size
  if (num >= 1024 * 1024) return (num / 1024 / 1024).toFixed(1) + ' GB'
  if (num >= 1024) return (num / 1024).toFixed(1) + ' MB'
  return num + ' KB'
}

/**
 * 获取进程状态描述
 */
function getStateDescription(state: string): { label: string; color: string } {
  switch (state) {
    case 'R':
      return { label: '运行', color: 'text-green-500' }
    case 'S':
      return { label: '睡眠', color: 'text-blue-500' }
    case 'D':
      return { label: 'IO等待', color: 'text-yellow-500' }
    case 'Z':
      return { label: '僵尸', color: 'text-red-500' }
    case 'T':
      return { label: '停止', color: 'text-gray-500' }
    default:
      return { label: state, color: 'text-muted-foreground' }
  }
}

/**
 * 统计卡片组件
 */
function StatCard({
  icon: Icon,
  label,
  value,
  color
}: {
  icon: React.ElementType
  label: string
  value: number
  color: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30">
      <Icon className={`h-4 w-4 ${color}`} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono font-bold">{value}</span>
    </div>
  )
}

/**
 * 进程管理页面
 */
export function ProcessManagerPage(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()
  const { 
    matchAppByProcessName, 
    loadAppsIfNeeded, 
    getAppByPackageName,
    apps,
    initializeOnlineAppInfo,
    isDiskCacheLoaded,
    loadFromDiskCache
  } = useAppCacheStore()
  const { updateProcesses, getCachedProcesses, getCachedStats } = useProcessCacheStore()
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set())
  const [hasInitializedOnlineInfo, setHasInitializedOnlineInfo] = useState(false)

  // 组件挂载状态跟踪，用于防止内存泄漏
  const isMountedRef = useRef(true)
  // 定时器引用，用于清理
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  // 用于取消正在进行的请求
  const abortControllerRef = useRef<AbortController | null>(null)
  // 内存追踪
  const renderCountRef = useRef<number>(0)
  const lastMemoryCheckRef = useRef<number>(0)
  // 存储 fetchProcessList 函数的引用，用于手动刷新
  const fetchProcessListRef = useRef<(() => void) | null>(null)

  // 应用详情弹窗状态
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [detailApp, setDetailApp] = useState<AppInfo | null>(null)

  // 状态
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [stats, setStats] = useState<ProcessStats>({
    total: 0,
    running: 0,
    sleeping: 0,
    stopped: 0,
    zombie: 0
  })
  const [isLoading, setIsLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<ProcessSortField>('mem')
  const [refreshInterval, setRefreshInterval] = useState(3000)

  // 终止进程弹窗状态
  const [killDialogOpen, setKillDialogOpen] = useState(false)
  const [selectedProcess, setSelectedProcess] = useState<ProcessInfo | null>(null)
  const [selectedPackageName, setSelectedPackageName] = useState<string>('')
  const [isKilling, setIsKilling] = useState(false)

  // 组件挂载/卸载管理
  useEffect(() => {
    isMountedRef.current = true
    renderCountRef.current = 0
    lastMemoryCheckRef.current = Date.now()
    
    return () => {
      isMountedRef.current = false
      // 取消正在进行的请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      // 清理定时器
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      // 清理状态，帮助垃圾回收
      setProcesses([])
      setStats({ total: 0, running: 0, sleeping: 0, stopped: 0, zombie: 0 })
      setFailedIcons(new Set())
    }
  }, [])

  // 初始化：先从磁盘缓存加载，然后从设备加载最新数据
  // 不阻塞UI，后台异步加载
  useEffect(() => {
    if (!selectedDevice || !isHdcAvailable()) return

    const initializeAppCache = async () => {
      if (!isDiskCacheLoaded) {
        await loadFromDiskCache()
      }
      
      loadAppsIfNeeded(selectedDevice.connectKey)
    }

    initializeAppCache()
    
    // 延迟检查是否需要初始化在线应用信息，避免阻塞首次渲染
    const checkTimer = setTimeout(() => {
      // 检查是否需要初始化在线应用信息
      // 如果应用名称和图标还未获得，则初始化
      let needsOnlineInfo = false
      
      apps.forEach((app) => {
        // 如果应用名称是包名（说明没有获取到真实名称）或者没有图标，则需要获取在线信息
        if (!app.appName || app.appName === app.packageName || !app.icon) {
          needsOnlineInfo = true
        }
      })

      // 如果首次点击进程管理菜单且需要在线信息，则初始化
      if (needsOnlineInfo && !hasInitializedOnlineInfo) {
        setHasInitializedOnlineInfo(true)
        
        // 分批获取应用的在线信息（后台执行，不阻塞UI）
        initializeOnlineAppInfo(selectedDevice.connectKey, (packageName: string, appInfo: AppInfo) => {
          // 每获取到一个应用的信息，使用requestAnimationFrame优化渲染
          requestAnimationFrame(() => {
            setProcesses((prevProcesses) => {
              // 检查是否有进程匹配到这个包名
              const hasMatch = prevProcesses.some((process) => {
                const matchedApp = matchAppByProcessName(process.command)
                return matchedApp && matchedApp.packageName === packageName
              })
              
              // 如果有匹配，返回新数组触发重新渲染
              if (hasMatch) {
                return [...prevProcesses]
              }
              return prevProcesses
            })
          })
        })
      }
    }, 100) // 延迟100ms，让首次渲染先完成

    return () => {
      clearTimeout(checkTimer)
    }
  }, [selectedDevice?.connectKey, hasInitializedOnlineInfo, initializeOnlineAppInfo, matchAppByProcessName, isDiskCacheLoaded, loadFromDiskCache])

  // 监听应用缓存更新，实时更新进程列表UI
  // 使用useMemo优化，避免不必要的重新渲染
  useEffect(() => {
    // 使用requestAnimationFrame优化渲染时机
    const rafId = requestAnimationFrame(() => {
      setProcesses((prevProcesses) => {
        // 检查是否有进程需要更新（通过匹配应用信息）
        const needsUpdate = prevProcesses.some((process) => {
          const matchedApp = matchAppByProcessName(process.command)
          return matchedApp !== null
        })
        
        if (needsUpdate) {
          // 返回新数组触发重新渲染
          return [...prevProcesses]
        }
        return prevProcesses
      })
    })
    
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [apps.size, matchAppByProcessName]) // 只依赖apps.size，减少不必要的触发

  // 初始化：从缓存加载进程数据
  useEffect(() => {
    if (!selectedDevice) return

    // 从缓存加载进程数据
    const cachedProcesses = getCachedProcesses()
    const cachedStats = getCachedStats()

    if (cachedProcesses.length > 0 && isMountedRef.current) {
      setProcesses(cachedProcesses)
      setStats(cachedStats)
    }
  }, [selectedDevice, getCachedProcesses, getCachedStats])

  // 获取进程列表 - 将函数定义在 useEffect 内部，避免依赖问题
  // 注意：这个函数不应该作为 useCallback，因为它会在 useEffect 内部定义

  // 定时刷新 - 使用异步版本，不阻塞UI
  useEffect(() => {
    if (!selectedDevice || !isMountedRef.current || !isHdcAvailable()) return

    let isCancelled = false
    let unsubscribeProcessList: (() => void) | null = null

    // 处理进程列表更新的回调函数
    const handleProcessListUpdate = (result: ProcessListResult) => {
      // 检查是否已取消或组件已卸载
      if (isCancelled || !isMountedRef.current) return

      // 使用requestAnimationFrame优化渲染时机
      requestAnimationFrame(() => {
        if (isCancelled || !isMountedRef.current) return

        // 优化：只在数据真正变化时更新状态，避免不必要的重新渲染
        setProcesses((prevProcesses) => {
          // 如果数据相同，返回原数组引用，避免重新渲染
          if (prevProcesses.length === result.processes.length &&
              prevProcesses.every((p, i) => 
                p.pid === result.processes[i].pid &&
                p.cpuPercent === result.processes[i].cpuPercent &&
                p.res === result.processes[i].res
              )) {
            return prevProcesses
          }
          return result.processes
        })
        
        setStats((prevStats) => {
          // 如果统计信息相同，返回原对象引用
          if (prevStats.total === result.stats.total &&
              prevStats.running === result.stats.running &&
              prevStats.sleeping === result.stats.sleeping &&
              prevStats.stopped === result.stats.stopped &&
              prevStats.zombie === result.stats.zombie) {
            return prevStats
          }
          return result.stats
        })
        
        // 更新全局缓存
        updateProcesses(result.processes, result.stats)
        
        // 更新加载状态
        setIsLoading(false)
        
        // 内存追踪：每10次更新检查一次
        renderCountRef.current += 1
        const now = Date.now()
        if (renderCountRef.current % 10 === 0 || (now - lastMemoryCheckRef.current) > 30000) {
          if (typeof performance !== 'undefined' && 'memory' in performance) {
            const mem = (performance as any).memory
            console.debug('[ProcessManager] 内存状态', {
              renderCount: renderCountRef.current,
              processCount: result.processes.length,
              memory: {
                used: Math.round(mem.usedJSHeapSize / 1048576) + 'MB',
                total: Math.round(mem.totalJSHeapSize / 1048576) + 'MB'
              }
            })
          }
          lastMemoryCheckRef.current = now
        }
      })
    }

    // 设置事件监听器
    unsubscribeProcessList = window.hdc.onProcessListUpdate(handleProcessListUpdate)

    // 获取进程列表的函数（使用异步版本，不阻塞）
    const fetchProcessList = () => {
      if (!selectedDevice || !isHdcAvailable() || !isMountedRef.current || isCancelled) return
      
      setIsLoading(true)
      // 使用异步版本，不阻塞UI
      window.hdc.getProcessListAsync(selectedDevice.connectKey, sortBy, selectedDevice.platform)
    }

    // 清理之前的定时器
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // 存储函数引用，用于手动刷新
    fetchProcessListRef.current = fetchProcessList

    // 立即加载一次
    fetchProcessList()

    // 启动定时刷新
    const interval = setInterval(() => {
      if (isMountedRef.current && !isCancelled) {
        fetchProcessList()
      } else {
        // 如果组件已卸载，清理定时器
        if (intervalRef.current === interval) {
          clearInterval(interval)
          intervalRef.current = null
        }
      }
    }, refreshInterval)
    
    intervalRef.current = interval

    return () => {
      isCancelled = true
      // 清理事件监听器
      if (unsubscribeProcessList) {
        unsubscribeProcessList()
        unsubscribeProcessList = null
      }
      // 清理函数引用
      fetchProcessListRef.current = null
      // 清理定时器
      if (intervalRef.current === interval) {
        clearInterval(interval)
        intervalRef.current = null
      }
    }
  }, [selectedDevice?.connectKey, refreshInterval, sortBy, updateProcesses])

  // 处理图片加载失败的回调
  const handleImageError = useCallback((packageName: string) => {
    if (!isMountedRef.current) return
    setFailedIcons((prev) => {
      if (prev.has(packageName)) {
        return prev
      }
      return new Set(prev).add(packageName)
    })
  }, [])

  // 过滤进程
  const filteredProcesses = useMemo(() => {
    if (!searchTerm) return processes

    const term = searchTerm.toLowerCase()
    return processes.filter(
      (p) =>
        p.command.toLowerCase().includes(term) ||
        p.pid.toString().includes(term) ||
        p.user.toLowerCase().includes(term)
    )
  }, [processes, searchTerm])

  // 打开应用详情弹窗
  const handleOpenDetailDialog = useCallback(
    (app: AppInfo) => {
      setDetailApp(app)
      setDetailDialogOpen(true)
    },
    []
  )

  // 处理点击应用图标/名称
  const handleAppClick = useCallback(
    (packageName: string, e: React.MouseEvent) => {
      e.stopPropagation()
      
      // 从缓存中获取应用信息
      const app = getAppByPackageName(packageName)
      if (app) {
        handleOpenDetailDialog(app)
      }
    },
    [getAppByPackageName, handleOpenDetailDialog]
  )

  // 打开终止进程弹窗
  const handleOpenKillDialog = (process: ProcessInfo, packageName: string) => {
    setSelectedProcess(process)
    setSelectedPackageName(packageName)
    setKillDialogOpen(true)
  }

  // 终止进程
  const handleKillProcess = async () => {
    if (!selectedDevice || !selectedProcess || !selectedPackageName || !isMountedRef.current) return

    setIsKilling(true)
    try {
      const result = await window.hdc.forceStopApp(
        selectedDevice.connectKey,
        selectedPackageName,
        selectedDevice.platform
      )
      if (!isMountedRef.current) return
      
      if (result.success) {
        captureEvent('process killed', { package_name: selectedPackageName, pid: selectedProcess.pid })
        // 终止进程后立即刷新列表
        if (fetchProcessListRef.current) {
          fetchProcessListRef.current()
        }
      } else {
        console.error('[ProcessManager] Failed to force stop app:', result.error)
      }
    } catch (error) {
      console.error('[ProcessManager] Failed to force stop app:', error)
    } finally {
      if (isMountedRef.current) {
        setIsKilling(false)
        setKillDialogOpen(false)
        setSelectedProcess(null)
        setSelectedPackageName('')
      }
    }
  }

  // 未连接设备
  if (!selectedDevice) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <ListTree className="h-6 w-6 text-primary" />
            进程管理
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
      <div className="mb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <ListTree className="h-6 w-6 text-primary" />
          进程管理
          <WindowToggleButton />
            <HelpToggleButton />
        </h1>
        <div className="flex items-center gap-3">
          {/* 刷新间隔 */}
          <Select
            value={String(refreshInterval)}
            onValueChange={(v) => setRefreshInterval(parseInt(v))}
          >
            <SelectTrigger className="w-24 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3000">3 秒</SelectItem>
              <SelectItem value="6000">6 秒</SelectItem>
              <SelectItem value="10000">10 秒</SelectItem>
            </SelectContent>
          </Select>

          {/* 刷新按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // 使用 ref 中存储的函数来刷新
              if (fetchProcessListRef.current) {
                fetchProcessListRef.current()
              }
            }}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* 搜索和统计区 */}
      <div className="mb-4 flex items-center gap-4 flex-shrink-0">
        {/* 搜索框 */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索进程名或 PID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* 排序选择 */}
        <Select value={sortBy} onValueChange={(v) => {
          captureEvent('process sort changed', { sort_by: v })
          setSortBy(v as ProcessSortField)
        }}>
          <SelectTrigger className="w-32 h-9">
            <ArrowUpDown className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mem">按内存</SelectItem>
            <SelectItem value="cpu">按 CPU</SelectItem>
            <SelectItem value="pid">按 PID</SelectItem>
            <SelectItem value="time">按时间</SelectItem>
          </SelectContent>
        </Select>

        {/* 统计卡片 */}
        <div className="flex items-center gap-2">
          <StatCard icon={Activity} label="总计" value={stats.total} color="text-foreground" />
          <StatCard icon={Zap} label="运行" value={stats.running} color="text-green-500" />
          <StatCard icon={Clock} label="睡眠" value={stats.sleeping} color="text-blue-500" />
          <StatCard icon={Skull} label="僵尸" value={stats.zombie} color="text-red-500" />
        </div>
      </div>

      {/* 进程列表 */}
      <Card className="flex-1 min-h-0 overflow-hidden">
        {/* 表头 */}
        <div className="grid grid-cols-[250px_80px_1fr_80px_100px_100px_60px] gap-2 px-4 py-2 border-b text-xs font-medium text-muted-foreground bg-secondary/30">
          <span>应用</span>
          <span className="font-mono">PID</span>
          <span>进程名</span>
          <span className="text-right">CPU %</span>
          <span className="text-right">内存</span>
          <span>用户</span>
          <span className="text-center">操作</span>
        </div>

        {/* 表格内容 */}
        <ScrollArea className="h-[calc(100%-36px)]">
          {isLoading && processes.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredProcesses.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              {searchTerm ? '未找到匹配的进程' : '暂无数据'}
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {filteredProcesses.map((process) => {
                const stateInfo = getStateDescription(process.state)
                // 匹配应用信息
                const matchedApp = matchAppByProcessName(process.command)

                return (
                  <div
                    key={process.pid}
                    className="grid grid-cols-[250px_80px_1fr_80px_100px_100px_60px] gap-2 px-4 py-2 hover:bg-secondary/30 transition-colors items-center group"
                  >
                    {/* 应用列 - 横向布局 */}
                    <div className="flex items-center gap-2 min-w-0">
                      {matchedApp ? (
                        <>
                          <div
                            className="flex-shrink-0 w-10 h-10 rounded-lg bg-secondary/50 flex items-center justify-center overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                            onClick={(e) => handleAppClick(matchedApp.packageName, e)}
                            title={`点击查看 ${matchedApp.appName} 详情`}
                          >
                            {matchedApp.icon && !failedIcons.has(matchedApp.packageName) ? (
                              <img
                                src={matchedApp.icon}
                                alt={matchedApp.appName}
                                className="w-full h-full rounded-lg object-cover"
                                onError={() => handleImageError(matchedApp.packageName)}
                                loading="lazy"
                              />
                            ) : (
                              <Package className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <span
                            className="text-sm font-bold cursor-pointer hover:text-primary transition-colors flex-1 min-w-0 break-words"
                            onClick={(e) => handleAppClick(matchedApp.packageName, e)}
                            title={matchedApp.appName}
                          >
                            {matchedApp.appName}
                          </span>
                        </>
                      ) : (
                        <>
                          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-secondary/30 flex items-center justify-center">
                            <Package className="h-5 w-5 text-muted-foreground/30" />
                          </div>
                          <span className="text-xs text-muted-foreground/30">-</span>
                        </>
                      )}
                    </div>

                    {/* PID */}
                    <span className="font-mono text-sm">{process.pid}</span>

                    {/* 进程名 */}
                    <div className="min-w-0">
                      <p className="font-mono text-sm truncate" title={process.command}>
                        {process.command}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span>时长: {process.time}</span>
                      </p>
                    </div>

                    {/* CPU */}
                    <span
                      className={`font-mono text-sm text-right ${
                        process.cpuPercent > 50
                          ? 'text-red-500'
                          : process.cpuPercent > 20
                            ? 'text-yellow-500'
                            : ''
                      }`}
                    >
                      {process.cpuPercent.toFixed(1)}%
                    </span>

                    {/* 内存 */}
                    <span className="font-mono text-sm text-right">{formatMem(process.res)}</span>

                    {/* 用户 */}
                    <span className="font-mono text-sm truncate" title={process.user}>
                      {process.user}
                    </span>

                    {/* 操作菜单 */}
                    <div className="flex justify-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {matchedApp && (
                            <>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleAppClick(matchedApp.packageName, e)
                                }}
                              >
                                <Package className="h-4 w-4 mr-2" />
                                查看应用详情
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleOpenKillDialog(process, matchedApp.packageName)}>
                                <XCircle className="h-4 w-4 mr-2" />
                                终止进程
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </Card>

      {/* 底部信息 */}
      <div className="mt-2 text-xs text-muted-foreground flex items-center gap-4 flex-shrink-0">
        <span className="font-mono">
          显示 {filteredProcesses.length} / {processes.length} 进程
        </span>
        {searchTerm && (
          <span>
            搜索: &quot;{searchTerm}&quot;
            <Button
              variant="link"
              size="sm"
              onClick={() => setSearchTerm('')}
              className="ml-2 h-auto p-0"
            >
              清除
            </Button>
          </span>
        )}
      </div>

      {/* 终止进程确认弹窗 */}
      <Dialog open={killDialogOpen} onOpenChange={setKillDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-yellow-500" />
              终止进程
            </DialogTitle>
            <DialogDescription>
              <span>确定要终止该进程吗？将使用 aa force-stop 命令强制停止应用。</span>
            </DialogDescription>
          </DialogHeader>

          {selectedProcess && (
            <div className="bg-secondary/30 rounded-lg p-4 space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-muted-foreground flex-shrink-0">进程 ID</span>
                <span className="font-mono font-bold">{selectedProcess.pid}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">进程名</span>
                <span className="font-mono text-sm break-all">
                  {selectedProcess.command}
                </span>
              </div>
              {selectedPackageName && (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">应用包名</span>
                  <span className="font-mono text-sm break-all">
                    {selectedPackageName}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-start">
                <span className="text-muted-foreground flex-shrink-0">用户</span>
                <span className="font-mono">{selectedProcess.user}</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-muted-foreground flex-shrink-0">CPU / 内存</span>
                <span className="font-mono">
                  {selectedProcess.cpuPercent}% / {formatMem(selectedProcess.res)}
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setKillDialogOpen(false)} disabled={isKilling}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleKillProcess}
              disabled={isKilling}
            >
              {isKilling ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  处理中...
                </>
              ) : (
                <>确认终止</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 应用详情弹窗 */}
      <AppDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        app={detailApp}
        selectedDevice={selectedDevice}
        showActions={false}
        onImageError={handleImageError}
        failedIcons={failedIcons}
      />
    </div>
  )
}
