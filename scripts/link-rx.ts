#!/usr/bin/env bun
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const bunHome = process.env.BUN_INSTALL || path.join(homedir(), '.bun');
const binDir = path.join(bunHome, 'bin');
const isWindows = process.platform === 'win32';

const ensureDir = () => {
  try {
    mkdirSync(binDir, { recursive: true });
  } catch {
    // ignore
  }
};

const quote = (value: string) => value.replace(/"/g, '\\"');

const install = () => {
  ensureDir();
  const shimPath = path.join(binDir, isWindows ? 'rx.cmd' : 'rx');
  const normalizedRoot = path.resolve(repoRoot);
  if (isWindows) {
    const script = `@echo off\ncd /d "${normalizedRoot}" && bun run scripts/cli.ts %*\n`;
    writeFileSync(shimPath, script, 'utf8');
  } else {
    const script = `#!/usr/bin/env bash\ncd "${quote(normalizedRoot)}" || exit 1\nbun run scripts/cli.ts "$@"\n`;
    writeFileSync(shimPath, script, { mode: 0o755 });
    chmodSync(shimPath, 0o755);
  }
  console.log(`[setup] Installed rx shim at ${shimPath}`);
};

try {
  install();
} catch (error) {
  console.warn('[setup] Failed to install rx shim:', (error as Error).message);
}
