import type {
  DomainEvent,
  Fill,
  OrderNew,
  PortfolioAnalytics,
  PortfolioSnapshot,
} from '@rx-trader/core/domain';
import { hashCanonical, sha256Hex } from '@rx-trader/core/integrity';
import { pnlProjection, positionsProjection } from '@rx-trader/event-store';
import type {
  BacktestArtifact,
  BacktestIntegrityCheck,
  BacktestIntegrityReport,
  BacktestStats,
} from './types';

interface VerifyBacktestIntegrityOptions {
  ticks: unknown[];
  config: unknown;
  events: DomainEvent[];
  positions: ReturnType<typeof positionsProjection.init>;
  pnl: ReturnType<typeof pnlProjection.init>;
  eventCounts: BacktestStats['eventCounts'];
}

type FillLedgerData = {
  delta: number;
  metadata?: {
    direction?: string;
    fillId?: string;
  };
  reason?: string;
};

const approximatelyEqual = (left: number, right: number, epsilon = 1e-8): boolean =>
  Math.abs(left - right) <= epsilon * Math.max(1, Math.abs(left), Math.abs(right));

const duplicateCount = (values: string[]): number => values.length - new Set(values).size;

const countEventTypes = (events: DomainEvent[]): BacktestStats['eventCounts'] => {
  const counts: BacktestStats['eventCounts'] = {
    orderNew: 0,
    orderAck: 0,
    orderReject: 0,
    orderFill: 0,
    pnlAnalytics: 0,
    portfolioSnapshots: 0,
  };
  events.forEach((event) => {
    if (event.type === 'order.new') counts.orderNew += 1;
    else if (event.type === 'order.ack') counts.orderAck += 1;
    else if (event.type === 'order.reject') counts.orderReject += 1;
    else if (event.type === 'order.fill') counts.orderFill += 1;
    else if (event.type === 'pnl.analytics') counts.pnlAnalytics += 1;
    else if (event.type === 'portfolio.snapshot') counts.portfolioSnapshots += 1;
  });
  return counts;
};

const eventChainHash = (events: DomainEvent[]): string =>
  events.reduce((previous, event) => sha256Hex(`${previous}:${hashCanonical(event)}`), sha256Hex(''));

const replayState = (events: DomainEvent[]) => ({
  positions: events.reduce(positionsProjection.reduce, positionsProjection.init()),
  pnl: events.reduce(pnlProjection.reduce, pnlProjection.init()),
});

