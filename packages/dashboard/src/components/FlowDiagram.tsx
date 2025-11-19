import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  Background,
  Controls,
  Handle,
  Position,
  NodeProps,
  Edge,
  Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { StrategyRuntimeStatus, StrategyMetrics } from '../types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Custom Node Components
const FlowNode = ({ data }: NodeProps) => {
  const { label, icon, status = 'neutral', metrics } = data as any;
  
  const statusColors = {
    neutral: 'border-border bg-card',
    success: 'border-green-500/50 bg-green-500/10',
    warning: 'border-yellow-500/50 bg-yellow-500/10',
    error: 'border-red-500/50 bg-red-500/10',
  };

  return (
    <div className={cn(
      "px-4 py-3 rounded-lg border shadow-sm min-w-[150px]",
      statusColors[status as keyof typeof statusColors]
    )}>
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2 mb-2">
        {icon && <span className="text-lg">{icon}</span>}
        <span className="font-medium text-sm">{label}</span>
      </div>
      {metrics && (
        <div className="space-y-1">
          {Object.entries(metrics).map(([key, value]) => (
            <div key={key} className="flex justify-between text-xs text-muted-foreground">
              <span className="capitalize">{key}:</span>
              <span className="font-mono text-foreground">{String(value)}</span>
            </div>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    </div>
  );
};

const nodeTypes = {
  custom: FlowNode,
};

interface FlowDiagramProps {
  strategy: StrategyRuntimeStatus;
  onNodeClick?: (nodeId: string) => void;
}

export const FlowDiagram: React.FC<FlowDiagramProps> = ({ strategy, onNodeClick }) => {
  const metrics = strategy.metrics || {
    signals: 0,
    intents: 0,
    orders: 0,
    fills: 0,
    rejects: 0,
  } as StrategyMetrics;

  const initialNodes: Node[] = useMemo(() => {
    const feedNodes: Node[] = [];
    const feedEdges: Edge[] = [];
    
    // Primary Feed
    feedNodes.push({
      id: 'feed-primary',
      type: 'custom',
      position: { x: 0, y: 50 },
      data: { 
        label: 'Primary Feed', 
        icon: '📡',
        status: 'success',
        metrics: { source: strategy.primaryFeed }
      },
    });
    feedEdges.push({ id: 'e-feed-primary-strategy', source: 'feed-primary', target: 'strategy', animated: true });

    // Extra Feeds
    strategy.extraFeeds.forEach((feed, index) => {
      const feedId = `feed-extra-${index}`;
      feedNodes.push({
        id: feedId,
        type: 'custom',
        position: { x: 0, y: 150 + (index * 100) },
        data: { 
          label: 'Extra Feed', 
          icon: '📡',
          status: 'success',
          metrics: { source: feed }
        },
      });
      feedEdges.push({ id: `e-${feedId}-strategy`, source: feedId, target: 'strategy', animated: true });
    });

    const pipelineNodes: Node[] = [
      {
        id: 'strategy',
        type: 'custom',
        position: { x: 250, y: 100 },
        data: { 
          label: 'Strategy', 
          icon: '🧠',
          status: metrics.signals > 0 ? 'success' : 'neutral',
          metrics: { signals: metrics.signals }
        },
      },
      {
        id: 'intent',
        type: 'custom',
        position: { x: 450, y: 100 },
        data: { 
          label: 'Intent', 
          icon: '🎯',
          status: metrics.intents > 0 ? 'success' : 'neutral',
          metrics: { intents: metrics.intents }
        },
      },
      {
        id: 'risk',
        type: 'custom',
        position: { x: 650, y: 100 },
        data: { 
          label: 'Risk Filter', 
          icon: '🛡️',
          status: metrics.rejects > 0 ? 'warning' : 'success',
          metrics: { 
            passed: metrics.orders,
            rejected: metrics.rejects 
          }
        },
      },
      {
        id: 'execution',
        type: 'custom',
        position: { x: 850, y: 100 },
        data: { 
          label: 'Execution', 
          icon: '⚡',
          status: metrics.fills > 0 ? 'success' : 'neutral',
          metrics: { 
            orders: metrics.orders,
            fills: metrics.fills 
          }
        },
      },
    ];

    return [...feedNodes, ...pipelineNodes];
  }, [strategy, metrics]);

  const initialEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [
      { id: 'e-strategy-intent', source: 'strategy', target: 'intent', animated: true },
      { id: 'e-intent-risk', source: 'intent', target: 'risk', animated: true },
      { id: 'e-risk-execution', source: 'risk', target: 'execution', animated: true },
    ];

    // Add feed edges
    edges.push({ id: 'e-feed-primary-strategy', source: 'feed-primary', target: 'strategy', animated: true });
    strategy.extraFeeds.forEach((_, index) => {
      edges.push({ id: `e-feed-extra-${index}-strategy`, source: `feed-extra-${index}`, target: 'strategy', animated: true });
    });

    return edges;
  }, [strategy]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes when strategy/metrics change
  React.useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  return (
    <div className="h-[300px] w-full bg-background/50 rounded-lg border border-border/50 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onNodeClick?.(node.id)}
        fitView
        attributionPosition="bottom-right"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#333" gap={16} size={1} />
        <Controls className="!bg-card !border-border !fill-foreground" />
      </ReactFlow>
    </div>
  );
};
