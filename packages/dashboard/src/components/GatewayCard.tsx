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
  <Card className="lg:col-span-2">
    <CardHeader className="flex flex-row items-center justify-between">
      <div>
        <CardDescription>Gateway</CardDescription>
        <CardTitle className="text-2xl">{gatewayUrl}</CardTitle>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" className="gap-1" onClick={onOpenControl}>
          <Link2 className="h-4 w-4" /> Open
        </Button>
        <Button variant="outline" size="sm" className="gap-1" onClick={onOpenMetrics}>
          <BarChart3 className="h-4 w-4" /> Metrics
        </Button>
      </div>
    </CardHeader>
    <CardContent className="flex flex-col gap-3 sm:flex-row">
      <Input value={gatewayUrl} onChange={(evt) => onGatewayChange(evt.target.value)} placeholder="http://localhost:8080" />
      <Button variant="ghost" className="sm:w-48" onClick={onCopy}>
        Copy URL
      </Button>
    </CardContent>
  </Card>
);
