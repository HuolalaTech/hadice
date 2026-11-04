import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ancestorIds } from './hitTest'
import type { LayoutNode } from './types'

interface LayoutTreeProps {
  root: LayoutNode | null
  selectedId: string | null
  onSelect: (node: LayoutNode) => void
  filter: string
  /** 递增 → 全部展开 */
  expandSignal?: number
  /** 递增 → 全部折叠（仅保留根） */
  collapseSignal?: number
  /** 截图点选：展开祖先并滚到该节点；seq 变化即触发 */
  reveal?: { id: string; seq: number } | null
}

function nodeLabel(n: LayoutNode): string {
  const shortType = n.type?.includes('.') ? n.type.split('.').pop()! : n.type
  const bits = [shortType]
  if (n.text) bits.push(`"${n.text.slice(0, 24)}"`)
  else if (n.resourceId) bits.push(n.resourceId.split('/').pop() || n.resourceId)
  else if (n.desc) bits.push(n.desc.slice(0, 24))
  return bits.join(' ')
}

function matchFilter(n: LayoutNode, term: string): boolean {
  if (!term) return true
  const t = term.toLowerCase()
  return (
    n.type?.toLowerCase().includes(t) ||
    n.text?.toLowerCase().includes(t) ||
    n.resourceId?.toLowerCase().includes(t) ||
    n.desc?.toLowerCase().includes(t) ||
    (n.children ?? []).some((c) => matchFilter(c, term))
  )
}

function collectExpandableIds(node: LayoutNode | null, out: Set<string>, maxDepth?: number, depth = 0): void {
  if (!node) return
  const kids = node.children ?? []
  if (kids.length > 0) {
    if (maxDepth === undefined || depth < maxDepth) out.add(node.id)
    for (const c of kids) collectExpandableIds(c, out, maxDepth, depth + 1)
  }
}

function TreeNodeView({
  node,
  depth,
  selectedId,
  onSelect,
  filter,
  expandedIds,
  toggle
}: {
  node: LayoutNode
  depth: number
  selectedId: string | null
  onSelect: (n: LayoutNode) => void
  filter: string
  expandedIds: Set<string>
  toggle: (id: string) => void
}): React.JSX.Element | null {
  const kids = node.children ?? []
  if (!matchFilter(node, filter)) return null

  const expanded = expandedIds.has(node.id) || !!filter

  return (
    <div>
      <button
        type="button"
        data-layout-node={node.id}
        className={cn(
          'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/80',
          selectedId === node.id && 'bg-primary/15 text-primary'
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={() => onSelect(node)}
      >
        {kids.length > 0 ? (
          <span
            className="shrink-0 text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation()
              if (!filter) toggle(node.id)
            }}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        ) : (
          <span className="inline-block w-3" />
        )}
        <span className="truncate font-mono">{nodeLabel(node)}</span>
      </button>
      {expanded &&
        kids.map((c) => (
          <TreeNodeView
            key={c.id}
            node={c}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            filter={filter}
            expandedIds={expandedIds}
            toggle={toggle}
          />
        ))}
    </div>
  )
}

export function LayoutTree({
  root,
  selectedId,
  onSelect,
  filter,
  expandSignal = 0,
  collapseSignal = 0,
  reveal = null
}: LayoutTreeProps): React.JSX.Element {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const rootRef = useRef(root)
  rootRef.current = root

  // 新树：默认展开前两层
  useEffect(() => {
    const next = new Set<string>()
    collectExpandableIds(root, next, 2)
    setExpandedIds(next)
  }, [root])

  useEffect(() => {
    if (!expandSignal) return
    const next = new Set<string>()
    collectExpandableIds(rootRef.current, next)
    setExpandedIds(next)
  }, [expandSignal])

  useEffect(() => {
    if (!collapseSignal) return
    setExpandedIds(new Set())
  }, [collapseSignal])

  // 截图点选 → 展开路径并滚入视口
  useEffect(() => {
    if (!reveal?.id || !reveal.seq) return
    const id = reveal.id
    setExpandedIds((prev) => {
      const next = new Set(prev)
      for (const a of ancestorIds(id)) next.add(a)
      return next
    })
    // 等展开渲染后再滚
    const t = window.setTimeout(() => {
      const el = document.querySelector(`[data-layout-node="${CSS.escape(id)}"]`)
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 40)
    return () => window.clearTimeout(t)
  }, [reveal?.id, reveal?.seq])

  const toggle = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const empty = useMemo(() => !root, [root])
  if (empty) {
    return <div className="p-4 text-sm text-muted-foreground">暂无布局树，请先抓取</div>
  }

  return (
    <div className="p-2">
      <TreeNodeView
        node={root!}
        depth={0}
        selectedId={selectedId}
        onSelect={onSelect}
        filter={filter}
        expandedIds={expandedIds}
        toggle={toggle}
      />
    </div>
  )
}
