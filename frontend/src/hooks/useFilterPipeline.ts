import { useEffect, useRef, useCallback, useState } from 'react';
import type { LogEntry } from '@/types/hdc';
import type { FilterConfig, FilterStats } from '@/workers/log-filter.worker';

interface PipelineState {
  filteredEntries: LogEntry[];
  stats: FilterStats | null;
  pending: boolean;
}

export function useFilterPipeline() {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const configRef = useRef<Partial<FilterConfig>>({});
  const [state, setState] = useState<PipelineState>({
    filteredEntries: [],
    stats: null,
    pending: false,
  });

  useEffect(() => {
    const worker = new Worker(
      new URL('@/workers/log-filter.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (e) => {
      if (e.data.type === 'filter_result') {
        // 过期请求（清空后）丢弃，避免旧快照写回列表
        if (e.data.requestId !== requestIdRef.current) return;
        setState({
          filteredEntries: e.data.entries,
          stats: e.data.stats,
          pending: false,
        });
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const updateConfig = useCallback((config: Partial<FilterConfig>) => {
    configRef.current = { ...configRef.current, ...config };
    workerRef.current?.postMessage({ type: 'updateConfig', config });
  }, []);

  const filterEntries = useCallback(
    (entries: LogEntry[]) => {
      if (!workerRef.current) {
        return;
      }
      const requestId = ++requestIdRef.current;
      setState((prev) => ({ ...prev, pending: true }));
      workerRef.current.postMessage({
        type: 'filter',
        entries,
        config: configRef.current,
        requestId,
      });
    },
    []
  );

  /** 同步清空列表快照（作废进行中的 Worker 结果） */
  const clearFiltered = useCallback(() => {
    requestIdRef.current += 1;
    setState({
      filteredEntries: [],
      stats: null,
      pending: false,
    });
  }, []);

  return {
    filteredEntries: state.filteredEntries,
    stats: state.stats,
    pending: state.pending,
    updateConfig,
    filterEntries,
    clearFiltered,
  };
}
