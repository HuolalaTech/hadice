import React from 'react'
import { X, Download } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

interface UpdateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentVersion: string
  latestVersion: string
  releaseDate: string
  downloadURL: string
  releaseNotes: string
  onDownload: () => void
}

/**
 * 更新提示对话框组件
 * 显示新版本信息和更新说明
 */
export function UpdateDialog({
  open,
  onOpenChange,
  currentVersion,
  latestVersion,
  releaseDate,
  downloadURL,
  releaseNotes,
  onDownload
}: UpdateDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] [&>button]:hidden">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex-1">
            <DialogTitle className="text-xl font-bold">发现新版本</DialogTitle>
            <DialogDescription className="mt-2">
              当前版本: {currentVersion} → 最新版本: {latestVersion}
              {releaseDate && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({releaseDate})
                </span>
              )}
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div className="space-y-4">
          {releaseNotes && (
            <div>
              <h3 className="text-sm font-semibold mb-2">更新说明</h3>
              <ScrollArea className="h-[200px] w-full rounded-md border p-4">
                <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {releaseNotes}
                </div>
              </ScrollArea>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              稍后提醒
            </Button>
            <Button onClick={onDownload} className="gap-2">
              <Download className="h-4 w-4" />
              下载更新
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
