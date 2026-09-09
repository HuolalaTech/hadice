import React, { useEffect, useState } from 'react'
import { X, Mail, BookOpen, Monitor, FileText } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import logoIcon from '@/assets/icon.png'
import { DOCS_URL } from '@/lib/config'
import * as App from '../../../bindings/Hadice/backend/appservice'

interface HelpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 帮助弹窗组件
 * 显示软件使用指导、快捷键、作者联系方式等信息
 */
export function HelpDialog({ open, onOpenChange }: HelpDialogProps): React.JSX.Element {
  const [appVersion, setAppVersion] = useState<string>('加载中...')

  useEffect(() => {
    if (open) {
      App.GetAppVersion().then(setAppVersion).catch(() => setAppVersion('Unknown'))
    }
  }, [open])

  const handleOpenOnlineDocs = (e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    if (!DOCS_URL) return
    App.OpenBrowser(DOCS_URL).catch((err) => {
      console.error('Failed to open URL:', err)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] [&>button]:hidden">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <img src={logoIcon} alt="Logo" className="h-6 w-6 rounded" />
            Hadice 帮助
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <ScrollArea className="h-[60vh] pr-4">
          <div className="space-y-6">
            {/* 关于 */}
            <section>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Monitor className="h-4 w-4 text-primary" />
                关于本软件
              </h3>
              <div className="text-sm text-muted-foreground space-y-2 pl-6">
                <p>
                  Hadice - 同时支持安卓和鸿蒙手机的桌面端开发调试工具
                </p>
                <p>
                  通过USB连接安卓&鸿蒙手机，可以在桌面端实现对手机的性能监控、快速安装APK/HAP包、手机-电脑文件互传、手机投屏到电脑、查看APP网络请求等操作。
                </p>
                <p>版本：{appVersion}</p>
              </div>
            </section>

            <Separator />

            {/* 使用指南 */}
            <section>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <BookOpen className="h-4 w-4 text-primary" />
                使用指南
              </h3>
              <div className="text-sm text-muted-foreground space-y-4 pl-6">
                <div>
                  <p className="font-medium text-foreground mb-2">1. 开启手机的开发者模式</p>
                  <div className="pl-4 space-y-1">
                    <p>• 鸿蒙手机：进入"设置 {'>'} 关于本机 {'>'} 软件版本"，连续点击7次"软件版本"，返回"设置 {'>'} 系统 {'>'} 开发者选项"，启用"开发者选项"和"USB调试"</p>
                    <p>• 安卓手机：进入"设置 {'>'} 关于手机"，连续点击"版本号"7次，返回"设置 {'>'} 开发者选项"，启用"USB调试"</p>
                  </div>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-2">2. USB连接</p>
                  <p className="pl-4">将手机通过USB数据线连接到电脑</p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-2">3. 刷新设备</p>
                  <div className="pl-4 space-y-1">
                    <p>• 在程序右上角点击"刷新"图标</p>
                    <p>• 在手机上点击"允许此电脑调试设备"</p>
                    <p>• 如有连接问题，可点击"连接诊断"进行排查</p>
                  </div>
                </div>
              </div>
            </section>

            <Separator />
            <section>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Mail className="h-4 w-4 text-primary" />
                联系作者
              </h3>
              <div className="text-sm pl-6 space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">邮箱：</span>
                  <a href="mailto:haivo@foxmail.com" className="text-primary hover:underline">
                    haivo@foxmail.com
                  </a>
                </div>
                {DOCS_URL && (
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">在线文档：</span>
                    <button
                      type="button"
                      onClick={handleOpenOnlineDocs}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="text-primary hover:underline bg-transparent border-none p-0 cursor-pointer"
                    >
                      文档
                    </button>
                  </div>
                )}
              </div>
            </section>

            <Separator />

            {/* 版权信息 */}
            <section className="text-center text-xs text-muted-foreground pb-4">
              <p>© 2026 Hadice. All rights reserved.</p>
              <p className="mt-1">Made with ❤️ for Android & HarmonyOS developers</p>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
