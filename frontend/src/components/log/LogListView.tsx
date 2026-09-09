import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { LogEntry } from '@/types/hdc';
import type { FilterStats } from '@/workers/log-filter.worker';
import { useLogViewStore } from '@/store/logViewStore';
import { Checkbox } from '@/components/ui/checkbox';

// ── Types ────────────────────────────────────────────────────────────────────

interface LogListViewProps {
  entries: LogEntry[];
  platform: 'harmonyos' | 'android';
  autoScroll: boolean;
  stats?: FilterStats | null;
}

type SortColumn = 'time' | 'level' | 'pid' | 'tag' | 'message';
type SortDirection = 'asc' | 'desc';

interface ContextMenuState {
  x: number;
  y: number;
  index: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const LEVEL_COLORS: Record<string, string> = {
  F: 'text-purple-400',
  E: 'text-red-400',
  W: 'text-yellow-400',
  I: 'text-blue-400',
  D: 'text-gray-400',
  V: 'text-gray-500',
};

const SORT_ICONS: Record<string, { asc: string; desc: string }> = {
  time: { asc: '▲', desc: '▼' },
  level: { asc: '▲', desc: '▼' },
  pid: { asc: '▲', desc: '▼' },
  tag: { asc: '▲', desc: '▼' },
  message: { asc: '▲', desc: '▼' },
};

const NEUTRAL_SORT_ICON = '⇅';

// ── Helpers ──────────────────────────────────────────────────────────────────

function isDuplicateMerged(message: string): boolean {
  return /×\d+\)$/.test(message);
}

// ── Component ────────────────────────────────────────────────────────────────

