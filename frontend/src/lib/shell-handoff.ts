/**
 * 主窗 ↔ 独立窗切换时的内存交接（同进程事件，比二次 Get 更稳）。
 */
import type { ShellTab } from '@/store/shellSessionStore'

export interface ShellHandoffPayload {
  tabs: ShellTab[]
  activeTabId: string
  tabSeq: number
  snapshots: Record<string, string>
}

let handoff: ShellHandoffPayload | null = null

export function setShellHandoff(payload: ShellHandoffPayload): void {
  handoff = {
    tabs: payload.tabs.map((t) => ({ ...t })),
    activeTabId: payload.activeTabId,
    tabSeq: payload.tabSeq,
    snapshots: { ...payload.snapshots }
  }
}

/** 读取交接数据；consume=true 时读后清空 */
export function peekShellHandoff(consume = false): ShellHandoffPayload | null {
  const current = handoff
  if (consume) handoff = null
  return current
}

export const SHELL_HANDOFF_EVENT = 'shell:ui-handoff'
