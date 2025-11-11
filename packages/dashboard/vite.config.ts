import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';

const gatewayTarget = process.env.VITE_GATEWAY_PROXY ?? 'http://localhost:8080';

const proxiedPaths = [
  '/events',
  '/logs',
  '/pnl',
  '/positions',
  '/metrics',
  '/backtest',
  '/feeds',
  '/snapshot',
  '/config',
];

const proxy = proxiedPaths.reduce<
  Record<string, { target: string; changeOrigin: boolean; ws?: boolean }>
>((acc, path) => {
  acc[path] = {
    target: gatewayTarget,
    changeOrigin: true,
    ws: path === '/events' || path === '/logs',
  };
  return acc;
}, {});

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
