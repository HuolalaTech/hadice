import React from 'react';
import { Terminal, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLogViewStore } from '@/store/logViewStore';

export const LogViewToggle: React.FC = () => {
  const viewMode = useLogViewStore((s) => s.viewMode);
  const toggleViewMode = useLogViewStore((s) => s.toggleViewMode);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggleViewMode}
      className="gap-2"
      title={viewMode === 'terminal' ? '切换到列表视图' : '切换到终端视图'}
    >
      {viewMode === 'terminal' ? (
        <>
          <List className="h-4 w-4" />
          列表
        </>
      ) : (
        <>
          <Terminal className="h-4 w-4" />
          终端
        </>
      )}
    </Button>
  );
};
