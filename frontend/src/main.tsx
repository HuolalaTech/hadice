import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { hdcAPI } from './lib/hdc-api'
import { initConsoleBridge } from './lib/console-bridge'
import { initPostHog } from './lib/posthog'

// 初始化 PostHog（未配置 VITE_POSTHOG_KEY 则跳过）
initPostHog().catch(console.error)

// 初始化 Console 日志桥接（将前端日志转发到 Go 后端）
if (typeof window !== 'undefined') {
  initConsoleBridge()
}

// 初始化真实的 HDC API（使用 Wails 后端）
if (typeof window !== 'undefined') {
  window.hdc = hdcAPI
  console.log('[HDC API] Real HDC API initialized (using Wails backend)')
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
