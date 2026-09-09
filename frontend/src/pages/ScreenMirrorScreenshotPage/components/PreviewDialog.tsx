import React from 'react'
import { RefreshCw, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

interface PreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageData: string
}

/**
 * 全屏预览弹窗组件
 */
export function PreviewDialog({
  open,
  onOpenChange,
  imageData
}: PreviewDialogProps): React.JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        onOpenChange(open)
        if (!open) {
          // 清理图片数据以释放内存
        }
      }}
    >
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden [&>button]:hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>全屏预览</DialogTitle>
          <DialogDescription>
            {imageData ? '图片预览' : '加载中'}
          </DialogDescription>
        </DialogHeader>
        <div className="relative w-full h-full flex items-center justify-center bg-black/90">
          {imageData ? (
            <img
              src={imageData}
              alt="Full preview"
              className="max-w-full max-h-[85vh] object-contain"
            />
          ) : (
            <RefreshCw className="h-8 w-8 animate-spin text-white" />
          )}
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors z-10"
            onClick={() => onOpenChange(false)}
            aria-label="关闭预览"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}






