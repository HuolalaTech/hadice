import React from 'react'
import { TaskBar } from './TaskBar'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'

/**
 * 聊天面板组件
 * 包含任务栏、消息列表和输入框
 */
export function ChatPanel(): React.JSX.Element {
  return (
    <div className="h-full flex flex-col">
      {/* 任务栏 */}
      <TaskBar />

      {/* 消息列表 */}
      <div className="flex-1 overflow-auto">
        <MessageList />
      </div>

      {/* 输入框 */}
      <MessageInput />
    </div>
  )
}