export const LogListView: React.FC<LogListViewProps> = React.memo(
  ({ entries, platform, autoScroll, stats }) => {
    const [sortColumn, setSortColumn] = useState<SortColumn>('time');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [showPid, setShowPid] = useState(false);
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const addSuppressionRule = useLogViewStore((s) => s.addSuppressionRule);

    // ── Sorted entries ─────────────────────────────────────────────────────

    const sortedEntries = useMemo(() => {
      if (entries.length === 0) return [];
      const sorted = [...entries];
      sorted.sort((a, b) => {
        let cmp = 0;
        switch (sortColumn) {
          case 'time':
            cmp = a.timestamp - b.timestamp;
            break;
          case 'level': {
            const order = ['V', 'D', 'I', 'W', 'E', 'F'];
            cmp = order.indexOf(a.level) - order.indexOf(b.level);
            break;
          }
          case 'pid':
            cmp = a.pid - b.pid;
            break;
          case 'tag':
            cmp = a.tag.localeCompare(b.tag);
            break;
          case 'message':
            cmp = a.message.localeCompare(b.message);
            break;
        }
        return sortDirection === 'asc' ? cmp : -cmp;
      });
      return sorted;
    }, [entries, sortColumn, sortDirection]);

    // ── Auto-scroll to bottom in list mode ─────────────────────────────────

    useEffect(() => {
      if (!autoScroll || !scrollRef.current) return;
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [sortedEntries.length, autoScroll]);
    // ── Virtualizer ────────────────────────────────────────────────────────

    const virtualizer = useVirtualizer({
      count: sortedEntries.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => 32,
      getItemKey: (index) => `${sortedEntries[index]?.timestamp ?? 0}-${index}`,
      overscan: 15,
    });

    // ── Dismiss context menu on outside click ──────────────────────────────

    useEffect(() => {
      if (!contextMenu) return;
      const handler = (e: MouseEvent) => {
        setContextMenu(null);
      };
      // Delay to avoid the same right-click event closing the menu
      const timer = setTimeout(() => {
        document.addEventListener('click', handler, { once: true });
      }, 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('click', handler);
      };
    }, [contextMenu]);

    // Dismiss on Escape
    useEffect(() => {
      if (!contextMenu) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setContextMenu(null);
      };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }, [contextMenu]);

    // ── Sort handler ───────────────────────────────────────────────────────

    const handleSort = useCallback((column: SortColumn) => {
      setSortColumn((prev) => {
        if (prev === column) {
          setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
          return prev;
        }
        setSortDirection('asc');
        return column;
      });
    }, []);

    // ── Row click & multi-select ───────────────────────────────────────────

    const handleRowClick = useCallback(
      (index: number, e: React.MouseEvent) => {
        if (e.metaKey || e.ctrlKey) {
          setSelectedIndices((prev) => {
            const next = new Set(prev);
            if (next.has(index)) {
              next.delete(index);
            } else {
              next.add(index);
            }
            return next;
          });
        } else if (e.shiftKey) {
          setSelectedIndices((prev) => {
            if (prev.size === 0) return new Set([index]);
            const allIndices = Array.from(prev);
            const minSelected = Math.min(...allIndices);
            const maxSelected = Math.max(...allIndices);
            const min = Math.min(minSelected, index);
            const max = Math.max(maxSelected, index);
            const next = new Set<number>();
            for (let i = min; i <= max; i++) next.add(i);
            return next;
          });
        } else {
          setSelectedIndices(new Set([index]));
        }
      },
      [],
    );

    // ── Context menu ───────────────────────────────────────────────────────

    const handleContextMenu = useCallback(
      (index: number, e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, index });
        // Select the right-clicked row if not already selected
        if (!selectedIndices.has(index)) {
          setSelectedIndices(new Set([index]));
        }
      },
      [selectedIndices],
    );

    const handleCopyRow = useCallback(() => {
      if (contextMenu === null) return;
      const entry = sortedEntries[contextMenu.index];
      if (entry) {
        navigator.clipboard.writeText(entry.raw).catch(() => {});
      }
      setContextMenu(null);
    }, [contextMenu, sortedEntries]);

    const handleCopyField = useCallback(
      (field: keyof LogEntry) => {
        if (contextMenu === null) return;
        const entry = sortedEntries[contextMenu.index];
        if (entry) {
          const value = String(entry[field] ?? '');
          navigator.clipboard.writeText(value).catch(() => {});
        }
        setContextMenu(null);
      },
      [contextMenu, sortedEntries],
    );

    const handleSuppressTag = useCallback(() => {
      if (contextMenu === null) return;
      const entry = sortedEntries[contextMenu.index];
      if (entry) {
        addSuppressionRule(platform, {
          id: `suppress-${entry.tag}-${Date.now()}`,
          tag: entry.tag,
          enabled: true,
        });
      }
      setContextMenu(null);
    }, [contextMenu, sortedEntries, platform, addSuppressionRule]);

    // ── Sort indicator ─────────────────────────────────────────────────────

    const sortIndicator = (column: SortColumn): string => {
      if (sortColumn !== column) return NEUTRAL_SORT_ICON;
      return SORT_ICONS[column]?.[sortDirection] ?? NEUTRAL_SORT_ICON;
    };

    // ── Derive suppressed count from stats ────────────────────────────────

    const suppressedCount = stats?.stageStats?.suppressionFilter?.removed ?? 0;
    const mergedCount = stats?.stageStats?.dedupFilter?.removed ?? 0;

    // ── Render ─────────────────────────────────────────────────────────────

    return (
      <div className="flex flex-col h-full bg-gray-950 text-gray-200 select-none">
        {/* ── Header Row ────────────────────────────────────────────────── */}
        <div className="flex items-center border-b border-gray-800 px-2 py-1 text-xs font-medium text-gray-500 bg-gray-900 shrink-0">
          {/* Time header */}
          <div
            className="w-[120px] cursor-pointer hover:text-gray-200 shrink-0 select-none"
            onClick={() => handleSort('time')}
          >
            Time{' '}
            <span className="inline-block w-3 text-center">
              {sortIndicator('time')}
            </span>
          </div>

          {/* Level header */}
          <div
            className="w-[50px] cursor-pointer hover:text-gray-200 shrink-0 select-none"
            onClick={() => handleSort('level')}
          >
            Lvl{' '}
            <span className="inline-block w-3 text-center">
              {sortIndicator('level')}
            </span>
          </div>

          {/* PID header (conditional) */}
          {showPid && (
            <div
              className="w-[70px] cursor-pointer hover:text-gray-200 shrink-0 select-none"
              onClick={() => handleSort('pid')}
            >
              PID{' '}
              <span className="inline-block w-3 text-center">
                {sortIndicator('pid')}
              </span>
            </div>
          )}

          {/* Tag header */}
          <div
            className="w-[150px] cursor-pointer hover:text-gray-200 shrink-0 select-none"
            onClick={() => handleSort('tag')}
          >
            Tag{' '}
            <span className="inline-block w-3 text-center">
              {sortIndicator('tag')}
            </span>
          </div>

          {/* Message header */}
          <div
            className="flex-1 cursor-pointer hover:text-gray-200 min-w-0 select-none"
            onClick={() => handleSort('message')}
          >
            Message{' '}
            <span className="inline-block w-3 text-center">
              {sortIndicator('message')}
            </span>
          </div>

          {/* PID toggle */}
          <div className="flex items-center gap-1 ml-2 shrink-0">
            <Checkbox
              checked={showPid}
              onCheckedChange={(checked) => setShowPid(!!checked)}
              id="log-list-show-pid"
              className="h-3.5 w-3.5"
            />
            <label
              htmlFor="log-list-show-pid"
              className="cursor-pointer text-gray-500 hover:text-gray-300 text-xs select-none"
            >
              PID
            </label>
          </div>
        </div>

        {/* ── Virtual Scroll Body ────────────────────────────────────────── */}
        <div ref={scrollRef} className="flex-1 overflow-auto">
          {sortedEntries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              No log entries
            </div>
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const entry = sortedEntries[virtualItem.index];
                if (!entry) return null;

                const isSelected = selectedIndices.has(virtualItem.index);
                const dupMerged = isDuplicateMerged(entry.message);

                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: virtualItem.size,
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                    className={[
                      'flex items-center px-2 text-xs border-b border-gray-800/50 cursor-pointer',
                      isSelected
                        ? 'bg-blue-900/30'
                        : 'hover:bg-gray-800/30',
                    ].join(' ')}
                    onClick={(e) => handleRowClick(virtualItem.index, e)}
                    onContextMenu={(e) =>
                      handleContextMenu(virtualItem.index, e)
                    }
                  >
                    {/* Time cell */}
                    <div className="w-[120px] shrink-0 text-gray-400 font-mono truncate pr-1">
                      {entry.time}
                    </div>

                    {/* Level cell */}
                    <div
                      className={[
                        'w-[50px] shrink-0 font-mono font-bold',
                        LEVEL_COLORS[entry.level] || 'text-gray-400',
                      ].join(' ')}
                    >
                      {entry.level}
                    </div>

                    {/* PID cell (conditional) */}
                    {showPid && (
                      <div className="w-[70px] shrink-0 text-gray-500 font-mono truncate pr-1">
                        {entry.pid}
                      </div>
                    )}

                    {/* Tag cell */}
                    <div className="w-[150px] shrink-0 text-cyan-400 font-mono truncate pr-1">
                      {entry.tag}
                    </div>

                    {/* Message cell */}
                    <div
                      className={[
                        'flex-1 min-w-0 truncate font-mono',
                        dupMerged ? 'text-orange-400' : 'text-gray-300',
                      ].join(' ')}
                    >
                      {entry.message}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Status Bar ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-3 py-1 border-t border-gray-800 bg-gray-900 text-xs text-gray-500 shrink-0">
          <span>{sortedEntries.length.toLocaleString()} entries</span>
          <span className="flex items-center gap-3">
            {suppressedCount > 0 && (
              <span className="text-yellow-500">
                {suppressedCount.toLocaleString()} suppressed
              </span>
            )}
            {mergedCount > 0 && (
              <span className="text-orange-400">
                {mergedCount.toLocaleString()} merged
              </span>
            )}
          </span>
        </div>

        {/* ── Context Menu ────────────────────────────────────────────────── */}
        {contextMenu && (() => {
          const contextEntry = sortedEntries[contextMenu.index];
          return (
            <div
              className="fixed z-50 bg-gray-800 border border-gray-700 rounded shadow-xl py-1 min-w-[170px] text-xs"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <div
                className="px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-gray-300"
                onClick={handleCopyRow}
              >
                Copy Row
              </div>
              <div className="border-t border-gray-700 my-0.5" />
              <div
                className="px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-gray-300"
                onClick={() => handleCopyField('time')}
              >
                Copy Time
              </div>
              <div
                className="px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-gray-300"
                onClick={() => handleCopyField('level')}
              >
                Copy Level
              </div>
              <div
                className="px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-gray-300"
                onClick={() => handleCopyField('tag')}
              >
                Copy Tag
              </div>
              <div
                className="px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-gray-300"
                onClick={() => handleCopyField('message')}
              >
                Copy Message
              </div>
              {showPid && (
                <div
                  className="px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-gray-300"
                  onClick={() => handleCopyField('pid')}
                >
                  Copy PID
                </div>
              )}
              {contextEntry && (
                <>
                  <div className="border-t border-gray-700 my-0.5" />
                  <div
                    className="px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-yellow-400"
                    onClick={handleSuppressTag}
                  >
                    Suppress Tag: {contextEntry.tag}
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>
    );
  },
);

LogListView.displayName = 'LogListView';
