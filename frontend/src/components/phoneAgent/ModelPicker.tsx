import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModelPickerProps {
  value: string
  models: string[]
  onChange: (model: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  placement?: 'up' | 'down'
}

export function ModelPicker({
  value,
  models,
  onChange,
  disabled,
  placeholder = '搜索或选择模型',
  className,
  placement = 'up'
}: ModelPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return models
    return models.filter((item) => item.toLowerCase().includes(q))
  }, [models, query])

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])

  const commit = (model: string) => {
    const next = model.trim()
    if (!next) return
    onChange(next)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cn('truncate', !value && 'text-muted-foreground')}>
          {value || placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-50 w-full min-w-[240px] overflow-hidden rounded-md border border-border bg-popover shadow-md',
            placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
          )}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(filtered[0] || query)
              }
              if (e.key === 'Escape') {
                setOpen(false)
                setQuery('')
              }
            }}
            placeholder="搜索模型，回车确认"
            className="h-8 w-full border-b border-border bg-transparent px-2 text-xs outline-none"
          />
          <div className="max-h-56 overflow-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                {query.trim() ? `回车使用 “${query.trim()}”` : '先测试连接拉取模型'}
              </div>
            ) : (
              filtered.map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => commit(model)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent"
                >
                  <Check
                    className={cn(
                      'h-3 w-3 shrink-0',
                      model === value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="truncate">{model}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
