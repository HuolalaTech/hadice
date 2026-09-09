import React, { useEffect, useRef } from 'react'
import { usePhoneAgentStore } from '@/modules/phoneAgent/store'
import type { ExecutionStep } from '@/modules/phoneAgent/types'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { Bot, User, AlertCircle, Loader2, CheckCircle2, Brain, Zap } from 'lucide-react'

/**
 * 消息列表组件
 * 每个AI步骤显示为一个独立的卡片
 */
export function MessageList(): React.JSX.Element {
  const messages = usePhoneAgentStore((state) => state.messages)
  const viewportRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground text-sm">
          <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>暂无消息</p>
          <p className="mt-2">输入指令开始AI自动化任务</p>
        </div>
      </div>
    )
  }

  return (
    <ScrollAreaPrimitive.Root className="relative overflow-hidden h-full">
      <ScrollAreaPrimitive.Viewport ref={viewportRef} className="h-full w-full rounded-[inherit]">
        <div className="p-4 space-y-3">
          {messages.map((message) => {
            // 用户消息
            if (message.type === 'user') {
              return (
                <div key={message.id} className="flex gap-3 justify-end">
                  <div className="flex-1 max-w-[85%] rounded-lg p-4 bg-primary text-primary-foreground">
                    <div className="flex items-center gap-2 mb-2">
                      <User className="h-4 w-4" />
                      <span className="text-xs font-medium">任务指令</span>
                    </div>
                    <div className="text-sm">{message.content}</div>
                  </div>
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center mt-0.5">
                    <User className="h-4 w-4 text-primary-foreground" />
                  </div>
                </div>
              )
            }

            // 错误消息
            if (message.type === 'error') {
              return (
                <div key={message.id} className="flex gap-3 justify-start">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center mt-0.5">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  </div>
                  <div className="flex-1 max-w-[85%] rounded-lg p-4 bg-destructive/10 text-destructive border border-destructive/20">
                    <div className="text-sm">{message.content}</div>
                  </div>
                </div>
              )
            }

            // AI消息 - 将thinking和action合并为一个卡片
            if (message.type === 'assistant' && message.steps) {
              // 将步骤按对分组（thinking + action为一个步骤对）
              type StepPair = {
                thinking: ExecutionStep | null
                action: ExecutionStep | null
                stepNumber: number
                lastTimestamp: number
              }
              
              const stepPairs: StepPair[] = []
              let currentThinking: ExecutionStep | null = null
              let stepIndex = 0

              for (const step of message.steps) {
                if (step.type === 'thinking') {
                  currentThinking = step
                } else if (step.type === 'action' && currentThinking) {
                  stepPairs.push({
                    thinking: currentThinking,
                    action: step,
                    stepNumber: ++stepIndex,
                    lastTimestamp: Math.max(currentThinking.timestamp, step.timestamp)
                  })
                  currentThinking = null
                }
              }

              // 如果有剩余的thinking（没有对应的action），也渲染它
              if (currentThinking) {
                stepPairs.push({
                  thinking: currentThinking,
                  action: null,
                  stepNumber: ++stepIndex,
                  lastTimestamp: currentThinking.timestamp
                })
              }

              return stepPairs.map((pair, index) => {
                const stepId = pair.action?.id || pair.thinking?.id || `step_${index}`

                return (
                  <div key={stepId} className="flex gap-3 justify-start">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>

                    <div className="flex-1 max-w-[85%] rounded-lg p-3 bg-muted/60 border border-border">
                      {/* 头部：步骤数 + 时间 */}
                      <div className="flex items-center justify-between mb-2 pb-1">
                        <span className="text-xs font-medium text-primary">{pair.stepNumber}/{message.maxSteps}</span>
                        <span className="text-xs text-muted-foreground">{new Date(pair.lastTimestamp).toLocaleTimeString()}</span>
                      </div>

                      {/* Thinking部分 */}
                      {pair.thinking && (
                        <div className="bg-background/50 rounded border border-border/40 p-2 mb-2">
                          <div className="flex items-center gap-2 mb-1">
                            <Brain className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="text-xs font-medium text-foreground/90">AI思考过程</span>
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto bg-muted/20 rounded p-2 font-mono leading-relaxed">
                            {pair.thinking.content}
                          </div>
                        </div>
                      )}

                      {/* Action部分 */}
                      {pair.action && (
                        <div className="bg-background/50 rounded border border-border/40 p-2">
                          <div className="flex items-center gap-2 mb-1">
                            <Zap className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="text-xs font-medium text-foreground/90">{pair.action.actionSummary || '执行动作'}</span>
                          </div>
                          {pair.action.result && (
                            <div className="text-xs text-muted-foreground/80 flex items-start gap-2">
                              <span className="text-xs text-muted-foreground">执行结果：</span>
                              <span className="text-green-600 dark:text-green-400 font-medium">{pair.action.result}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 最后一个卡片显示任务完成提示 */}
                      {index === stepPairs.length - 1 && message.isFinished && (
                        <div className="flex items-center gap-2 text-sm mt-3">
                          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                          <span className="font-medium text-foreground">任务已完成</span>
                        </div>
                      )}

                      {/* 最后一个卡片显示流式加载指示 */}
                      {index === stepPairs.length - 1 && message.isStreaming && !message.content && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-3">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          正在执行...
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            }

            return null
          })}
        </div>
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex touch-none select-none transition-colors h-full w-2.5 border-l border-l-transparent p-[1px]">
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
