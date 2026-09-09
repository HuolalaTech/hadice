import React from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { ScreenshotHistoryItem } from '@/types/hdc'
import { formatTimestamp } from '../utils/format'

interface DeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: ScreenshotHistoryItem | null
  onConfirm: () => void
}

/**
 * 删除确认弹窗组件
 */
export function DeleteDialog({
  open,
  onOpenChange,
  target,
  onConfirm
}: DeleteDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            删除截图
          </DialogTitle>
          <DialogDescription>确定要删除这张截图吗？此操作不可撤销。</DialogDescription>
        </DialogHeader>
        {target && (
          <div className="bg-secondary/30 rounded-lg p-4 space-y-2 text-sm font-mono">
            <div className="flex justify-between">
              <span className="text-muted-foreground">文件名</span>
              <span className="truncate max-w-[200px]">{target.fileName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">时间</span>
              <span>{formatTimestamp(target.timestamp)}</span>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}






