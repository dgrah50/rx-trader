import { useDashboardStore } from '../state/dashboardStore';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EventMessage } from '../types';

interface NodeDetailsPanelProps {
  strategyId: string;
  nodeType: 'feed' | 'strategy' | 'intent' | 'risk' | 'execution';
  onClose: () => void;
}

export function NodeDetailsPanel({ strategyId, nodeType, onClose }: NodeDetailsPanelProps) {
  const recentEvents = useDashboardStore((state: any) => state.recentEvents as EventMessage[]);

  const filteredEvents = recentEvents.filter((event: EventMessage) => {
    // Filter by strategy ID if available in metadata (not all events have it, but order events usually do)
    // For now, we'll assume events are relevant if they match the type, as we don't strictly enforce strategyId on all events yet.
    // In a real scenario, we'd filter by strategyId.
    
    switch (nodeType) {
      case 'feed':
        // Feed events (ticks) are not usually persisted due to volume.
        // We might show feed health status here instead in the future.
        return false; 
      case 'strategy':
      case 'intent':
        return event.type === 'order.new';
      case 'risk':
        return (
          (event.type === 'order.reject' && (event.metadata?.risk === true || (event.data as any)?.reason?.includes('risk'))) ||
          event.type === 'order.new' // Show passed orders too? Maybe just rejections for "Risk Filter" focus.
        );
      case 'execution':
        return event.type === 'order.fill' || event.type === 'order.reject'; // Execution rejects
      default:
        return false;
    }
  });

  // Further filter for Risk to prioritize rejections if that's the focus, or show both.
  // Let's show Rejections primarily for Risk node as requested previously, but maybe "Passed" events are useful too.
  // For now, let's stick to the logic that was working for Risk, but expanded.
  
  const displayEvents = nodeType === 'risk' 
    ? filteredEvents.filter((e: EventMessage) => e.type === 'order.reject') // Keep it focused on rejections for now as per previous feature
    : filteredEvents;

  const getTitle = () => {
    switch (nodeType) {
      case 'feed': return 'Feed Status';
      case 'strategy': return 'Strategy Signals & Intents';
      case 'intent': return 'Generated Intents';
      case 'risk': return 'Risk Filter Decisions';
      case 'execution': return 'Execution Events';
      default: return 'Details';
    }
  };

  return (
    <Card className="h-64 border-t border-border/40 bg-card/30 backdrop-blur-sm rounded-none border-x-0 border-b-0">
      <CardHeader className="py-3 px-4 flex flex-row items-center justify-between border-b border-border/40">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {getTitle()}
          <Badge variant="outline" className="ml-2 text-xs font-normal">
            {nodeType === 'feed' ? 'Live' : `${displayEvents.length} Events`}
          </Badge>
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="p-0 h-[calc(100%-3rem)]">
        <div className="h-full overflow-y-auto custom-scrollbar p-4 space-y-2">
          {nodeType === 'feed' ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              Real-time feed events are high-frequency and not persisted in the event log.
              <br />
              Check the <strong>System Health</strong> tab for feed latency and status.
            </div>
          ) : displayEvents.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No recent events found for this stage.
            </div>
          ) : (
            displayEvents.map((event: EventMessage) => (
              <EventRow key={event.id} event={event} />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EventRow({ event }: { event: EventMessage }) {
  const isReject = event.type === 'order.reject';
  const isFill = event.type === 'order.fill';
  const isNew = event.type === 'order.new';

  return (
    <div className="flex items-start justify-between p-2 rounded bg-muted/30 border border-border/20 text-sm">
      <div className="flex flex-col gap-1 w-full">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">
            {format(new Date(event.ts), 'HH:mm:ss.SSS')}
          </span>
          <Badge 
            variant={isReject ? 'destructive' : isFill ? 'default' : 'secondary'}
            className="text-[10px] px-1.5 py-0 h-5"
          >
            {event.type}
          </Badge>
        </div>
        <div className="text-xs pl-0 mt-1">
           {renderEventDetails(event)}
        </div>
      </div>
    </div>
  );
}

function renderEventDetails(event: EventMessage) {
  const data = event.data as any;
  
  if (event.type === 'order.reject') {
    return <span className="text-red-400">{data.reason || 'Unknown reason'}</span>;
  }
  
  if (event.type === 'order.fill') {
    return (
      <span className="text-emerald-400">
        Filled {data.qty} @ {data.px} ({data.side})
      </span>
    );
  }

  if (event.type === 'order.new') {
    return (
      <span className="text-blue-300">
        {data.side} {data.qty} @ {data.px ?? 'MKT'}
      </span>
    );
  }

  return <span className="text-muted-foreground">{JSON.stringify(data)}</span>;
}
