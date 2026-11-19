/**
 * What a clicked `[text](target)` means.
 *
 * Kept pure and separate from the UI so the rules can be tested: the app only
 * decides *what to do* with the result (jump, open a file, open a browser).
 */

export type LinkTarget =
  | { readonly kind: 'anchor'; readonly id: string }
  | { readonly kind: 'url'; readonly href: string }
  | { readonly kind: 'file'; readonly rel: string }
  | { readonly kind: 'none' };

export interface LinkContext {
  /** Current text of the document that owns the link; holds the `<id:…>` markers. */
  readonly docText: string;
  /** Workspace path of the document, e.g. `papers/note.md`. */
  readonly fromRel: string;
  /** Every file in the workspace, workspace-relative. */
  readonly files: readonly string[];
  /** Absolute workspace root, so absolute paths inside it still resolve. */
  readonly root: string;
}

const EXTERNAL = /^(https?:|mailto:)/i;

/**
 * Extensions that mean "this is a file", not a domain. Without this, `notes.md`
 * (`.md` is Moldova's TLD) and `data.csv` would open as web pages.
 */
const FILE_EXTENSIONS = new Set([
  'md', 'markdown', 'mdown', 'txt', 'text', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
  'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'yaml', 'yml', 'toml',
  'sh', 'bash', 'zsh', 'py', 'rs', 'go', 'c', 'h', 'cpp', 'hpp', 'java', 'rb', 'php', 'swift',
  'zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'mov', 'mp4', 'mp3', 'wav', 'csv', 'tsv', 'doc',
  'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'tex', 'bib', 'epub', 'ipynb', 'lock', 'log',
]);

/**
 * A bare web address (`google.com`, `www.example.com/a?b=1`) without a scheme.
 * Anything that looks like a file extension is left to the file resolver.
 */
function bareWebAddress(value: string): string | null {
  if (!value || /\s/.test(value)) return null;
  const host = value.split(/[/?#]/)[0] ?? '';
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return null;
  const tld = host.split('.').pop()?.toLowerCase() ?? '';
  if (tld.length < 2 || FILE_EXTENSIONS.has(tld)) return null;
  return `https://${value}`;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Resolves `.`/`..` and joins `target` onto the folder of `base`. */
function relativePath(base: string, target: string): string {
  const parts = `${base ? `${base}/` : ''}${target}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

/**
 * Decides how to follow a link target.
 *
 * Order matters: an in-document `<id:xxx>` wins over a path with the same name,
 * because the identifier syntax exists to disambiguate in-document references.
 */
export function resolveLink(raw: string, context: LinkContext): LinkTarget {
  const trimmed = raw.trim().replace(/^<(.+)>$/, '$1').trim();
  if (!trimmed) return { kind: 'none' };

  // `#xxx` is the conventional form of an in-document reference.
  if (trimmed.startsWith('#')) {
    const id = decode(trimmed.slice(1));
    return id ? { kind: 'anchor', id } : { kind: 'none' };
  }

  if (EXTERNAL.test(trimmed)) return { kind: 'url', href: trimmed };

  // Any other scheme (`javascript:`, `data:`, …) is deliberately not followed.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    if (!/^file:/i.test(trimmed)) return { kind: 'none' };
  }

  const withoutFragment = trimmed.replace(/[?#].*$/, '');
  const target = decode(withoutFragment.replace(/^file:\/\//i, '')).replace(/\\/g, '/');
  if (!target) return { kind: 'none' };

  // A bare identifier that has a marker in this document is an anchor.
  if (context.docText.includes(`<id:${target}>`)) return { kind: 'anchor', id: target };

  const files = new Set(context.files);
  const root = context.root.replace(/[\\/]+$/, '');

  if (target.startsWith('/')) {
    if (!root || !target.startsWith(`${root}/`)) return { kind: 'none' };
    const rel = relativePath('', target.slice(root.length + 1));
    return files.has(rel) ? { kind: 'file', rel } : { kind: 'none' };
  }

  const rel = relativePath(context.fromRel.replace(/[^/]+$/, '').replace(/\/$/, ''), target);
  if (files.has(rel)) return { kind: 'file', rel };

  // No file by that name: a scheme-less address is still a web link.
  const web = bareWebAddress(trimmed);
  return web ? { kind: 'url', href: web } : { kind: 'none' };
}
