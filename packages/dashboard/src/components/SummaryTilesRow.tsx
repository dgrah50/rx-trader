import { SummaryTile } from './primitives/SummaryTile';

interface SummaryTilesRowProps {
  nav: string;
  realized: string;
  unrealized: string;
  eventsPerMinute: string;
}

export const SummaryTilesRow = ({ nav, realized, unrealized, eventsPerMinute }: SummaryTilesRowProps) => (
  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
    <SummaryTile label="NAV" value={`$${nav}`} hint="Mark-to-market" />
    <SummaryTile label="Realized" value={`$${realized}`} />
    <SummaryTile label="Unrealized" value={`$${unrealized}`} />
    <SummaryTile label="Events/min" value={eventsPerMinute} hint="Rolling 60s window" />
  </div>
);
