import type { SyntaxNode } from '@lezer/common';
import { NodeNames } from './syntax/nodes.js';
import { extractMathSource } from './math-source.js';
import type { ParsedDocument } from './types.js';

/**
 * HTML renderer for a parsed document.
 *
 * DOM-free and callback-driven so the same code backs the desktop preview and the
 * self-contained HTML export (M5): one AST, one renderer, so preview and export
 * cannot drift apart.
 *
 * The important subtlety: in a Lezer Markdown tree, plain inline text is *not*
 * a node — it lives in the gaps between markup nodes. Rendering "the children"
 * therefore loses every word; everything below walks ranges and emits the gaps.
 */

export interface MathOutput {
  readonly html: string;
  readonly error?: string;
}

export interface RenderOptions {
  /** TeX → SVG. Injected so core never depends on a DOM-bound renderer. */
  readonly renderMath?: (tex: string, options: { display: boolean }) => MathOutput;
  /** Extra class on the root element, useful for scoping styles. */
  readonly className?: string;
  /**
   * Image target → `src` for the exported document (usually a `data:` URI).
   * Returning `null` keeps the placeholder, which is what the browser preview
   * wants since it cannot read the workspace.
   */
  readonly resolveImage?: (target: string) => string | null;
  /**
   * Fenced code → highlighted HTML. Injected like `renderMath` so core stays
   * free of a highlighter, and returning `null` keeps the escaped plain text.
   * The returned string must already be HTML-escaped.
   */
  readonly highlight?: (code: string, language: string | null) => string | null;
}

/** Inline markup nodes that carry no visible text of their own. */
const INVISIBLE_INLINE = new Set([
  'EmphasisMark',
  'CodeMark',
  'LinkMark',
  'StrikethroughMark',
  'HeaderMark',
  'EndMark',
  'URL',
  NodeNames.MathMark,
  NodeNames.MathContent,
]);

const INLINE_WRAPPERS: Readonly<Record<string, readonly [string, string]>> = {
  Emphasis: ['<em>', '</em>'],
  Underline: ['<u>', '</u>'],
  StrongEmphasis: ['<strong>', '</strong>'],
  Strikethrough: ['<del>', '</del>'],
};

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHTML(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] as string);
}

function children(node: SyntaxNode): SyntaxNode[] {
  const list: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) list.push(child);
  return list;
}

interface RenderContext {
  readonly doc: ParsedDocument;
  readonly opts: RenderOptions;
}

function createContext(doc: ParsedDocument, opts: RenderOptions): RenderContext {
  return { doc, opts };
}

function renderMathTex(ctx: RenderContext, tex: string, display: boolean): string {
  const { renderMath } = ctx.opts;
  if (!renderMath) return `<code class="math-source">${escapeHTML(tex)}</code>`;
  const out = renderMath(tex, { display });
  if (out.error) {
    return `<code class="math-error" title="${escapeHTML(out.error)}">${escapeHTML(tex)}</code>`;
  }
  return `<span class="math${display ? ' math-display' : ''}">${out.html}</span>`;
}

/** Text between the first two link marks: `[text](url)` → `text`. */
function linkTextRange(doc: ParsedDocument, node: SyntaxNode): { from: number; to: number } | null {
  const marks = children(node).filter((child) => child.name === 'LinkMark');
  if (marks.length < 2) return null;
  return { from: (marks[0] as SyntaxNode).to, to: (marks[1] as SyntaxNode).from };
}

/**
 * Renders `[from, to)` inside `node`, emitting escaped text for the gaps between
 * inline children and delegating markup children to their handlers.
 */
function renderInlineRange(ctx: RenderContext, node: SyntaxNode, from: number, to: number): string {
  const { doc } = ctx;
  const inRange = children(node).filter(
    (child) => child.from >= from && child.to <= to && !INVISIBLE_INLINE.has(child.name)
  );

  let out = '';
  let cursor = from;
  for (const child of inRange) {
    if (child.from > cursor) out += escapeHTML(doc.src.slice(cursor, child.from));
    out += renderInlineNode(ctx, child);
    cursor = child.to;
  }
  if (cursor < to) out += escapeHTML(doc.src.slice(cursor, to));
  return out;
}

