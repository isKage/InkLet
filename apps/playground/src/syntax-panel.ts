import { dumpTree, extractMathSource, parseDocument, NodeNames } from '@inklet/academic-md-core';
import type { ParsedDocument } from '@inklet/academic-md-core';
import { MARKDOWN_SAMPLE } from './markdown-sample.js';

function lineCol(src: string, offset: number): string {
  const before = src.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return `${line}:${column}`;
}

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function section(title: string, rows: HTMLTableRowElement[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sem-section';
  const heading = document.createElement('div');
  heading.className = 'sem-title';
  heading.textContent = title;
  wrap.append(heading);
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'summary';
    empty.textContent = '—';
    wrap.append(empty);
    return wrap;
  }
  const table = document.createElement('table');
  for (const row of rows) table.append(row);
  wrap.append(table);
  return wrap;
}

function renderSemantics(parsed: ParsedDocument, host: HTMLElement): void {
  host.replaceChildren();

  const headings = parsed.headings.map((heading) => {
    const row = document.createElement('tr');
    row.append(cell(`h${heading.level}`), cell(heading.text), cell(lineCol(parsed.src, heading.from)));
    return row;
  });

  const diagnostics = parsed.diagnostics.map((d) => {
    const row = document.createElement('tr');
    row.append(
      cell(d.severity, d.severity === 'error' ? 'warn' : ''),
      cell(d.code),
      cell(d.message),
      cell(lineCol(parsed.src, d.from))
    );
    return row;
  });

  host.append(
    section(`headings · ${parsed.headings.length}`, headings),
    section(`diagnostics · ${parsed.diagnostics.length}`, diagnostics)
  );
}

/**
 * Live view of the syntax tree and the derived semantics — the M0 demo: maths
 * nodes, the heading list and any diagnostics, all before a single decoration
 * exists.
 */
export function mountSyntaxPanel(): void {
  const input = document.getElementById('mdIn') as HTMLTextAreaElement | null;
  const out = document.getElementById('mdOut');
  const summary = document.getElementById('mdSummary');
  const semantics = document.getElementById('mdSemantics');
  if (!input || !out || !summary || !semantics) throw new Error('syntax panel markup missing');

  input.value = MARKDOWN_SAMPLE;

  const render = (): void => {
    const src = input.value;
    const parsed = parseDocument(src);

    out.textContent = dumpTree(src, parsed.tree);
    renderSemantics(parsed, semantics);

    const maths: string[] = [];
    parsed.tree.iterate({
      enter(node) {
        if (node.name !== NodeNames.InlineMath && node.name !== NodeNames.DisplayMath) return;
        maths.push(`${node.name} → ${JSON.stringify(extractMathSource(src, node.node))}`);
      },
    });

    summary.textContent = [
      `${src.length} chars · ${maths.length} maths · ${parsed.headings.length} headings · ${parsed.diagnostics.length} diagnostics`,
      `macros: ${Object.keys(parsed.macros).join(', ') || '—'}`,
      ...maths,
    ].join('\n');
  };

  input.addEventListener('input', render);
  render();
}
