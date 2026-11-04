import { useState } from 'react'
import { Copy, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { copyTextToClipboard } from '@/lib/clipboard'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { formatDateTime, formatFileSize } from '@/lib/format'
import type { InstallHistoryItem, InstallPlatform } from '@/types/install'

interface PropsInstallHistoryList {
  readonly platform: InstallPlatform
  readonly history: InstallHistoryItem[]
  readonly isLoading: boolean
  readonly activeHistoryId: string | null
  readonly onClose: () => void
  readonly onReinstall: (historyId: string) => void
  readonly onDelete: (historyId: string) => void
  readonly onClear: () => Promise<void>
}

const PLATFORM_LABELS: Record<InstallPlatform, string> = {
  android: 'Android',
  harmonyos: 'HarmonyOS'
}

export function InstallHistoryList({
  platform,
  history,
  isLoading,
  activeHistoryId,
  onClose,
  onReinstall,
  onDelete,
  onClear
}: PropsInstallHistoryList): React.JSX.Element {
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const platformLabel = PLATFORM_LABELS[platform]
  const isGloballyDisabled = isLoading || isClearing

  const handleClearDialogOpenChange = (open: boolean): void => {
    if (isClearing && !open) return
    setIsClearDialogOpen(open)
  }

  const handleClear = async (): Promise<void> => {
    setIsClearing(true)
    try {
      await onClear()
      setIsClearDialogOpen(false)
    } catch {
      // 页面负责展示具体错误；保留对话框开启并消费拒绝，避免事件处理器产生未处理 Promise。
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">安装历史</CardTitle>
        <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          aria-label="关闭安装历史"
        >
          <X className="mr-1 h-4 w-4" aria-hidden="true" />
          关闭
        </Button>
        <Dialog open={isClearDialogOpen} onOpenChange={handleClearDialogOpenChange}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isGloballyDisabled || history.length === 0 || activeHistoryId !== null}
              aria-label={`清空 ${platformLabel} 安装记录`}
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              清空
            </Button>
          </DialogTrigger>
          <DialogContent
            onEscapeKeyDown={(event) => {
              if (isClearing) event.preventDefault()
            }}
            onPointerDownOutside={(event) => {
              if (isClearing) event.preventDefault()
            }}
          >
            <DialogHeader>
              <DialogTitle>清空 {platformLabel} 安装记录？</DialogTitle>
              <DialogDescription>
                此操作只会清空当前平台（{platformLabel}）的全部安装记录，且无法撤销。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isClearing}>
                  取消
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={handleClear}
                disabled={isGloballyDisabled}
                aria-label={`确认清空 ${platformLabel} 安装记录`}
              >
                {isClearing && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {isClearing ? '清空中...' : '确认清空'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-auto">
        <Table aria-label={`${platformLabel} 安装历史`}>
          <TableHeader>
            <TableRow>
              <TableHead>应用</TableHead>
              <TableHead>版本</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>结果</TableHead>
              <TableHead>安装时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && history.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    加载中...
                  </span>
                </TableCell>
              </TableRow>
            ) : history.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  暂无 {platformLabel} 安装记录
                </TableCell>
              </TableRow>
            ) : (
              history.map((item) => {
                const isActive = activeHistoryId === item.id
                const isOperationDisabled =
                  isGloballyDisabled || activeHistoryId !== null
                const displayName = item.appName || item.fileName

                return (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-48">
                      <div className="truncate font-medium" title={displayName}>
                        {displayName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatFileSize(item.fileSize)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{item.versionName || '-'}</div>
                      {item.packageName && (
                        <div
                          className="max-w-40 truncate text-xs text-muted-foreground"
                          title={item.packageName}
                        >
                          {item.packageName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-64">
                      <div className="text-xs text-muted-foreground">
                        {item.sourceType === 'local' ? '本地' : '链接'}
                      </div>
                      {item.sourceType === 'url' ? (
                        <div className="mt-0.5 flex items-start gap-1">
                          <div
                            className="min-w-0 flex-1 break-all font-mono text-xs text-sky-700 dark:text-sky-300"
                            title={item.source}
                          >
                            {item.source}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            title="复制链接地址"
                            aria-label={`复制链接地址 ${item.source}`}
                            disabled={!item.source}
                            onClick={() => {
                              void copyTextToClipboard(item.source).then((ok) => {
                                if (ok) toast.success('已复制链接地址')
                                else toast.error('复制失败')
                              })
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="break-all text-xs" title={item.source}>
                          {item.source}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-52">
                      {item.success ? (
                        <Badge variant="success">成功</Badge>
                      ) : (
                        <div className="space-y-1">
                          <Badge variant="destructive">失败</Badge>
                          <div
                            className="truncate text-xs text-destructive"
                            title={item.error || '未知错误'}
                          >
                            {item.error || '未知错误'}
                          </div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(item.installedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onReinstall(item.id)}
                          disabled={isOperationDisabled}
                          aria-label={`重新安装 ${displayName}`}
                        >
                          {isActive ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                          )}
                          重新安装
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(item.id)}
                          disabled={isOperationDisabled}
                          aria-label={`删除 ${displayName} 安装记录`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
