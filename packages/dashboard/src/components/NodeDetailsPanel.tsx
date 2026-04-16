import { useDashboardStore } from '../state/dashboardStore';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EventMessage } from '../types';
import { EVENT_TYPE } from '@rx-trader/core';
import type { Fill, OrderNew, OrderReject } from '@rx-trader/core/domain';

interface NodeDetailsPanelProps {
  nodeType: 'feed' | 'strategy' | 'intent' | 'risk' | 'execution';
  onClose: () => void;
}

export function NodeDetailsPanel({ nodeType, onClose }: NodeDetailsPanelProps) {
  const recentEvents = useDashboardStore((state) => state.recentEvents);

  const filteredEvents = recentEvents.filter((event: EventMessage) => {
    switch (nodeType) {
      case 'feed':
        return false;
      case 'strategy':
      case 'intent':
        return event.type === EVENT_TYPE.ORDER_NEW;
      case 'risk':
        return (
          event.type === EVENT_TYPE.RISK_CHECK ||
          (event.type === EVENT_TYPE.ORDER_REJECT &&
            (event.metadata?.risk === true ||
              (() => {
                const data = event.data as Record<string, unknown> | undefined;
                return typeof data?.reason === 'string' && data.reason.includes('risk');
              })()))
        );
      case 'execution':
        return event.type === EVENT_TYPE.ORDER_FILL || event.type === EVENT_TYPE.ORDER_REJECT;
      default:
        return false;
    }
  });

  const displayEvents = nodeType === 'risk'
    ? filteredEvents.filter((e: EventMessage) => e.type === EVENT_TYPE.RISK_CHECK || e.type === EVENT_TYPE.ORDER_REJECT)
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
  const isReject = event.type === EVENT_TYPE.ORDER_REJECT;
  const isFill = event.type === EVENT_TYPE.ORDER_FILL;
  const isRiskCheck = event.type === EVENT_TYPE.RISK_CHECK;
  
  if (isRiskCheck) {
    const data = event.data as {
      orderId: string;
      passed: boolean;
      reasons?: string[];
    } | undefined;
    if (!data) return null;
    const passed = data.passed;
    const reasons = Array.isArray(data.reasons) ? data.reasons : [];
    return (
      <div className="flex items-center justify-between p-2 rounded bg-background/50 border border-border/50 text-xs">
        <div className="flex items-center gap-2">
          <Badge variant={passed ? 'outline' : 'destructive'} className="h-5 px-1.5">
            {passed ? 'PASSED' : 'REJECTED'}
          </Badge>
          <span className="font-mono text-muted-foreground">{data.orderId.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2">
           {!passed && reasons.length > 0 && <span className="text-destructive">{reasons.join(', ')}</span>}
           <span className="text-muted-foreground text-[10px]">{format(new Date(event.ts), 'HH:mm:ss.SSS')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between p-2 rounded bg-background/50 border border-border/50 text-xs">
      <div className="flex items-center gap-2">
        <Badge 
          variant={isReject ? 'destructive' : isFill ? 'default' : 'secondary'}
          className="h-5 px-1.5"
        >
          {isReject ? 'REJECT' : isFill ? 'FILL' : event.type.split('.')[1].toUpperCase()}
        </Badge>
        <span className="font-mono text-muted-foreground">
          {getEventDisplayId(event) || event.id.slice(0, 8)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {isReject && (
          <span className="text-destructive">{getRejectMessage(event) ?? 'Unknown'}</span>
        )}
        {isFill && (
          <span className="text-green-400">
            {getFillQuantity(event)} @ {getFillPrice(event)}
          </span>
        )}
        <span className="text-muted-foreground text-[10px]">{format(new Date(event.ts), 'HH:mm:ss.SSS')}</span>
      </div>
    </div>
  );
}

const getEventData = <T extends object>(event: EventMessage): T | null =>
  event.data && typeof event.data === 'object' ? (event.data as T) : null;

const getEventDisplayId = (event: EventMessage): string | null => {
  if (event.type === EVENT_TYPE.ORDER_REJECT) {
    const data = getEventData<OrderReject>(event);
    return data?.id?.slice(0, 8) ?? null;
  }
  if (event.type === EVENT_TYPE.ORDER_FILL) {
    const data = getEventData<Fill>(event);
    return data?.orderId?.slice(0, 8) ?? null;
  }
  if (event.type === EVENT_TYPE.ORDER_NEW) {
    const data = getEventData<OrderNew>(event);
    return data?.id?.slice(0, 8) ?? null;
  }
  const data = getEventData<{ orderId?: string }>(event);
  return data?.orderId?.slice(0, 8) ?? null;
};

const getRejectMessage = (event: EventMessage): string | null => {
  const data = getEventData<OrderReject & { message?: string }>(event);
  return data?.message ?? data?.reason ?? null;
};

const getFillQuantity = (event: EventMessage): number | string | null => {
  const data = getEventData<Fill>(event);
  return data?.qty ?? null;
};

const getFillPrice = (event: EventMessage): number | string | null => {
  const data = getEventData<Fill>(event);
  return data?.px ?? null;
};
