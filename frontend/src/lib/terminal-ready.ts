/** 容器是否已有可给 xterm open/fit 的尺寸（独立窗首帧常为 0）。 */
export function isTerminalHostReady(
  el: { clientWidth: number; clientHeight: number } | null | undefined
): boolean {
  return !!el && el.clientWidth > 0 && el.clientHeight > 0
}