function renderInlineNode(ctx: RenderContext, node: SyntaxNode): string {
  const { doc } = ctx;
  const name = node.name;

  if (name === NodeNames.InlineMath) {
    return renderMathTex(ctx, extractMathSource(doc.src, node), false);
  }

  if (name === 'Link') {
    const inner = linkTextRange(doc, node) ?? { from: node.from, to: node.to };
    const text = renderInlineRange(ctx, node, inner.from, inner.to);
    const urlNode = children(node).find((child) => child.name === 'URL');
    const target = urlNode ? doc.src.slice(urlNode.from, urlNode.to).trim() : '';
    if (!target) return `<span class="link">${text}</span>`;
    return `<a class="link" href="${escapeHTML(target)}">${text}</a>`;
  }

  if (name === 'Autolink') {
    const raw = doc.src.slice(node.from, node.to);
    // `<id:xxx>` is the in-document anchor marker: an empty anchor at that
    // point, so exported HTML/PDF can jump to it too.
    const marker = /^<id:([^>]+)>$/.exec(raw);
    if (marker?.[1]) return `<a class="anchor" id="${escapeHTML(marker[1])}"></a>`;
    const urlNode = children(node).find((child) => child.name === 'URL');
    const target = urlNode ? doc.src.slice(urlNode.from, urlNode.to).trim() : '';
    if (!target) return '';
    return `<a class="link" href="${escapeHTML(target)}">${escapeHTML(target)}</a>`;
  }

  if (name === 'Image') {
    const inner = linkTextRange(doc, node) ?? { from: node.from, to: node.to };
    const text = renderInlineRange(ctx, node, inner.from, inner.to);
    const urlNode = children(node).find((child) => child.name === 'URL');
    const target = urlNode ? doc.src.slice(urlNode.from, urlNode.to) : '';
    const label = text.trim() || target;
    const src = ctx.opts.resolveImage?.(target) ?? null;
    if (src) {
      return `<img class="image" src="${escapeHTML(src)}" alt="${escapeHTML(label)}">`;
    }
    // No resolver (browser preview) or an unreadable file: name the target
    // rather than render an empty box that looks like a bug.
    return `<span class="image-placeholder" title="${escapeHTML(target)}">${escapeHTML(label)}</span>`;
  }

  if (name === 'InlineCode') {
    const marks = children(node).filter((child) => child.name === 'CodeMark');
    const from = marks[0]?.to ?? node.from;
    const to = marks[marks.length - 1]?.from ?? node.to;
    return `<code>${escapeHTML(doc.src.slice(from, to))}</code>`;
  }

  const wrapper = INLINE_WRAPPERS[name];
  if (wrapper) {
    const marks = children(node).filter(
      (child) =>
        child.name === 'EmphasisMark' ||
        child.name === 'StrikethroughMark' ||
        child.name === NodeNames.UnderlineMark
    );
    const from = marks[0]?.to ?? node.from;
    const to = marks[marks.length - 1]?.from ?? node.to;
    const inner = from < to ? renderInlineRange(ctx, node, from, to) : '';
    return `${wrapper[0]}${inner}${wrapper[1]}`;
  }

  if (!node.firstChild) return escapeHTML(doc.src.slice(node.from, node.to));
  return renderInlineRange(ctx, node, node.from, node.to);
}

function headingLevel(name: string): number | null {
  switch (name) {
    case 'ATXHeading1':
    case 'SetextHeading1':
      return 1;
    case 'ATXHeading2':
    case 'SetextHeading2':
      return 2;
    case 'ATXHeading3':
      return 3;
    case 'ATXHeading4':
      return 4;
    case 'ATXHeading5':
      return 5;
    case 'ATXHeading6':
      return 6;
    default:
      return null;
  }
}

/** Block-level markers that carry no content of their own. */
const INVISIBLE_BLOCK = new Set(['QuoteMark', 'ListMark']);

function renderBlocks(ctx: RenderContext, parent: SyntaxNode): string {
  return children(parent)
    .filter((child) => !INVISIBLE_BLOCK.has(child.name))
    .map((child) => renderBlock(ctx, child))
    .filter(Boolean)
    .join('\n');
}

