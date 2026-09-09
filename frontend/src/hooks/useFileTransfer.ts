import { useState, useCallback, useRef, useEffect } from 'react'
import { isHdcAvailable } from '@/lib/hdc'
import type { TransferTask } from '@/types/hdc'
import type { HdcDevice, Platform } from '@/types/hdc'

/**
 * 文件传输管理 Hook
 */
export function useFileTransfer(selectedDevice: HdcDevice | null, platform: Platform | string) {
  const [transferTasks, setTransferTasks] = useState<TransferTask[]>([])
  const taskIdCounter = useRef(0)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (transferTasks.length > 0 && scrollAreaRef.current) {
      setTimeout(() => {
        const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight
        }
      }, 100)
    }
  }, [transferTasks.length])

  const startTransfer = useCallback(async (
    task: TransferTask,
    onComplete?: (targetDir: string, isDevice: boolean) => void
  ) => {
    if (!selectedDevice || !isHdcAvailable()) {
      setTransferTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: 'failed',
                error: '设备未连接或 HDC API 不可用'
              }
            : t
        )
      )
      return
    }

    setTransferTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: 'transferring', progress: 0 } : t))
    )

    try {
      let result
      if (task.direction === 'push') {
        result = await window.hdc.pushFileToDevice(
          selectedDevice.connectKey,
          task.sourcePath,
          task.targetPath,
          platform
        )
      } else {
        result = await window.hdc.pullFileFromDevice(
          selectedDevice.connectKey,
          task.sourcePath,
          task.targetPath,
          platform
        )
      }

      // HDC 成功格式: "FileTransfer finish"
      // ADB 成功格式: "1 file pushed" 或 "1 file pulled"
      const isHdcSuccess = result.output && result.output.includes('FileTransfer finish')
      const isAdbSuccess = result.output && (result.output.includes('file pushed') || result.output.includes('file pulled'))
      const isSuccess = result.success && (isHdcSuccess || isAdbSuccess)
      
      setTransferTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: isSuccess ? 'completed' : 'failed',
                progress: isSuccess ? 100 : t.progress,
                error: isSuccess ? undefined : result.error || result.output || '传输失败'
              }
            : t
        )
      )
      
      if (isSuccess && onComplete) {
        if (task.direction === 'push') {
          const targetDir = task.targetPath.substring(0, task.targetPath.lastIndexOf('/')) || '/'
          onComplete(targetDir, true)
        } else {
          const lastSlash = Math.max(task.targetPath.lastIndexOf('/'), task.targetPath.lastIndexOf('\\'))
          const targetDir = lastSlash > 0 ? task.targetPath.substring(0, lastSlash) : '/'
          onComplete(targetDir, false)
        }
      }
    } catch (error) {
      console.error('[useFileTransfer] Transfer error:', error)
      setTransferTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: 'failed',
                error: error instanceof Error ? error.message : '传输失败'
              }
            : t
        )
      )
    }
  }, [selectedDevice, platform])

  const addTransferTask = useCallback(
    (
      sourcePath: string,
      targetPath: string,
      direction: 'push' | 'pull',
      name: string,
      isDirectory: boolean,
      totalSize: number,
      onComplete?: (targetDir: string, isDevice: boolean) => void
    ) => {
      const task: TransferTask = {
        id: `task-${++taskIdCounter.current}`,
        sourcePath,
        targetPath,
        direction,
        name,
        isDirectory,
        totalSize,
        transferredSize: 0,
        progress: 0,
        status: 'pending',
        createdAt: Date.now()
      }

      setTransferTasks((prev) => [...prev, task])

      startTransfer(task, onComplete)
    },
    [startTransfer]
  )

  const removeTask = useCallback((taskId: string) => {
    setTransferTasks((prev) => prev.filter((t) => t.id !== taskId))
  }, [])

  return {
    transferTasks,
    scrollAreaRef,
    addTransferTask,
    removeTask
  }
}