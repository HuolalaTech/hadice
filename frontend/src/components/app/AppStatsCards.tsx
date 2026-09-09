import React from 'react'
import { Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AppStats, AppFilterType } from '@/types/hdc'

/**
 * 统计卡片组件
 */
export function AppStatsCards({
  stats,
  filter,
  onFilterChange
}: {
  stats: AppStats
  filter: AppFilterType
  onFilterChange: (filter: AppFilterType) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 ml-auto">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onFilterChange('all')}
        className={`gap-2 ${filter === 'all' ? 'ring-2 ring-primary' : ''}`}
      >
        <Package className="h-4 w-4 text-foreground" />
        <span className="text-xs text-muted-foreground">全部</span>
        <span className="font-mono font-bold">{stats.total}</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onFilterChange('system')}
        className={`gap-2 ${filter === 'system' ? 'ring-2 ring-primary' : ''}`}
      >
        <Package className="h-4 w-4 text-blue-500" />
        <span className="text-xs text-muted-foreground">系统</span>
        <span className="font-mono font-bold">{stats.system}</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onFilterChange('thirdParty')}
        className={`gap-2 ${filter === 'thirdParty' ? 'ring-2 ring-primary' : ''}`}
      >
        <Package className="h-4 w-4 text-green-500" />
        <span className="text-xs text-muted-foreground">第三方</span>
        <span className="font-mono font-bold">{stats.thirdParty}</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onFilterChange('running')}
        className={`gap-2 ${filter === 'running' ? 'ring-2 ring-primary' : ''}`}
      >
        <Package className="h-4 w-4 text-yellow-500" />
        <span className="text-xs text-muted-foreground">运行中</span>
        <span className="font-mono font-bold">{stats.running}</span>
      </Button>
    </div>
  )
}

