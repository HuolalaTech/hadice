import type { LayoutNode } from './types'

/** 点是否在 bounds 内（含边界） */
function contains(node: LayoutNode, x: number, y: number): boolean {
  const b = node.bounds
  const w = b.right - b.left
  const h = b.bottom - b.top
  if (w <= 0 || h <= 0) return false
  return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
}

/**
 * 命中最深（最内层）控件。同层从后往前，贴近绘制叠放顺序。
 */
export function hitTestNode(root: LayoutNode | null, x: number, y: number): LayoutNode | null {
  if (!root || !contains(root, x, y)) return null

  const kids = root.children ?? []
  for (let i = kids.length - 1; i >= 0; i--) {
    const hit = hitTestNode(kids[i], x, y)
    if (hit) return hit
  }
  return root
}

/** 展开到目标节点所需的祖先 id（不含自身） */
export function ancestorIds(nodeId: string): string[] {
  const parts = nodeId.split('.')
  if (parts.length <= 1) return []
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) {
    out.push(parts.slice(0, i).join('.'))
  }
  return out
}