function renderTable(ctx: RenderContext, node: SyntaxNode): string {
  const header: SyntaxNode[] = [];
  const rows: SyntaxNode[] = [];
  for (const child of children(node)) {
    if (child.name === 'TableHeader') header.push(child);
    else if (child.name === 'TableRow') rows.push(child);
  }
  const cells = (row: SyntaxNode, tag: 'td' | 'th'): string =>
    children(row)
      .filter((c) => c.name === 'TableCell')
      .map((c) => `<${tag}>${renderInlineRange(ctx, c, c.from, c.to)}</${tag}>`)
      .join('');
  const thead = header.length ? `<thead>${header.map((h) => `<tr>${cells(h, 'th')}</tr>`).join('')}</thead>` : '';
  const tbody = rows.length ? `<tbody>${rows.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('')}</tbody>` : '';
  return `<table>${thead}${tbody}</table>`;
}

function renderList(ctx: RenderContext, node: SyntaxNode): string {
  const tag = node.name === 'OrderedList' ? 'ol' : 'ul';
  const items = children(node)
    .filter((child) => child.name === 'ListItem')
    .map((item) => {
      const inner = children(item)
        .filter((child) => child.name !== 'ListMark')
        .map((child) => renderBlock(ctx, child))
        .join('\n');
      // A lone paragraph inside a list item reads better without the wrapper.
      return `<li>${inner.replace(/^<p>([\s\S]*)<\/p>$/, '$1')}</li>`;
    })
    .join('');
  return `<${tag}>${items}</${tag}>`;
}

function renderBlock(ctx: RenderContext, node: SyntaxNode): string {
  const { doc } = ctx;
  const name = node.name;
  const level = headingLevel(name);

  if (level !== null) {
    const kids = children(node);
    const headerMark = kids.find((child) => child.name === 'HeaderMark');
    const endMark = kids.find((child) => child.name === 'EndMark');
    const from = headerMark ? headerMark.to : node.from;
    const to = endMark?.from ?? node.to;
    return `<h${level}>${renderInlineRange(ctx, node, from, to).trim()}</h${level}>`;
  }

  switch (name) {
    case 'Paragraph':
      return `<p>${renderInlineRange(ctx, node, node.from, node.to)}</p>`;

    case NodeNames.DisplayMath: {
      // `\tag{…}` is left in the TeX on purpose: MathJax draws it correctly and
      // right-aligns it, which is better than a number of our own.
      const tex = extractMathSource(doc.src, node);
      return `<div class="math-block">${renderMathTex(ctx, tex, true)}</div>`;
    }

    case 'BulletList':
    case 'OrderedList':
      return renderList(ctx, node);

    case 'Blockquote':
      return `<blockquote>${renderBlocks(ctx, node)}</blockquote>`;

    case 'FencedCode':
    case 'CodeBlock': {
      const info = children(node).find((child) => child.name === 'CodeInfo');
      const language = info ? doc.src.slice(info.from, info.to).trim() : '';
      const code = children(node)
        .filter((child) => child.name === 'CodeText')
        .map((child) => doc.src.slice(child.from, child.to))
        .join('\n');
      const cls = language ? ` class="language-${escapeHTML(language)}"` : '';
      const body = (language && ctx.opts.highlight?.(code, language)) || escapeHTML(code);
      return `<pre><code${cls}>${body}</code></pre>`;
    }

    case 'Table':
      return renderTable(ctx, node);

    case 'HorizontalRule':
      return '<hr>';

    case 'HTMLBlock':
      return `<pre class="html-block">${escapeHTML(doc.src.slice(node.from, node.to))}</pre>`;

    default:
      // Never drop content silently: recurse when possible, else show the text.
      if (node.firstChild) return renderBlocks(ctx, node);
      return doc.src.slice(node.from, node.to).trim()
        ? `<p>${escapeHTML(doc.src.slice(node.from, node.to))}</p>`
        : '';
  }
}

/**
 * Renders a single block node. The live editor uses this for constructs it
 * replaces with a block widget (tables today), so a table looks the same there
 * as in an export.
 */
export function renderNodeHTML(
  doc: ParsedDocument,
  node: SyntaxNode,
  opts: RenderOptions = {}
): string {
  return renderBlock(createContext(doc, opts), node);
}

/**
 * Renders the document body (no `<html>` wrapper) as HTML.
 * The exporter wraps this in a full page; the editor slots it into the preview.
 */
export function renderHTML(doc: ParsedDocument, opts: RenderOptions = {}): string {
  const ctx = createContext(doc, opts);
  const body = renderBlocks(ctx, doc.tree.topNode);
  const className = opts.className ? ` class="${escapeHTML(opts.className)}"` : '';
  return `<div${className}>${body}</div>`;
}
