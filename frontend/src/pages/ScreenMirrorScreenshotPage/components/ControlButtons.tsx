import React from 'react'
import {
  ArrowLeft,
  Home,
  Volume2,
  Volume1,
  Power
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ControlButtonsProps {
  isStreaming: boolean
  onAction: (action: string) => void
}

/**
 * 控制按钮组件
 * 保留的按钮：返回、Home、音量+、音量-、Power
 */
export function ControlButtons({
  isStreaming,
  onAction
}: ControlButtonsProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 flex-shrink-0">
      <Button
        variant="outline"
        size="icon"
        onClick={() => onAction('back')}
        disabled={!isStreaming}
        className="h-12 w-12"
        title="返回"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        onClick={() => onAction('home')}
        disabled={!isStreaming}
        className="h-12 w-12"
        title="Home"
      >
        <Home className="h-5 w-5" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        onClick={() => onAction('volumeUp')}
        disabled={!isStreaming}
        className="h-12 w-12"
        title="音量+"
      >
        <Volume2 className="h-5 w-5" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        onClick={() => onAction('volumeDown')}
        disabled={!isStreaming}
        className="h-12 w-12"
        title="音量-"
      >
        <Volume1 className="h-5 w-5" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        onClick={() => onAction('power')}
        disabled={!isStreaming}
        className="h-12 w-12"
        title="电源键"
      >
        <Power className="h-5 w-5" />
      </Button>
    </div>
  )
}






