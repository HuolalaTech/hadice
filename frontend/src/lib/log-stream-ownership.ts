/**
 * 系统日志流是否应在页面卸载时停止后端。
 *
 * 开独立窗时：主窗会先 setPanelOpen 再卸掉 SystemLogsPage；
 * 若卸载仍 StopHilogStream，异步 stop 常落在独立窗 Start 之后，把新流杀掉 → 独立窗空白。
 * 独立窗自己卸掉时也不停（交还给主窗 startStream 会 stop+start）。
 */
export function shouldStopLogStreamOnUnmount(opts: {
  standalone: boolean
  panelOpenForLogs: boolean
}): boolean {
  if (opts.standalone) return false
  if (opts.panelOpenForLogs) return false
  return true
}
