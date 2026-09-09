import React from 'react'
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  X
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { formatFileSize, formatDateTime } from '@/lib/format'
import { isHdcAvailable } from '@/lib/hdc'
import type { TransferTask } from '@/types/hdc'

/**
 * 传输队列组件
 */
export function TransferQueue({
  tasks,
  scrollAreaRef,
  onRemoveTask
}: {
  tasks: TransferTask[]
  scrollAreaRef: React.RefObject<HTMLDivElement | null>
  onRemoveTask: (taskId: string) => void
}): React.JSX.Element {
  if (tasks.length === 0) {
    return <></>
  }

  return (
    <Card className="mt-4 h-[25%] flex flex-col min-h-0">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-base">传输队列</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="space-y-1.5 pr-4">
            {tasks.map((task) => {
              return (
                <div
                  key={task.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/30 hover:bg-secondary/40 transition-colors"
                >
                  {/* 圆形图标 - 箭头方向 */}
                  <div className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-background border border-border">
                    {task.direction === 'push' ? (
                      <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  
                  {/* 路径信息 */}
                  <div className="flex-1 min-w-0">
                    {/* 源路径 */}
                    <div className="text-xs text-muted-foreground break-words leading-tight">
                      {task.sourcePath}
                    </div>
                    {/* 目标路径 - 如果是拉取操作，显示为超链接 */}
                    {task.direction === 'pull' ? (
                      <button
                        onClick={() => {
                          if (isHdcAvailable()) {
                            window.hdc.openFileInSystem(task.targetPath)
                          }
                        }}
                        className="text-xs font-medium break-words mt-0.5 leading-tight text-blue-500 hover:text-blue-600 hover:underline text-left"
                      >
                        {task.targetPath}
                      </button>
                    ) : (
                      <div className="text-xs font-medium break-words mt-0.5 leading-tight">
                        {task.targetPath}
                      </div>
                    )}
                    
                    {/* 进度条 */}
                    {task.status === 'transferring' && (
                      <Progress value={task.progress} className="mt-1.5 h-0.5" />
                    )}
                    
                    {/* 错误信息 */}
                    {task.error && (
                      <div className="text-xs text-destructive mt-1 break-words leading-tight">
                        {task.error}
                      </div>
                    )}
                  </div>
                  
                  {/* 右侧信息：时间、大小、状态、删除按钮 */}
                  <div className="flex-shrink-0 flex items-center gap-3">
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTime(task.createdAt)}
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatFileSize(task.totalSize)}
                    </div>
                    {/* 状态图标 */}
                    {task.status === 'completed' && (
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                    )}
                    {task.status === 'failed' && (
                      <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                    )}
                    {task.status === 'transferring' && (
                      <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />
                    )}
                    {task.status === 'pending' && (
                      <div className="h-4 w-4 rounded-full bg-muted-foreground/20 flex-shrink-0" />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => onRemoveTask(task.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

