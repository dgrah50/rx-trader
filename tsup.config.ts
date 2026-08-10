import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    control: 'packages/control-plane/src/index.ts',
  },
  format: ['esm'],
  sourcemap: true,
  splitting: true,
  clean: true,
  target: 'es2022',
  external: ['bun:sqlite'],
  tsconfig: 'tsconfig.base.json',
});
