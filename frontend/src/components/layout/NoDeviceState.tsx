import React, { useState } from 'react'
import { HelpCircle, Smartphone } from 'lucide-react'
import { HelpDialog } from '@/components/dialogs/HelpDialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'

interface NoDeviceStateProps {
  icon?: React.ReactNode
}

export function NoDeviceState({ icon }: NoDeviceStateProps): React.JSX.Element {
  const [helpOpen, setHelpOpen] = useState(false)

  return (
    <div className="text-center text-muted-foreground">
      {icon ?? <Smartphone className="h-16 w-16 mx-auto mb-4 opacity-50" />}
      <div className="flex items-center justify-center gap-1.5">
        <p className="text-lg">请先连接设备</p>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted hover:text-foreground"
                aria-label="打开帮助"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>帮助</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <p className="text-sm mt-2">在右上角选择已连接的设备</p>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
