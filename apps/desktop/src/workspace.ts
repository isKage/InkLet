import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { SAMPLE } from './sample.js';

/**
 * Workspace file access.
 *
 * Desktop shell → Rust commands. Browser (`pnpm dev`) → no file access at all,
 * with one deliberate exception: `enableDemoWorkspace()` opts into an in-memory
 * sample folder for UI work and screenshots (`#demo`). The demo is never wired
 * to the "open folder" button — clicking that in a browser must say so instead
 * of silently opening a fake directory.
 */

export interface Entry {
  readonly path: string;
  readonly name: string;
  readonly isDir: boolean;
}

export interface Snapshot {
  readonly content: string;
  readonly hash: string;
}

export interface WriteResult {
  readonly hash: string;
  readonly conflict: boolean;
}

interface RawEntry {
  path: string;
  name: string;
  is_dir: boolean;
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** True when running inside the Tauri shell (real file access). */
export const isDesktopShell = isTauri;

let demo = false;

/** Opts into the in-memory demo workspace. Development aid only. */
export function enableDemoWorkspace(): void {
  demo = true;
}

export const isDemoWorkspace = (): boolean => demo;

const NO_FS = '当前是浏览器预览模式，无法访问本机文件系统；请用 `pnpm dev:tauri` 打开桌面窗口，或运行打包后的应用。';

export async function pickFolder(): Promise<string | null> {
  if (demo) return '/demo-notes';
  if (!isTauri) return null;
  const selected = await open({ directory: true, multiple: false, title: '选择笔记文件夹' });
  return typeof selected === 'string' ? selected : null;
}

/**
 * Turns a path the system handed us (a drop, or a Finder "Open With") into a
 * workspace root plus the file to open inside it. The decision lives in Rust so
 * it can be unit-tested without a window.
 */
export async function resolveOpenTarget(
  path: string
): Promise<{ root: string; file: string | null }> {
  if (demo) return { root: '/demo-notes', file: null };
  if (!isTauri) throw new Error(NO_FS);
  return invoke('resolve_open_target', { path });
}

/** Paths that arrived while the window was still starting up. */
/**
 * URL the webview can load for an absolute path, through the asset protocol.
 * Used for PDFs, which are too large to read into memory as a data URI.
 */
export function fileUrl(absolutePath: string): string {
  if (!isTauri) return absolutePath;
  return convertFileSrc(absolutePath);
}

export async function takePendingOpen(): Promise<string[]> {
  if (demo) return [];
  if (!isTauri) return [];
  return invoke('take_pending_open');
}

export async function listFiles(root: string): Promise<Entry[]> {
  if (demo) return MOCK_ENTRIES;
  if (!isTauri) throw new Error(NO_FS);
  const rows = await invoke<RawEntry[]>('list_files', { root });
  return rows.map((row) => ({ path: row.path, name: row.name, isDir: row.is_dir }));
}

export async function readFile(root: string, rel: string): Promise<Snapshot> {
  if (demo) {
    const content = MOCK_FILES[rel];
    if (content === undefined) throw new Error(`demo workspace has no ${rel}`);
    return { content, hash: `demo:${rel}` };
  }
  if (!isTauri) throw new Error(NO_FS);
  return invoke<Snapshot>('read_file', { root, rel });
}

/** Reads an image as a `data:` URI. */
export async function readImage(root: string, rel: string): Promise<string> {
  if (demo) return demoImage(rel);
  if (!isTauri) throw new Error(NO_FS);
  return invoke<string>('read_image', { root, rel });
}

/** Creates an empty file (default) or a directory inside the workspace. */
export async function createEntry(root: string, rel: string, kind: 'file' | 'dir'): Promise<void> {
  if (demo) {
    const segments = rel.split('/').filter(Boolean);
    const name = segments[segments.length - 1] ?? rel;
    // Make sure the parent directories exist in the mock tree.
    for (let i = 1; i < segments.length; i += 1) {
      const parent = segments.slice(0, i).join('/');
      if (!MOCK_ENTRIES.some((entry) => entry.path === parent)) {
        MOCK_ENTRIES.push({ path: parent, name: segments[i - 1] ?? parent, isDir: true });
      }
    }
    MOCK_ENTRIES.push({ path: rel, name, isDir: kind === 'dir' });
    if (kind === 'file') MOCK_FILES[rel] = '';
    return;
  }
  await invoke('create_entry', { root, rel, kind });
}

/** Removes a file or a directory tree. */
export async function deleteEntry(root: string, rel: string): Promise<void> {
  if (demo) {
    MOCK_ENTRIES.splice(
      0,
      MOCK_ENTRIES.length,
      ...MOCK_ENTRIES.filter((entry) => entry.path !== rel && !entry.path.startsWith(`${rel}/`))
    );
    delete MOCK_FILES[rel];
    return;
  }
  await invoke('delete_entry', { root, rel });
}

/** Copies a file or directory tree to `to` (same parent by convention). */
export async function copyEntry(root: string, rel: string, to: string): Promise<void> {
  if (demo) {
    const source = MOCK_FILES[rel];
    const name = to.split('/').pop() ?? to;
    MOCK_ENTRIES.push({ path: to, name, isDir: false });
    MOCK_FILES[to] = source ?? '';
    return;
  }
  await invoke('copy_entry', { root, rel, to });
}

export async function renameEntry(root: string, rel: string, to: string): Promise<void> {
  if (demo) {
    const index = MOCK_ENTRIES.findIndex((item) => item.path === rel);
    if (index >= 0) {
      const entry = MOCK_ENTRIES[index];
      if (entry) {
        MOCK_ENTRIES[index] = { ...entry, path: to, name: to.split('/').pop() ?? to };
      }
    }
    const content = MOCK_FILES[rel];
    delete MOCK_FILES[rel];
    if (content !== undefined) MOCK_FILES[to] = content;
    return;
  }
  await invoke('rename_entry', { root, rel, to });
}

/** Files and folders currently on the system clipboard, as absolute paths. */
export async function clipboardFiles(): Promise<string[]> {
  if (!isTauri) throw new Error(NO_FS);
  return invoke<string[]>('clipboard_files');
}

/** Opens an http(s)/mailto link in the system browser. */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri) throw new Error(NO_FS);
  await invoke('open_external', { url });
}

