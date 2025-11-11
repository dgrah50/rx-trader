import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface SummaryTileProps {
  label: string;
  value: string;
  hint?: string;
}

export const SummaryTile = ({ label, value, hint }: SummaryTileProps) => (
  <Card>
    <CardHeader className="pb-2">
      <CardDescription className="uppercase tracking-[0.3em] text-xs text-muted-foreground">
        {label}
      </CardDescription>
      <CardTitle className="text-3xl font-semibold text-foreground">{value}</CardTitle>
    </CardHeader>
    {hint ? <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent> : null}
  </Card>
);
