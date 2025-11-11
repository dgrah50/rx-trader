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
  <Tabs defaultValue="events" className="flex flex-col lg:col-span-2">
    <TabsList className="self-end">
      <TabsTrigger value="events" className="gap-1 text-xs">
        <Signal className="h-3 w-3" /> Events
      </TabsTrigger>
      <TabsTrigger value="logs" className="gap-1 text-xs">
        <Activity className="h-3 w-3" /> Logs
      </TabsTrigger>
    </TabsList>
    <TabsContent value="events" className="mt-4 flex-1">
      <Card className="h-full">
        <CardHeader>
          <CardDescription>Most recent orchestrator events</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 space-y-3 overflow-y-auto pr-2 text-xs font-mono">
            {events.map((evt) => (
              <div key={evt.id} className="rounded-lg border border-border/60 bg-background/50 p-3">
                <p className="font-semibold">{evt.type}</p>
                <p className="text-muted-foreground">{new Date(evt.ts).toLocaleString()}</p>
              </div>
            ))}
            {!events.length && <p className="text-muted-foreground">No recent events.</p>}
          </div>
        </CardContent>
      </Card>
    </TabsContent>
    <TabsContent value="logs" className="mt-4 flex-1">
      <Card className="h-full">
        <CardHeader>
          <CardDescription>Recent log entries</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 space-y-3 overflow-y-auto pr-2 text-xs">
            {logs.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border/60 bg-background/50 p-3">
                <div className="flex items-center gap-2 font-semibold">
                  <Badge variant="outline">{entry.level}</Badge>
                  <span>{entry.name}</span>
                </div>
                <p className="text-muted-foreground">{entry.msg}</p>
              </div>
            ))}
            {!logs.length && <p className="text-muted-foreground">No logs yet.</p>}
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  </Tabs>
);
