import { describe, expect, it, vi } from 'vitest';

// The Tauri bridges are mocked: this file tests our own decision logic, not the
// plugin runtime (that is covered by the Rust side and by the shell smoke test).
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => []) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));

async function load() {
  vi.resetModules();
  return import('../src/workspace.js');
}

describe('browser without the desktop shell', () => {
  it('does not invent a folder', async () => {
    const workspace = await load();
    expect(workspace.isDesktopShell).toBe(false);
    // The old behaviour returned a fake demo path here, so "open folder"
    // silently jumped into the sample directory. It must return null instead.
    await expect(workspace.pickFolder()).resolves.toBeNull();
  });

  it('refuses file access with an actionable message', async () => {
    const workspace = await load();
    await expect(workspace.listFiles('/tmp')).rejects.toThrow(/dev:tauri/);
    await expect(workspace.readFile('/tmp', 'a.md')).rejects.toThrow(/dev:tauri/);
    await expect(workspace.writeFile('/tmp', 'a.md', 'x', null)).rejects.toThrow(/dev:tauri/);
  });

  it('is not in demo mode by default', async () => {
    const workspace = await load();
    expect(workspace.isDemoWorkspace()).toBe(false);
  });
});

describe('demo workspace', () => {
  it('only exists after an explicit opt-in', async () => {
    const workspace = await load();
    workspace.enableDemoWorkspace();
    expect(workspace.isDemoWorkspace()).toBe(true);
    await expect(workspace.pickFolder()).resolves.toBe('/demo-notes');

    const entries = await workspace.listFiles('/demo-notes');
    expect(entries.some((entry) => entry.isDir)).toBe(true);

    const snapshot = await workspace.readFile('/demo-notes', 'papers/elliptic.md');
    expect(snapshot.content).toContain('一阶线性椭圆方程');

    const written = await workspace.writeFile('/demo-notes', 'papers/notes.md', '# 改过', null);
    expect(written.conflict).toBe(false);
    const reread = await workspace.readFile('/demo-notes', 'papers/notes.md');
    expect(reread.content).toBe('# 改过');
  });

  it('keeps a fresh module free of demo state', async () => {
    const workspace = await load();
    expect(workspace.isDemoWorkspace()).toBe(false);
    await expect(workspace.readFile('/demo-notes', 'papers/elliptic.md')).rejects.toThrow(/dev:tauri/);
  });
});
