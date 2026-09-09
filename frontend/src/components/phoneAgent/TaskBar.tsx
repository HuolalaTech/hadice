import React, { useState } from 'react'
import { History, Plus, X, Zap } from 'lucide-react'
import { usePhoneAgentStore } from '@/modules/phoneAgent/store'
import { PhoneAgent } from '@/modules/phoneAgent/agent'
import { ChatHistoryDialog } from './ChatHistoryDialog'
import { toast } from 'sonner'

/**
 * 任务栏组件
 * 显示当前任务名称和控制按钮
 */
export function TaskBar(): React.JSX.Element {
  const { currentTask, isRunning, sessionID, stepCount, reset } = usePhoneAgentStore()
  const [agent, setAgent] = useState<PhoneAgent | null>(null)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)

  // 获取Agent实例
  React.useEffect(() => {
    if (sessionID) {
      // 这里应该从某个地方获取Agent实例
      // 简化处理：Agent实例在MessageInput中管理
    }
  }, [sessionID])

  const handleNewChat = () => {
    if (isRunning) {
      toast.warning('请先停止当前任务')
      return
    }
    reset()
    toast.success('已创建新对话')
  }

  const handleStop = async () => {
    if (!agent || !sessionID) {
      return
    }

    try {
      await agent.stop()
      reset()
      toast.success('任务已停止')
    } catch (error) {
      console.error('[TaskBar] Failed to stop agent:', error)
      toast.error('停止任务失败')
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground">当前任务</div>
            <div className="text-sm font-medium text-foreground">
              {currentTask || '未开始'}
              {isRunning && (
                <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 bg-primary/20 text-primary rounded text-xs">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  步骤 {stepCount}
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          {isRunning && (
            <button
              onClick={handleStop}
              className="p-2 rounded-md hover:bg-destructive/10 text-destructive transition-colors"
              title="停止任务"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setHistoryDialogOpen(true)}
            className="p-2 rounded-md hover:bg-accent transition-colors text-muted-foreground"
            title="历史对话"
          >
            <History className="h-4 w-4" />
          </button>
          <button
            onClick={handleNewChat}
            className="p-2 rounded-md hover:bg-primary/10 transition-colors text-primary"
            title="新建对话"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 历史对话弹窗 */}
      <ChatHistoryDialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen} />
    </>
  )
}
