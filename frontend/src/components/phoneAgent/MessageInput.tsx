import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Send, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePhoneAgentStore } from '@/modules/phoneAgent/store'
import { PhoneAgent } from '@/modules/phoneAgent/agent'
import { useChatHistoryStore, generateSessionTitle } from '@/modules/phoneAgent/chatHistoryStore'
import { useDeviceStore } from '@/store/deviceStore'
import { usePhoneAgentConfigStore } from '@/store/phoneAgentConfigStore'
import { toast } from 'sonner'

/**
 * 消息输入框组件
 * 支持多行输入和自适应高度
 */
export function MessageInput(): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [agent, setAgent] = useState<PhoneAgent | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const sessionStartTimeRef = useRef<number | null>(null)

  const { selectedDevice } = useDeviceStore()
  const { isRunning, sessionID, setCurrentTask, addMessage, setError, reset, messages, stepCount } =
    usePhoneAgentStore()
  const { llmConfig, maxSteps, language } = usePhoneAgentConfigStore()
  const { addSession } = useChatHistoryStore()

  // 监听消息变化，在任务完成时自动保存
  useEffect(() => {
    if (!isRunning && messages.length > 0 && sessionStartTimeRef.current !== null) {
      // 检查是否有用户消息（有用户消息才保存）
      const hasUserMessage = messages.some((msg) => msg.type === 'user')
      if (!hasUserMessage) {
        sessionStartTimeRef.current = null
        return
      }

      // 检查最后一条消息是否为已完成状态
      const lastMessage = messages[messages.length - 1]
      const isCompleted = lastMessage?.type === 'assistant' && lastMessage?.isFinished

      if (isCompleted) {
        // 计算耗时
        const duration = sessionStartTimeRef.current
          ? Math.floor((Date.now() - sessionStartTimeRef.current) / 1000)
          : 0

        // 保存会话到历史
        addSession({
          title: generateSessionTitle(messages),
          messages,
          status: 'completed',
          stepCount: stepCount,
          duration,
        })

        sessionStartTimeRef.current = null
      }
    }
  }, [isRunning, messages, stepCount, addSession])

  // 初始化Agent
  React.useEffect(() => {
    if (!selectedDevice) {
      // 如果没有设备，清理Agent和状态
      setAgent(null)
      if (sessionID) {
        reset()
      }
      return
    }

    // 创建Agent实例（使用配置store中的配置）
    const newAgent = new PhoneAgent({
      maxSteps,
      deviceID: selectedDevice.connectKey,
      platform: selectedDevice.platform,
      llmConfig,
      language,
    })

    setAgent(newAgent)

    // 如果store中有sessionID但Agent未运行，说明可能是之前的状态残留
    // 清理它，让用户重新开始
    if (sessionID && !isRunning) {
      reset()
    }

    return () => {
      if (newAgent) {
        newAgent.stop().catch(console.error)
      }
    }
  }, [selectedDevice, llmConfig, maxSteps, language, reset])

  const handleSend = useCallback(async () => {
    if (!message.trim() || isSending || !agent || !selectedDevice) {
      return
    }

    const task = message.trim()
    setMessage('')
    setIsSending(true)
    setError(null)

    // 创建AbortController用于取消任务
    abortControllerRef.current = new AbortController()

    try {
      console.log('[MessageInput] 开始执行任务:', task)

      // 记录会话开始时间
      sessionStartTimeRef.current = Date.now()

      // 如果Agent未启动，先启动
      if (!isRunning || !sessionID) {
        await agent.start()
        // 启动后获取最新的sessionID
        const currentSessionID = agent.getSessionID()
        if (!currentSessionID) {
          throw new Error('Agent启动失败：未获取到会话ID')
        }
        console.log('[MessageInput] Agent启动成功，sessionID:', currentSessionID)
      }

      // 执行任务
      setCurrentTask(task)

      // 使用Promise.race来支持取消
      const runPromise = agent.run(task)
      const abortPromise = new Promise((_, reject) => {
        abortControllerRef.current?.signal.addEventListener('abort', () => {
          reject(new Error('任务已取消'))
        })
      })

      await Promise.race([runPromise, abortPromise])
      console.log('[MessageInput] 任务执行完成')

      // 任务正常完成，保存会话
      if (sessionStartTimeRef.current) {
        const duration = Math.floor((Date.now() - sessionStartTimeRef.current) / 1000)
        addSession({
          title: generateSessionTitle(messages),
          messages,
          status: 'completed',
          stepCount,
          duration,
        })
        sessionStartTimeRef.current = null
      }
    } catch (error) {
      if (error instanceof Error && error.message === '任务已取消') {
        console.log('[MessageInput] 任务已取消')
        addMessage({
          type: 'error',
          content: '任务已取消',
        })
        toast.info('任务已取消')
      } else {
        console.error('[MessageInput] Failed to execute task:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        setError(errorMessage)
        addMessage({
          type: 'error',
          content: `执行失败: ${errorMessage}`,
        })
        toast.error('任务执行失败', {
          description: errorMessage,
        })
      }
    } finally {
      setIsSending(false)
      abortControllerRef.current = null
    }
  }, [
    message,
    isSending,
    agent,
    selectedDevice,
    isRunning,
    sessionID,
    setCurrentTask,
    setError,
    addMessage,
  ])

  const handleStop = useCallback(async () => {
    console.log('[MessageInput] 用户点击停止按钮')

    // 取消任务
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // 停止Agent
    if (agent) {
      try {
        console.log('[MessageInput] 停止Agent...')
        await agent.stop()
        console.log('[MessageInput] Agent已停止')
      } catch (error) {
        console.error('[MessageInput] 停止Agent失败:', error)
      }
    }

    // 保存被中断的会话
    if (sessionStartTimeRef.current && messages.length > 0) {
      const hasUserMessage = messages.some((msg) => msg.type === 'user')
      if (hasUserMessage) {
        const duration = Math.floor((Date.now() - sessionStartTimeRef.current) / 1000)
        addSession({
          title: generateSessionTitle(messages),
          messages,
          status: 'interrupted',
          stepCount,
          duration,
        })
      }
      sessionStartTimeRef.current = null
    }

    setIsSending(false)
    setError(null)
    toast.info('任务已停止')
  }, [agent, messages, stepCount, addSession])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!selectedDevice) {
    return (
      <div className="border-t border-border p-4">
        <div className="text-center text-sm text-muted-foreground">
          请先选择设备
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-border p-4">
      <div className="flex items-end gap-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入指令，例如：打开微信并发送消息..."
          className="flex-1 min-h-[60px] max-h-[200px] px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          rows={2}
          disabled={isSending || isRunning}
        />
        <Button
          onClick={isRunning || isSending ? handleStop : handleSend}
          disabled={!isRunning && !isSending && !message.trim()}
          className={`h-[60px] gap-2 ${
            isRunning || isSending 
              ? 'bg-destructive hover:bg-destructive/90' 
              : 'bg-orange-600 hover:bg-orange-700'
          }`}
        >
          {isRunning || isSending ? (
            <>
              <Square className="h-4 w-4" />
              <span className="hidden sm:inline">停止</span>
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">发送</span>
            </>
          )}
        </Button>
      </div>
      {(isRunning || isSending) && (
        <div className="mt-2 text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          {isRunning ? 'AI正在执行任务中...' : '正在发送...'}
        </div>
      )}
    </div>
  )
}
