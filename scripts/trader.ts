#!/usr/bin/env bun
import { startEngine } from '@rx-trader/control-plane';

const main = async () => {
  const live = process.argv.includes('--live');
  await startEngine({ live });
};

void main();
