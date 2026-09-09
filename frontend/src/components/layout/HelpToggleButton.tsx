import React, { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { usePageContext } from '@/contexts/PageContext'
import { PageHelpDialog } from '@/components/dialogs/PageHelpDialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'

export function HelpToggleButton(): React.JSX.Element | null {
  const ctx = usePageContext()
  const [open, setOpen] = useState(false)
  if (!ctx) return null

  const { menuId } = ctx

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setOpen(true)}
              className="p-1.5 rounded-md transition-colors text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>帮助</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PageHelpDialog open={open} onOpenChange={setOpen} menuId={menuId} />
    </>
  )
}