export const verifyBacktestIntegrity = (
  options: VerifyBacktestIntegrityOptions,
): BacktestIntegrityReport => {
  const checks: BacktestIntegrityCheck[] = [];
  const addCheck = (name: string, passed: boolean, details: string) => {
    checks.push({ name, passed, details });
  };

  const eventIds = options.events.map((event) => event.id);
  const dedupeKeys = options.events.flatMap((event) =>
    event.dedupeKey === undefined ? [] : [event.dedupeKey],
  );
  addCheck(
    'unique-event-ids',
    duplicateCount(eventIds) === 0,
    `${duplicateCount(eventIds)} duplicate event IDs`,
  );
  addCheck(
    'unique-economic-keys',
    duplicateCount(dedupeKeys) === 0,
    `${duplicateCount(dedupeKeys)} duplicate economic keys`,
  );

  const fillEvents = options.events.filter((event) => event.type === 'order.fill');
  const fills = fillEvents.map((event) => event.data as Fill);
  const fillIdentities = fillEvents.map(
    (event) => event.dedupeKey ?? `fill:${(event.data as Fill).venueTradeId ?? (event.data as Fill).id}`,
  );
  addCheck(
    'unique-fills',
    duplicateCount(fillIdentities) === 0,
    `${duplicateCount(fillIdentities)} duplicate economic fills`,
  );

  const orders = new Map(
    options.events
      .filter((event) => event.type === 'order.new')
      .map((event) => {
        const order = event.data as OrderNew;
        return [order.id, order] as const;
      }),
  );
  const fillQtyByOrder = new Map<string, number>();
  fills.forEach((fill) => {
    fillQtyByOrder.set(fill.orderId, (fillQtyByOrder.get(fill.orderId) ?? 0) + fill.qty);
  });
  const overfilled = [...fillQtyByOrder].filter(([orderId, qty]) => {
    const order = orders.get(orderId);
    return !order || qty > order.qty + 1e-10;
  });
  addCheck('no-overfills', overfilled.length === 0, `${overfilled.length} missing or overfilled orders`);

  const ledgerEvents = options.events.filter((event) => {
    if (event.type !== 'account.balance.adjusted') return false;
    return (event.data as FillLedgerData).reason === 'fill';
  });
  const ledgerByFill = new Map<string, FillLedgerData[]>();
  ledgerEvents.forEach((event) => {
    const data = event.data as FillLedgerData;
    const fillId = data.metadata?.fillId;
    if (!fillId) return;
    const entries = ledgerByFill.get(fillId) ?? [];
    entries.push(data);
    ledgerByFill.set(fillId, entries);
  });
  const invalidLedgerFills = fills.filter((fill) => {
    const entries = ledgerByFill.get(fill.id) ?? [];
    if (entries.length !== 2) return true;
    const baseDirection = fill.side === 'BUY' ? 'BASE_CREDIT' : 'BASE_DEBIT';
    const quoteDirection = fill.side === 'BUY' ? 'QUOTE_DEBIT' : 'QUOTE_CREDIT';
    const base = entries.find((entry) => entry.metadata?.direction === baseDirection);
    const quote = entries.find((entry) => entry.metadata?.direction === quoteDirection);
    if (!base || !quote) return true;
    const expectedBase = fill.side === 'BUY' ? fill.qty : -fill.qty;
    const grossQuote = fill.qty * fill.px;
    const expectedQuote =
      fill.side === 'BUY' ? -grossQuote - (fill.fee ?? 0) : grossQuote - (fill.fee ?? 0);
    return !approximatelyEqual(base.delta, expectedBase) || !approximatelyEqual(quote.delta, expectedQuote);
  });
  const fillIds = new Set(fills.map((fill) => fill.id));
  const orphanLedgerEntries = ledgerEvents.filter((event) => {
    const fillId = (event.data as FillLedgerData).metadata?.fillId;
    return !fillId || !fillIds.has(fillId);
  });
  addCheck(
    'fill-ledger-balanced',
    invalidLedgerFills.length === 0 && orphanLedgerEntries.length === 0,
    `${invalidLedgerFills.length} fills with invalid ledger legs; ${orphanLedgerEntries.length} orphan legs`,
  );

  const snapshots = options.events
    .filter((event) => event.type === 'portfolio.snapshot')
    .map((event) => event.data as PortfolioSnapshot);
  const analytics = options.events
    .filter((event) => event.type === 'pnl.analytics')
    .map((event) => event.data as PortfolioAnalytics);
  const lastSnapshot = snapshots.at(-1);
  const lastAnalytics = analytics.at(-1);
  const portfolioMatches =
    lastSnapshot !== undefined &&
    lastAnalytics !== undefined &&
    approximatelyEqual(lastSnapshot.nav, lastAnalytics.nav) &&
    approximatelyEqual(lastSnapshot.pnl, lastAnalytics.pnl) &&
    approximatelyEqual(lastSnapshot.cash, lastAnalytics.cash) &&
    approximatelyEqual(lastSnapshot.feesPaid, lastAnalytics.feesPaid);
  addCheck('portfolio-analytics-reconcile', portfolioMatches, 'latest snapshot and analytics agree');

  const actualCounts = countEventTypes(options.events);
  const countsMatch = hashCanonical(actualCounts) === hashCanonical(options.eventCounts);
  addCheck('event-counts-reconcile', countsMatch, 'reported event counts match the event stream');

  const replayed = replayState(options.events);
  const expectedStateHash = hashCanonical({ positions: options.positions, pnl: options.pnl });
  const replayStateHash = hashCanonical(replayed);
  addCheck(
    'deterministic-replay',
    expectedStateHash === replayStateHash,
    'replayed projections match the reported final state',
  );

  return {
    version: 1,
    status: checks.every((check) => check.passed) ? 'verified' : 'failed',
    fingerprints: {
      datasetSha256: hashCanonical(options.ticks),
      configSha256: hashCanonical(options.config),
      eventsSha256: hashCanonical(options.events),
      eventChainSha256: eventChainHash(options.events),
      stateSha256: expectedStateHash,
      replayStateSha256: replayStateHash,
    },
    counts: {
      events: options.events.length,
      uniqueEventIds: new Set(eventIds).size,
      dedupeKeys: new Set(dedupeKeys).size,
      fills: fills.length,
      uniqueFills: new Set(fillIdentities).size,
      fillLedgerEntries: ledgerEvents.length,
    },
    checks,
  };
};

export const verifyArtifactProof = (artifact: BacktestArtifact): string[] => {
  const failures: string[] = [];
  if (!artifact || !artifact.integrity || !Array.isArray(artifact.events)) {
    return ['artifact is missing its integrity proof or event stream'];
  }
  if (artifact.integrity.status !== 'verified') failures.push('integrity status is not verified');
  if (artifact.integrity.checks.some((check) => !check.passed)) {
    failures.push('integrity report contains failed checks');
  }
  const requiredHashes = [
    artifact.integrity.fingerprints.datasetSha256,
    artifact.integrity.fingerprints.configSha256,
    artifact.integrity.fingerprints.eventsSha256,
    artifact.integrity.fingerprints.eventChainSha256,
    artifact.integrity.fingerprints.stateSha256,
    artifact.integrity.fingerprints.replayStateSha256,
    artifact.integrity.fingerprints.codeSha256,
  ];
  if (requiredHashes.some((hash) => !hash || !/^[a-f0-9]{64}$/.test(hash))) {
    failures.push('one or more required SHA-256 fingerprints are missing');
  }
  if (!artifact.integrity.fingerprints.codeCommit) failures.push('code commit is missing');
  if (hashCanonical(artifact.events) !== artifact.integrity.fingerprints.eventsSha256) {
    failures.push('event fingerprint mismatch');
  }
  if (eventChainHash(artifact.events) !== artifact.integrity.fingerprints.eventChainSha256) {
    failures.push('event chain mismatch');
  }
  const stateHash = hashCanonical({ positions: artifact.positions, pnl: artifact.pnl });
  if (stateHash !== artifact.integrity.fingerprints.stateSha256) {
    failures.push('state fingerprint mismatch');
  }
  if (
    artifact.integrity.fingerprints.stateSha256 !==
    artifact.integrity.fingerprints.replayStateSha256
  ) {
    failures.push('replay state fingerprint mismatch');
  }
  if (artifact.integrity.counts.events !== artifact.events.length) {
    failures.push('event count mismatch');
  }
  return failures;
};
