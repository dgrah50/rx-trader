#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import type { ServerWebSocket } from 'bun';

export interface TickPayload {
  raw: string;
}

export interface MockFeedServerOptions {
  port: number;
  payloads: TickPayload[];
  loop?: boolean;
  paceMicros?: number; // delay between payloads
  batchSize?: number;
  onSend?: (info: { idx: number; timestamp: bigint }) => void;
  onComplete?: () => void;
}

interface StreamState {
  idx: number;
  timer?: ReturnType<typeof setTimeout>;
}

export const startMockFeedServer = (options: MockFeedServerOptions) => {
  const paceMicros = options.paceMicros ?? 0;
  const batchSize = Math.max(1, options.batchSize ?? 100);
  const connections = new Set<ServerWebSocket<unknown>>();
  const streamState = new WeakMap<ServerWebSocket<unknown>, StreamState>();
  let completed = false;

  type ServeOptions = Parameters<typeof Bun.serve>[0];
  const serverOptions: ServeOptions = {
    port: options.port,
    idleTimeout: 0,
    fetch(req, server) {
      if (server.upgrade(req, { data: undefined as unknown })) {
        return new Response(null, { status: 101 });
      }
      return new Response('WebSocket feed only', { status: 400 });
    },
    websocket: {
      open(ws) {
        connections.add(ws);
        streamState.set(ws, { idx: 0 });
        stream(ws);
      },
      close(ws) {
        stopStream(ws);
        connections.delete(ws);
      },
      message() {}
    }
  };
  const server = (Bun.serve as (opts: ServeOptions) => ReturnType<typeof Bun.serve>)(serverOptions);

  const stopStream = (ws: ServerWebSocket<unknown>) => {
    const state = streamState.get(ws);
    if (state?.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
  };

  const stream = (ws: ServerWebSocket<unknown>) => {
    const state = streamState.get(ws);
    if (!state) return;
    const sendBatch = () => {
      if (ws.readyState !== WebSocket.OPEN) {
        stopStream(ws);
        return;
      }
      let sent = 0;
      while (sent < batchSize) {
        if (state.idx >= options.payloads.length) {
          if (options.loop) {
            state.idx = 0;
          } else {
            if (!completed) {
              completed = true;
              options.onComplete?.();
            }
            ws.close();
            return;
          }
        }
        const currentIdx = state.idx++;
        ws.send(options.payloads[currentIdx]!.raw);
        options.onSend?.({ idx: currentIdx, timestamp: process.hrtime.bigint() });
        sent += 1;
        if (paceMicros > 0) {
          break;
        }
      }
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }
      if (paceMicros > 0) {
        state.timer = setTimeout(sendBatch, paceMicros / 1000);
      } else if (state.idx < options.payloads.length || options.loop) {
        state.timer = setTimeout(sendBatch, 0);
      }
    };
    sendBatch();
  };

  const stop = () => {
    for (const ws of connections) {
      ws.close();
    }
    void server.stop();
  };

  return { stop, port: server.port };
};

const loadPayloadsFromFile = (file: string): TickPayload[] => {
  const contents = readFileSync(file, 'utf8');
  const lines = contents.split(/\r?\n/).filter(Boolean);
  return lines.map((line) => ({ raw: line.trim() }));
};

const generatePayloads = (symbol: string, count: number): TickPayload[] => {
  const payloads: TickPayload[] = new Array(count);
  const segment = 64;
  for (let i = 0; i < count; i++) {
    const cycle = Math.floor(i / segment);
    const position = i % segment;
    const direction = cycle % 2 === 0 ? 1 : -1;
    const base = 100 + cycle * 0.05;
    const price = base + direction * position * 0.08;
    const payload = {
      E: Date.now() + i,
      s: symbol.toUpperCase(),
      b: (price - 0.05).toFixed(2),
      B: '1.0',
      a: (price + 0.05).toFixed(2),
      A: '1.0',
      c: price.toFixed(2)
    };
    payloads[i] = { raw: JSON.stringify(payload) };
  }
  return payloads;
};

if (import.meta.main) {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .map((arg) => arg.replace(/^--/, '').split('='))
      .map(([key, value]) => [key, value ?? 'true'])
  );
  const port = Number(args.port ?? 9001);
  const ticks = Number(args.ticks ?? 50_000);
  const symbol = (args.symbol ?? 'BTCUSDT').toUpperCase();
  const loop = args.loop === 'true';
  const paceMicros = args.pace ? Number(args.pace) : 0;
  const payloads = args.file ? loadPayloadsFromFile(args.file) : generatePayloads(symbol, ticks);
  const server = startMockFeedServer({ port, payloads, loop, paceMicros });
  console.log(`Mock feed server listening on ws://localhost:${server.port}`);
  process.on('SIGINT', () => {
    server.stop();
    process.exit(0);
  });
}
