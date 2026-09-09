import React from 'react'
import { Settings, Edit } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { isHdcAvailable } from '@/lib/hdc'
import type { Platform } from '@/types/hdc'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  format: 'jpeg' | 'png'
  onFormatChange: (format: 'jpeg' | 'png') => void
  savePath: string
  onSavePathChange: (path: string) => void
  videoQuality: '0.2' | '0.3' | '0.4' | '0.5' | '0.6' | '0.7' | '0.8' | '0.9'
  onVideoQualityChange: (quality: '0.2' | '0.3' | '0.4' | '0.5' | '0.6' | '0.7' | '0.8' | '0.9') => void
  platform?: Platform | string
}

/**
 * 设置弹窗组件
 */
export function SettingsDialog({
  open,
  onOpenChange,
  format,
  onFormatChange,
  savePath,
  onSavePathChange,
  videoQuality,
  onVideoQualityChange,
  platform = 'harmonyos'
}: SettingsDialogProps): React.JSX.Element {
  const handleSelectSavePath = async () => {
    if (!isHdcAvailable()) return

    try {
      const selectedPath = await window.hdc.selectScreenshotPath()
      if (selectedPath) {
        onSavePathChange(selectedPath)
        toast.success('路径已更新')
      }
    } catch (error) {
      console.error('[Settings] Failed to select path:', error)
      toast.error('选择路径失败')
    }
  }

  const isAndroid = platform === 'android'

  const renderVideoQualitySelect = () => {
    if (isAndroid) {
      return (
        <Select value={videoQuality} onValueChange={(v) => onVideoQualityChange(v as '0.2' | '0.3' | '0.4' | '0.5' | '0.6' | '0.7' | '0.8' | '0.9')}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0.9">1920p (高清)</SelectItem>
            <SelectItem value="0.7">1440p</SelectItem>
            <SelectItem value="0.6">1280p (推荐)</SelectItem>
            <SelectItem value="0.5">1080p</SelectItem>
            <SelectItem value="0.4">720p</SelectItem>
            <SelectItem value="0.3">480p</SelectItem>
          </SelectContent>
        </Select>
      )
    }

    return (
      <Select value={videoQuality} onValueChange={(v) => onVideoQualityChange(v as '0.2' | '0.3' | '0.4' | '0.5' | '0.6' | '0.7' | '0.8' | '0.9')}>
        <SelectTrigger className="w-full">
          <SelectValue>
            {`视频质量${Math.round(parseFloat(videoQuality) * 100)}%`}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="0.9">视频质量90%</SelectItem>
          <SelectItem value="0.8">视频质量80%</SelectItem>
          <SelectItem value="0.7">视频质量70%</SelectItem>
          <SelectItem value="0.6">视频质量60%</SelectItem>
          <SelectItem value="0.5">视频质量50%</SelectItem>
          <SelectItem value="0.4">视频质量40%</SelectItem>
          <SelectItem value="0.3">视频质量30%</SelectItem>
          <SelectItem value="0.2">视频质量20%</SelectItem>
        </SelectContent>
      </Select>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            设置
          </DialogTitle>
          <DialogDescription></DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 格式选择 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">格式</label>
            <Select value={format} onValueChange={(v) => onFormatChange(v as 'jpeg' | 'png')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jpeg">JPEG（推荐）</SelectItem>
                <SelectItem value="png">PNG</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 保存路径 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">保存路径</label>
            <div className="flex gap-2">
              <Input
                value={savePath}
                readOnly
                className="flex-1 font-mono text-sm"
                placeholder="选择保存路径..."
              />
              <Button variant="outline" onClick={handleSelectSavePath} className="flex-shrink-0">
                <Edit className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 视频质量 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{isAndroid ? '分辨率' : '视频质量'}</label>
            {renderVideoQualitySelect()}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}




