import React, { useState } from 'react';
import { Plus, Trash2, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLogViewStore } from '@/store/logViewStore';
import type { LogLevel } from '@/types/hdc';

interface SuppressionRuleManagerProps {
  platform: 'harmonyos' | 'android';
}

const LOG_LEVELS: LogLevel[] = ['D', 'I', 'W', 'E', 'F'];

export const SuppressionRuleManager: React.FC<SuppressionRuleManagerProps> = ({ platform }) => {
  const rules = useLogViewStore((s) =>
    platform === 'android' ? s.logcatSuppressionRules : s.hilogSuppressionRules
  );
  const addRule = useLogViewStore((s) => s.addSuppressionRule);
  const removeRule = useLogViewStore((s) => s.removeSuppressionRule);
  const toggleRule = useLogViewStore((s) => s.toggleSuppressionRule);

  const [newTag, setNewTag] = useState('');
  const [newLevel, setNewLevel] = useState<LogLevel | ''>('');
  const [isOpen, setIsOpen] = useState(false);

  const handleAdd = () => {
    if (!newTag.trim()) return;
    addRule(platform, {
      id: `rule-${Date.now()}`,
      tag: newTag.trim(),
      level: newLevel || undefined,
      enabled: true,
    });
    setNewTag('');
    setNewLevel('');
  };

  const activeCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="relative">
      <Button variant="outline" size="sm" className="gap-1" onClick={() => setIsOpen(!isOpen)}>
        <Shield className="h-4 w-4" />
        屏蔽规则
        {activeCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-xs">
            {activeCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-background border rounded-md shadow-md p-3 min-w-[320px]">
            <div className="flex items-center gap-2 mb-3">
              <Input
                placeholder="Tag 名称"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                className="flex-1 h-8 text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
              <select
                value={newLevel}
                onChange={(e) => setNewLevel(e.target.value as LogLevel | '')}
                className="h-8 px-2 border rounded text-sm bg-background"
              >
                <option value="">所有级别</option>
                {LOG_LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <Button size="sm" onClick={handleAdd} disabled={!newTag.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {rules.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                暂无屏蔽规则
              </div>
            ) : (
              <div className="space-y-1 max-h-[200px] overflow-auto">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => toggleRule(platform, rule.id)}
                    />
                    <span className="flex-1 font-mono">{rule.tag}</span>
                    {rule.level && (
                      <span className="text-xs text-muted-foreground">Lvl: {rule.level}</span>
                    )}
                    <button
                      onClick={() => removeRule(platform, rule.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
