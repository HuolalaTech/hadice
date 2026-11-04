import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合并 Tailwind CSS 类名
 * 使用 clsx 处理条件类名，使用 tailwind-merge 合并冲突的 Tailwind 类
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** 菜单高亮块滑动（主菜单/便捷工具共用）：快起 → 过冲少许 → 阻尼回落；暗色下 10% 主色太淡，故加深底色+内描边 */
export const NAV_HIGHLIGHT_MS = 450
export const NAV_HIGHLIGHT_EASE = 'cubic-bezier(0.22, 1.28, 0.36, 1)'
export const NAV_HIGHLIGHT_CLS = 'bg-primary/15 ring-1 ring-inset ring-primary/25 dark:bg-primary/30 dark:ring-primary/50'

