import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link2, BarChart3 } from 'lucide-react';

interface GatewayCardProps {
  gatewayUrl: string;
  onGatewayChange: (value: string) => void;
  onCopy: () => void;
  onOpenControl: () => void;
  onOpenMetrics: () => void;
}

export const GatewayCard = ({
  gatewayUrl,
  onGatewayChange,
  onCopy,
  onOpenControl,
  onOpenMetrics
}: GatewayCardProps) => (
  <Card className="flex flex-col border-0 shadow-none bg-transparent">
    <div className="flex items-center justify-between px-1 pb-2 border-b border-border/40 mb-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gateway</span>
    </div>
    <div className="space-y-2 px-1">
      <div className="flex gap-1">
        <Input 
          value={gatewayUrl} 
          onChange={(evt) => onGatewayChange(evt.target.value)} 
          placeholder="http://localhost:8080" 
          className="h-6 text-xs font-mono bg-background/50 border-border/50"
        />
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] uppercase tracking-wider" onClick={onCopy}>
          Copy
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Button variant="secondary" size="sm" className="h-6 text-[10px] uppercase tracking-wider" onClick={onOpenControl}>
          Control
        </Button>
        <Button variant="outline" size="sm" className="h-6 text-[10px] uppercase tracking-wider" onClick={onOpenMetrics}>
          Metrics
        </Button>
      </div>
    </div>
  </Card>
);
