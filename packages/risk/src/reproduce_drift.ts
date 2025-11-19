
import { createPreTradeRisk, type RiskLimits } from './preTrade';
import { systemClock } from '@rx-trader/core/time';
import type { OrderNew } from '@rx-trader/core/domain';

const run = () => {
  const limits: RiskLimits = {
    notional: 10000,
    maxPosition: 2,
    priceBands: {},
    throttle: { windowMs: 1000, maxCount: 100 }
  };

  const risk = createPreTradeRisk(limits);

  const order1: OrderNew = {
    id: '1',
    t: 1000,
    symbol: 'BTC-USD',
    side: 'BUY',
    qty: 1.0,
    type: 'MKT',
    tif: 'IOC',
    account: 'test'
  };

  console.log('--- Order 1: BUY 1.0 BTC ---');
  const d1 = risk.check(order1);
  console.log('Allowed:', d1.allowed, 'Reasons:', d1.reasons);
  console.log('Exposures (internal):', (risk as any).exposures ?? 'hidden');

  const order2: OrderNew = {
    id: '2',
    t: 1001,
    symbol: 'BTC-USD',
    side: 'BUY',
    qty: 1.0,
    type: 'MKT',
    tif: 'IOC',
    account: 'test'
  };

  console.log('\n--- Order 2: BUY 1.0 BTC (Should be allowed, total 2.0) ---');
  const d2 = risk.check(order2);
  console.log('Allowed:', d2.allowed, 'Reasons:', d2.reasons);

  const order3: OrderNew = {
    id: '3',
    t: 1002,
    symbol: 'BTC-USD',
    side: 'BUY',
    qty: 1.0,
    type: 'MKT',
    tif: 'IOC',
    account: 'test'
  };

  console.log('\n--- Order 3: BUY 1.0 BTC (Should be REJECTED, total would be 3.0 > 2.0) ---');
  const d3 = risk.check(order3);
  console.log('Allowed:', d3.allowed, 'Reasons:', d3.reasons);

  console.log('\n--- SIMULATING REJECTION OF ORDER 2 ---');
  console.log('Calling revert(order2)...');
  risk.revert(order2);

  const order4: OrderNew = {
    id: '4',
    t: 1003,
    symbol: 'BTC-USD',
    side: 'BUY',
    qty: 1.0,
    type: 'MKT',
    tif: 'IOC',
    account: 'test'
  };

  console.log('\n--- Order 4: BUY 1.0 BTC (Should be ALLOWED now, total 2.0) ---');
  const d4 = risk.check(order4);
  console.log('Order 4 allowed (after rejects):', d4.allowed); // Should be false, but we WANT it to be true if we could revert.

  if (!d4.allowed) {
    console.log('FAIL: Risk engine drifted. It thinks position is full but orders were rejected.');
  }
};

run();
