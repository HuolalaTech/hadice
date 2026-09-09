import React from 'react'
import { Trash2, Clock, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useChatHistoryStore, formatDuration } from '@/modules/phoneAgent/chatHistoryStore'
import { usePhoneAgentStore } from '@/modules/phoneAgent/store'
import type { ChatSessionStatus } from '@/modules/phoneAgent/types'

interface ChatHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 获取状态图标和颜色
 */
function getStatusIcon(status: ChatSessionStatus) {
  switch (status) {
    case 'completed':
      return { icon: CheckCircle2, color: 'text-green-600 dark:text-green-400', label: '已完成' }
    case 'interrupted':
      return { icon: AlertTriangle, color: 'text-yellow-600 dark:text-yellow-400', label: '已中断' }
    case 'error':
      return { icon: XCircle, color: 'text-red-600 dark:text-red-400', label: '错误' }
  }
}

/**
 * 历史对话弹窗组件
 */
export function ChatHistoryDialog({
  open,
  onOpenChange
}: ChatHistoryDialogProps): React.JSX.Element {
  const { sessions, deleteSession } = useChatHistoryStore()
  const { setMessages, reset } = usePhoneAgentStore()

  // 按更新时间倒序排列
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  /**
   * 加载历史会话
   */
  const handleLoadSession = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId)
    if (session) {
      // 重置当前状态
      reset()
      // 加载历史消息
      setMessages(session.messages)
      // 关闭弹窗
      onOpenChange(false)
    }
  }

  /**
   * 删除历史会话
   */
  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation() // 防止触发加载会话
    deleteSession(sessionId)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[600px] h-[600px] flex flex-col p-6">
        <DialogHeader className="px-0 py-0 border-b border-border pb-4 mb-4">
          <div className="flex items-center justify-between">
            <DialogTitle>历史对话</DialogTitle>
          </div>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto">
          {sortedSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Clock className="h-12 w-12 mb-3 opacity-50" />
              <p className="text-sm">暂无历史对话</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedSessions.map((session) => {
                const statusInfo = getStatusIcon(session.status)
                const StatusIcon = statusInfo.icon
                
                return (
                  <div
                    key={session.id}
                    onClick={() => handleLoadSession(session.id)}
                    className="flex items-start gap-4 px-4 py-3 bg-secondary/30 rounded-lg hover:bg-accent cursor-pointer group transition-colors"
                  >
                    {/* 左侧：任务信息 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground line-clamp-2 leading-relaxed">
                        {session.title}
                      </p>
                    </div>
                    
                    {/* 右侧：信息区 */}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                      {/* 步数 */}
                      <span>{session.stepCount}步</span>
                      
                      {/* 耗时 */}
                      <span>{formatDuration(session.duration)}</span>
                      
                      {/* 状态 */}
                      <span className={`flex items-center gap-1 ${statusInfo.color}`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {statusInfo.label}
                      </span>
                      
                      {/* 删除按钮 */}
                      <button
                        onClick={(e) => handleDeleteSession(e, session.id)}
                        className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                        title="删除此记录"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
