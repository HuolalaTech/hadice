import React, { useState } from 'react'
import { FileText, HelpCircle, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { HelpDialog } from '@/components/dialogs/HelpDialog'
import { useDeviceStore } from '@/store/deviceStore'

/**
 * 底部状态栏组件
 * 显示连接状态、设备信息、HDC 版本、日志和帮助入口
 */
export function Footer(): React.JSX.Element {
  const [helpOpen, setHelpOpen] = useState(false)
  const { selectedDevice, devices, hdcVersion, adbVersion } = useDeviceStore()

  // 计算连接状态
  const connectedCount = devices.filter((d) => d.status === 'Connected').length
  const isConnected = connectedCount > 0

  return (
    <>
      <footer className="h-8 border-t border-border bg-card/30 px-4 flex items-center justify-between text-xs text-muted-foreground">
        {/* 左侧状态信息 */}
        <div className="flex items-center gap-3">
          {/* 连接状态 */}
          <div className="flex items-center gap-1.5">
            <Circle
              className={`h-2 w-2 ${
                isConnected ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'
              }`}
            />
            <span>{isConnected ? `已连接 (${connectedCount})` : '未连接'}</span>
          </div>

          <Separator orientation="vertical" className="h-3" />

          {/* 设备信息 */}
          <span>
            设备:{' '}
            {selectedDevice
              ? selectedDevice.productName || selectedDevice.model || selectedDevice.connectKey
              : '无'}
            {selectedDevice && (
              <span
                className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[11px] leading-none align-middle -translate-y-[1px] ${
                  selectedDevice.platform === 'harmonyos'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-green-500/20 text-green-400'
                }`}
              >
                {selectedDevice.platform === 'harmonyos' ? '鸿蒙' : '安卓'}
              </span>
            )}
          </span>

          <Separator orientation="vertical" className="h-3" />

        </div>

        {/* 右侧操作按钮 */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            onClick={async () => {
              try {
                const logFilePath = await window.hdc.getLogFilePath()
                const result = await window.hdc.openLogFile(logFilePath)
                if (!result.success && result.error) {
                  console.error('[Footer] Failed to open log file:', result.error)
                }
              } catch (error) {
                console.error('[Footer] Error opening log file:', error)
              }
            }}
          >
            <FileText className="h-3 w-3" />
            <span>日志</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            onClick={() => setHelpOpen(true)}
          >
            <HelpCircle className="h-3 w-3" />
            <span>帮助</span>
          </Button>
        </div>
      </footer>

      {/* 帮助弹窗 */}
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  )
}
