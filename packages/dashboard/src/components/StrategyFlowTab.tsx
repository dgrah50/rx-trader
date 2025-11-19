import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FlowDiagram } from './FlowDiagram';
import { NodeDetailsPanel } from './NodeDetailsPanel';
import { useStrategySelection } from '../hooks/useStrategySelection';

import type { StrategyRuntimeStatus } from '../types';

interface StrategyFlowTabProps {
  strategies: StrategyRuntimeStatus[];
}

export function StrategyFlowTab({ strategies: rawStrategies }: StrategyFlowTabProps) {
  const { selectedStrategyId, rows: strategies, setSelectedStrategyId: selectStrategy, selectedStrategy } = useStrategySelection(rawStrategies, { defaultToFirst: true });
  const [selectedNode, setSelectedNode] = useState<'feed' | 'strategy' | 'intent' | 'risk' | 'execution' | null>(null);

  const handleNodeClick = (nodeId: string) => {
    if (nodeId.includes('feed')) setSelectedNode('feed');
    else if (nodeId === 'strategy') setSelectedNode('strategy');
    else if (nodeId === 'intent') setSelectedNode('intent');
    else if (nodeId === 'risk') setSelectedNode('risk');
    else if (nodeId === 'execution') setSelectedNode('execution');
    else setSelectedNode(null);
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Strategy Flow Analysis</h2>
        <Select value={selectedStrategyId} onValueChange={selectStrategy}>
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Select strategy" />
          </SelectTrigger>
          <SelectContent>
            {strategies.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.id} - {s.tradeSymbol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="flex-1 border-border/40 bg-card/30 backdrop-blur-sm overflow-hidden flex flex-col">
        <CardHeader className="py-3 px-4 border-b border-border/40">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Tick-to-Trade Pipeline: {selectedStrategy?.tradeSymbol ?? 'Select Strategy'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 flex-1 relative">
          {selectedStrategy && (
            <FlowDiagram 
              strategy={selectedStrategy} 
              onNodeClick={handleNodeClick}
            />
          )}
        </CardContent>
      </Card>

      {selectedNode && selectedStrategyId && (
        <div className="animate-in slide-in-from-bottom-10 duration-300">
          <NodeDetailsPanel 
            strategyId={selectedStrategyId} 
            nodeType={selectedNode}
            onClose={() => setSelectedNode(null)} 
          />
        </div>
      )}
    </div>
  );
};
