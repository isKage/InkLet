#!/usr/bin/env node
/**
 * Regenerates every app-icon asset from `scripts/assets/mark.svg`.
 *
 * The SVG is the only thing to edit: it draws the mark as paths (no font), so the
 * result is the same on any machine. Tauri's own `icon` command turns that one
 * file into the .icns, .ico and the window/start-menu PNGs.
 *
 * Usage: node scripts/assets/make-icon.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const source = join(here, 'mark.svg');
const output = join(root, 'apps/desktop/src-tauri/icons');

if (!existsSync(source)) {
  console.error(`missing ${source}`);
  process.exit(1);
}

// `tauri icon` is invoked through the app's own CLI so the version matches the
// one the bundle is built with.
execFileSync(
  'pnpm',
  ['--filter', '@inklet/desktop', 'exec', 'tauri', 'icon', source, '--output', output],
  { cwd: root, stdio: 'inherit' }
);

console.log(`\nicons regenerated from ${source}`);
