import React, { useState, useEffect } from 'react'
import { Settings, RefreshCw, CheckCircle2, XCircle, Loader2, Plus, Check, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useDeviceStore } from '@/store/deviceStore'
import type { PortForwardStatus, ConnectionTestResult } from '@/types/hdc'

interface PortForwardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  localPort: number
  devicePort: number
  onPortChange: (localPort: number, devicePort: number) => void
  onStatusChange: (status: PortForwardStatus) => void
}

/**
 * 端口转发配置弹窗组件
 */
export function PortForwardDialog({
  open,
  onOpenChange,
  localPort: initialLocalPort,
  devicePort: initialDevicePort,
  onPortChange,
  onStatusChange
}: PortForwardDialogProps): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [portForwardList, setPortForwardList] = useState<Array<{ localPort: number; devicePort: number; type: 'Forward' | 'Reverse' }>>([])
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [editingLocalPort, setEditingLocalPort] = useState('')
  const [editingDevicePort, setEditingDevicePort] = useState('')
  const [editingType, setEditingType] = useState<'Forward' | 'Reverse'>('Forward')
  const [isApplying, setIsApplying] = useState(false)
  const [removingIndex, setRemovingIndex] = useState<number | null>(null)

  /**
   * 解析端口字符串，支持 tcp:端口号 格式
   * @param portStr 端口字符串，如 "tcp:6000" 或 "6000"
   * @returns 端口号，如果解析失败返回 null
   */
  const parsePort = (portStr: string): number | null => {
    if (!portStr) return null
    
    // 移除空白字符
    const trimmed = portStr.trim()
    
    // 如果包含 tcp: 前缀，提取后面的数字
    const match = trimmed.match(/^tcp:\s*(\d+)$/i) || trimmed.match(/^(\d+)$/)
    if (match) {
      const port = parseInt(match[1], 10)
      if (!isNaN(port) && port >= 1024 && port <= 65535) {
        return port
      }
    }
    
    return null
  }

  // 加载端口转发列表
  const loadPortForwardList = async (): Promise<void> => {
    setIsLoadingList(true)
    try {
      const list = await window.hdc.networkCapture.listPortForwards()
      setPortForwardList(list)
    } catch (error) {
      console.error('[PortForwardDialog] 加载端口转发列表失败:', error)
    } finally {
      setIsLoadingList(false)
    }
  }

  // 当弹窗打开时，加载列表
  useEffect(() => {
    if (open && selectedDevice) {
      loadPortForwardList()
    }
  }, [open, selectedDevice])

  // 弹窗关闭时，重置编辑状态
  useEffect(() => {
    if (!open) {
      setIsAdding(false)
      setEditingLocalPort('')
      setEditingDevicePort('')
      setEditingType('Forward')
      setTestResult(null)
    }
  }, [open])

  // 应用新的端口转发配置
  const handleApply = async (): Promise<void> => {
    if (!selectedDevice) return

    const local = parsePort(editingLocalPort)
    const device = parsePort(editingDevicePort)

    if (local === null) {
      toast.error('本地端口格式错误，请输入 tcp:端口号(1024-65535)')
      return
    }

    if (device === null) {
      toast.error('设备端口格式错误，请输入 tcp:端口号(1024-65535)')
      return
    }

    setIsApplying(true)
    try {
      const status = await window.hdc.networkCapture.configurePortForward(
        selectedDevice.connectKey,
        local,
        device,
        editingType
      )
      
      if (status.configured) {
        toast.success('端口转发配置成功')
        // 重置编辑状态
        setIsAdding(false)
        setEditingLocalPort('')
        setEditingDevicePort('')
        setEditingType('Forward')
        // 刷新列表
        await loadPortForwardList()
        // 更新父组件状态
        onPortChange(local, device)
        onStatusChange(status)
      } else {
        toast.error(`配置失败: ${status.error || '未知错误'}`)
      }
    } catch (error) {
      console.error('[PortForwardDialog] 配置失败:', error)
      toast.error(`配置失败: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setIsApplying(false)
    }
  }

  // 删除端口转发
  const handleRemove = async (item: { localPort: number; devicePort: number }, index: number): Promise<void> => {
    if (!selectedDevice) return

    setRemovingIndex(index)
    try {
      const result = await window.hdc.networkCapture.removePortForward(
        selectedDevice.connectKey,
        item.localPort,
        item.devicePort
      )
      
      if (result.success) {
        toast.success('删除成功')
        // 刷新列表
        await loadPortForwardList()
        // 更新父组件状态
        const status: PortForwardStatus = {
          configured: false,
          localPort: item.localPort,
          devicePort: item.devicePort,
          status: 'not_configured'
        }
        onStatusChange(status)
      } else {
        toast.error(`删除失败: ${result.error || '未知错误'}`)
      }
    } catch (error) {
      console.error('[PortForwardDialog] 删除失败:', error)
      toast.error(`删除失败: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setRemovingIndex(null)
    }
  }

  // 点击增加转发规则按钮
  const handleAddNewRow = (): void => {
    setIsAdding(true)
    setEditingLocalPort('')
    setEditingDevicePort('')
    setEditingType('Forward')
  }

  // 取消编辑
  const handleCancelEdit = (): void => {
    setIsAdding(false)
    setEditingLocalPort('')
    setEditingDevicePort('')
    setEditingType('Forward')
  }

  // 测试连接（使用列表中的第一个端口）
  const handleTestConnection = async (): Promise<void> => {
    if (portForwardList.length === 0) {
      toast.error('没有可测试的端口转发')
      return
    }

    const firstPort = portForwardList[0].localPort
    setIsTesting(true)
    setTestResult(null)
    try {
      if (!selectedDevice) return
      const result = await window.hdc.networkCapture.testConnection(selectedDevice.connectKey, firstPort)
      setTestResult(result)
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            端口转发配置
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 当前设备信息 */}
          {selectedDevice && (
            <div className="text-sm text-muted-foreground">
              当前设备: {selectedDevice.displayName || selectedDevice.connectKey} ({selectedDevice.connectionType})
            </div>
          )}

          {/* 端口转发列表 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">端口转发列表</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadPortForwardList}
                disabled={isLoadingList}
              >
                <RefreshCw className={`h-4 w-4 ${isLoadingList ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            <ScrollArea className="h-[200px] border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">本地端口</TableHead>
                    <TableHead className="w-[200px]">设备端口</TableHead>
                    <TableHead className="w-[100px]">类型</TableHead>
                    <TableHead className="w-[100px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingList ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground text-sm">
                        加载中...
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {portForwardList.length === 0 && !isAdding ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground text-sm">
                            暂无端口转发
                          </TableCell>
                        </TableRow>
                      ) : (
                        portForwardList.map((item, index) => (
                          <TableRow key={`${item.localPort}-${item.devicePort}-${index}`}>
                            <TableCell className="font-mono text-sm">tcp:{item.localPort}</TableCell>
                            <TableCell className="font-mono text-sm">tcp:{item.devicePort}</TableCell>
                            <TableCell className="text-sm">
                              <span className={`px-2 py-1 rounded text-xs ${
                                item.type === 'Forward' 
                                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' 
                                  : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                              }`}>
                                {item.type === 'Forward' ? '正向转发' : '反向转发'}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemove(item, index)}
                                disabled={removingIndex === index || isApplying}
                                className="h-8 w-8 p-0"
                              >
                                {removingIndex === index ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                      {/* 编辑行 */}
                      {isAdding && (
                        <TableRow>
                          <TableCell>
                            <Input
                              type="text"
                              value={editingLocalPort}
                              onChange={(e) => setEditingLocalPort(e.target.value)}
                              placeholder="tcp: 端口号(1024-65535)"
                              disabled={isApplying}
                              className="font-mono text-sm w-full"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="text"
                              value={editingDevicePort}
                              onChange={(e) => setEditingDevicePort(e.target.value)}
                              placeholder="tcp: 端口号(1024-65535)"
                              disabled={isApplying}
                              className="font-mono text-sm w-full"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={editingType}
                              onValueChange={(value) => setEditingType(value as 'Forward' | 'Reverse')}
                              disabled={isApplying}
                            >
                              <SelectTrigger className="h-8 text-sm w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Forward">正向转发</SelectItem>
                                <SelectItem value="Reverse">反向转发</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleApply}
                                disabled={isApplying}
                                className="h-8 w-8 p-0"
                              >
                                {isApplying ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="h-4 w-4 text-green-600" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleCancelEdit}
                                disabled={isApplying}
                                className="h-8 w-8 p-0"
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {/* 增加转发规则按钮行 - 始终显示在最后 */}
                      {!isAdding && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleAddNewRow}
                              disabled={isApplying || removingIndex !== null}
                              className="mx-auto"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              增加转发规则
                            </Button>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>

          {/* 分隔线 */}
          <div className="border-t border-border" />

          {/* 连接测试 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">连接测试</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={isTesting || portForwardList.length === 0 || !selectedDevice}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    测试中...
                  </>
                ) : (
                  '测试连接'
                )}
              </Button>
            </div>
            {testResult && (
              <div
                className={`p-3 rounded-md text-sm ${
                  testResult.success
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
                }`}
              >
                {testResult.success ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>连接成功</span>
                    {testResult.latency !== undefined && (
                      <span className="text-xs">(耗时: {testResult.latency}ms)</span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    <span>连接失败: {testResult.error || '未知错误'}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