/** Puts files on the system clipboard so Finder, VS Code etc. can paste them. */
export async function copyToClipboard(paths: string[]): Promise<void> {
  if (!isTauri) throw new Error(NO_FS);
  await invoke('copy_files', { paths });
}

/** Copies clipboard paths into `relDir` and returns the workspace paths created. */
export async function pastePaths(
  root: string,
  relDir: string,
  paths: string[],
  copySuffix: string
): Promise<string[]> {
  if (!isTauri) throw new Error(NO_FS);
  return invoke<string[]>('paste_paths', { root, relDir, paths, copySuffix });
}

export async function writeFile(
  root: string,
  rel: string,
  content: string,
  expectedHash: string | null
): Promise<WriteResult> {
  if (demo) {
    MOCK_FILES[rel] = content;
    return { hash: `demo:${rel}`, conflict: false };
  }
  if (!isTauri) throw new Error(NO_FS);
  return invoke<WriteResult>('write_file', { root, rel, content, expectedHash });
}

/** Stand-in image for the demo workspace so the `<img>` path is exercised. */
function demoImage(name: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="150">` +
    `<rect width="100%" height="100%" fill="#f0efe9"/>` +
    `<text x="50%" y="50%" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#8a8a90">` +
    `${name.replace(/[<>&]/g, '')}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// --- in-memory demo workspace (dev aid) ------------------------------------

const MOCK_ENTRIES: Entry[] = [
  { path: 'papers', name: 'papers', isDir: true },
  { path: 'papers/elliptic.md', name: 'elliptic.md', isDir: false },
  { path: 'papers/notes.md', name: 'notes.md', isDir: false },
  { path: 'papers/figure.png', name: 'figure.png', isDir: false },
  { path: 'papers/data.bin', name: 'data.bin', isDir: false },
  { path: 'notes.txt', name: 'notes.txt', isDir: false },
  { path: 'archive', name: 'archive', isDir: true },
  ...Array.from({ length: 40 }, (_, index) => index + 1).map((n) => ({
    path: `archive/old-${String(n).padStart(2, '0')}.md`,
    name: `old-${String(n).padStart(2, '0')}.md`,
    isDir: false as const,
  })),
  { path: 'README.md', name: 'README.md', isDir: false },
];

const MOCK_FILES: Record<string, string> = {
  'papers/elliptic.md': SAMPLE,
  'papers/data.bin': '\u0000\u0001binary',
  'papers/notes.md': '# 随手记\n\n- 先验证 $H^1$ 一致性\n- 再补误差表\n',
  'README.md': '# InkLet 示例库\n\n这是内存中的示例工作区，仅用于界面开发。\n',
  'notes.txt': '# 纯文本文件\n\n这一行应当按原样显示，不做 Markdown 渲染。\n',
  ...Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `archive/old-${String(index + 1).padStart(2, '0')}.md`,
      `# 旧稿 ${index + 1}\n\n归档内容。\n`,
    ])
  ),
};
