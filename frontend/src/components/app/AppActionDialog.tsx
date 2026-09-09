import React from 'react'
import {
  Play,
  Square,
  Database,
  Sparkles,
  Trash2,
  RefreshCw
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatFileSize } from '@/lib/format'
import type { AppInfo } from '@/types/hdc'

/**
 * 应用操作确认对话框
 */
export function AppActionDialog({
  open,
  onOpenChange,
  app,
  actionType,
  isActioning,
  onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  app: AppInfo | null
  actionType: 'start' | 'stop' | 'clear' | 'clearCache' | 'uninstall' | null
  isActioning: boolean
  onConfirm: () => void
}): React.JSX.Element {
  if (!app || !actionType) return <></>

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {actionType === 'start' && (
              <>
                <Play className="h-5 w-5 text-green-500" />
                启动应用
              </>
            )}
            {actionType === 'stop' && (
              <>
                <Square className="h-5 w-5 text-yellow-500" />
                停止应用
              </>
            )}
            {actionType === 'clear' && (
              <>
                <Database className="h-5 w-5 text-orange-500" />
                清除应用数据
              </>
            )}
            {actionType === 'clearCache' && (
              <>
                <Sparkles className="h-5 w-5 text-blue-500" />
                清除应用缓存
              </>
            )}
            {actionType === 'uninstall' && (
              <>
                <Trash2 className="h-5 w-5 text-red-500" />
                卸载应用
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {actionType === 'start' && '确定要启动该应用吗？'}
            {actionType === 'stop' && '确定要停止该应用吗？'}
            {actionType === 'clear' && (
              <span className="text-orange-400">
                警告：清除应用数据将删除应用的所有用户数据，包括登录信息、设置等。此操作不可撤销。
              </span>
            )}
            {actionType === 'clearCache' && '确定要清除该应用的缓存文件吗？这将释放存储空间，但不会影响应用数据。'}
            {actionType === 'uninstall' && (
              <span className="text-red-400">
                警告：卸载应用将永久删除该应用及其所有数据。此操作不可撤销。
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-secondary/30 rounded-lg p-4 space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">应用名称</span>
            <span className="font-semibold">{app.appName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">包名</span>
            <span className="font-mono text-sm truncate max-w-[200px]">
              {app.packageName}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">版本</span>
            <span className="font-mono">{app.version}</span>
          </div>
          {actionType === 'uninstall' && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">大小</span>
              <span className="font-mono">{formatFileSize(app.size)}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isActioning}
          >
            取消
          </Button>
          <Button
            variant={actionType === 'uninstall' || actionType === 'clear' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isActioning}
          >
            {isActioning ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                处理中...
              </>
            ) : (
              <>
                确认
                {actionType === 'start'
                  ? '启动'
                  : actionType === 'stop'
                    ? '停止'
                    : actionType === 'clear'
                      ? '清除'
                      : actionType === 'clearCache'
                        ? '清除缓存'
                        : '卸载'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

