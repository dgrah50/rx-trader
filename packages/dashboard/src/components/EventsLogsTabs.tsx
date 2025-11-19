import { Activity, Signal } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { EventMessage, LogEntry } from '../types';

interface EventsLogsTabsProps {
  events: EventMessage[];
  logs: LogEntry[];
}

export const EventsLogsTabs = ({ events, logs }: EventsLogsTabsProps) => (
  <Tabs defaultValue="events" className="flex flex-col h-full">
    <div className="flex items-center justify-between px-1 pb-2 border-b border-border/40 mb-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">System</span>
      <TabsList className="h-6 p-0 bg-transparent gap-2">
        <TabsTrigger 
          value="events" 
          className="h-5 px-2 text-[10px] data-[state=active]:bg-secondary data-[state=active]:text-secondary-foreground rounded-sm border border-transparent data-[state=active]:border-border/50"
        >
          Events
        </TabsTrigger>
        <TabsTrigger 
          value="logs" 
          className="h-5 px-2 text-[10px] data-[state=active]:bg-secondary data-[state=active]:text-secondary-foreground rounded-sm border border-transparent data-[state=active]:border-border/50"
        >
          Logs
        </TabsTrigger>
      </TabsList>
    </div>

    <div className="flex-1 overflow-hidden min-h-0 relative">
      <TabsContent value="events" className="absolute inset-0 mt-0 overflow-y-auto pr-1 space-y-1">
        {events.map((evt) => (
          <div key={evt.id} className="flex flex-col px-2 py-1.5 rounded-sm border border-border/30 bg-card/30 hover:bg-card/50 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-foreground">{evt.type}</span>
              <span className="text-[9px] text-muted-foreground font-mono">{new Date(evt.ts).toLocaleTimeString()}</span>
            </div>
          </div>
        ))}
        {!events.length && <div className="text-[10px] text-muted-foreground p-2 text-center">No recent events.</div>}
      </TabsContent>
      
      <TabsContent value="logs" className="absolute inset-0 mt-0 overflow-y-auto pr-1 space-y-1">
        {logs.map((entry) => (
          <div key={entry.id} className="flex flex-col px-2 py-1.5 rounded-sm border border-border/30 bg-card/30 hover:bg-card/50 transition-colors">
            <div className="flex items-center gap-2 mb-0.5">
              <Badge variant="outline" className="h-3.5 px-1 text-[9px] font-normal uppercase">{entry.level}</Badge>
              <span className="text-[10px] font-mono text-muted-foreground">{entry.name}</span>
            </div>
            <p className="text-[10px] text-foreground/90 break-all leading-tight">{entry.msg}</p>
          </div>
        ))}
        {!logs.length && <div className="text-[10px] text-muted-foreground p-2 text-center">No logs yet.</div>}
      </TabsContent>
    </div>
  </Tabs>
);
