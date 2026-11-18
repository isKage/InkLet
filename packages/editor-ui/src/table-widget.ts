import { WidgetType } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import type { MathRender } from './widgets.js';

/**
 * A rendered table whose cells can be edited without touching the Markdown.
 *
 * Cells are plain elements — no `contenteditable`. Clicking one opens a small
 * input *outside* CodeMirror's content DOM (see `openCellEditor`), so the editor
 * never sees foreign mutations; this was the source of an unstable page when the
 * cells were editable themselves.
 */

export type Alignment = 'left' | 'center' | 'right' | 'default';

export interface ParsedTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly align: readonly Alignment[];
}

const SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function alignmentOf(cell: string): Alignment {
  const text = cell.trim();
  const left = text.startsWith(':');
  const right = text.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return 'default';
}

export function parseTable(source: string): ParsedTable | null {
  const lines = source.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2) return null;
  const header = splitRow(lines[0] ?? '');
  const separator = lines[1] ?? '';
  if (!SEPARATOR.test(separator)) return null;
  const align = splitRow(separator).map(alignmentOf);
  const rows = lines.slice(2).map(splitRow);
  return { header, rows, align };
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function alignMark(align: Alignment): string {
  if (align === 'center') return ':---:';
  if (align === 'right') return '---:';
  if (align === 'left') return ':---';
  return '---';
}

export function formatTable(table: ParsedTable): string {
  const columns = table.header.length;
  const pad = (cells: readonly string[]): string =>
    Array.from({ length: columns }, (_, i) => escapeCell(cells[i] ?? '')).join(' | ');
  const lines = [
    `| ${pad(table.header)} |`,
    `| ${Array.from({ length: columns }, (_, i) => alignMark(table.align[i] ?? 'default')).join(' | ')} |`,
    ...table.rows.map((row) => `| ${pad(row)} |`),
  ];
  return lines.join('\n');
}

function escapeHTML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Cell text with `$…$` / `$$…$$` typeset, so tables can hold maths too. */
function renderCell(text: string, renderMath: MathRender | undefined): string {
  if (!renderMath) return escapeHTML(text);
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let out = '';
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    out += escapeHTML(text.slice(last, match.index));
    const tex = match[1] ?? match[2] ?? '';
    const display = match[1] !== undefined;
    const result = renderMath(tex, { display });
    out += result.error
      ? `<span class="ink-math-error">${escapeHTML(match[0])}</span>`
      : `<span class="ink-math">${result.html}</span>`;
    last = match.index + match[0].length;
  }
  return out + escapeHTML(text.slice(last));
}

/** Writes one cell, growing rows/columns when the user reaches past the edge. */
export function setCell(
  table: ParsedTable,
  row: number,
  column: number,
  value: string
): ParsedTable {
  const width = Math.max(table.header.length, column + 1);
  const resize = (cells: readonly string[]): string[] =>
    Array.from({ length: width }, (_, i) => cells[i] ?? '');

  const header = resize(table.header);
  const rows = table.rows.map((cells) => resize(cells));
  if (row < 0) header[column] = value;
  else {
    while (rows.length <= row) rows.push(Array.from({ length: width }, () => ''));
    rows[row]![column] = value;
  }
  const align = Array.from({ length: width }, (_, i) => table.align[i] ?? 'default');
  return { header, rows, align };
}

export function addRow(table: ParsedTable): ParsedTable {
  const columns = Math.max(1, table.header.length);
  return {
    ...table,
    rows: [...table.rows, Array.from({ length: columns }, () => '')],
  };
}

/** The single overlay input, kept outside CodeMirror's content DOM. */
let overlay: HTMLInputElement | null = null;

/**
 * The table under the open overlay. Widgets are rebuilt on every keystroke, so
 * this is refreshed each time a table is rendered — the overlay must edit the
 * *current* source, not the one captured when the cell was clicked.
 */
let activeTable: { view: EditorView; from: number; source: string; table: ParsedTable } | null = null;

function closeOverlay(): void {
  overlay?.remove();
  overlay = null;
}

interface CellEditorOptions {
  readonly rect: DOMRect;
  readonly value: string;
  readonly onInput: (value: string) => void;
  readonly onAddRow: () => void;
}

function openCellEditor(options: CellEditorOptions): void {
  closeOverlay();
  const input = document.createElement('input');
  input.className = 'ink-cell-editor';
  input.value = options.value;
  input.style.left = `${options.rect.left}px`;
  input.style.top = `${options.rect.top}px`;
  input.style.width = `${Math.max(48, options.rect.width)}px`;
  input.style.height = `${Math.max(22, options.rect.height)}px`;

  input.addEventListener('input', () => options.onInput(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeOverlay();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        options.onAddRow();
        return;
      }
      closeOverlay();
    }
  });
  input.addEventListener('blur', closeOverlay);

  document.body.append(input);
  overlay = input;
  input.focus();
  input.select();
}

export class EditableTableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly table: ParsedTable,
    private readonly from: number,
    private readonly renderMath?: MathRender
  ) {
    super();
  }

  override eq(other: EditableTableWidget): boolean {
    return other.source === this.source;
  }

  override ignoreEvent(): boolean {
    return false;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'ink-table-editable';
    const table = document.createElement('table');

    activeTable = { view, from: this.from, source: this.source, table: this.table };

    const apply = (next: ParsedTable): void => {
      const markdown = formatTable(next);
      const live = activeTable;
      if (!live || markdown === live.source) return;
      const text = live.view.state.doc.toString();
      const from = text.indexOf(live.source, Math.max(0, live.from - 200));
      if (from < 0) return;
      live.view.dispatch({
        changes: { from, to: from + live.source.length, insert: markdown },
      });
    };

    const editCell = (row: number, column: number, cell: HTMLElement): void => {
      openCellEditor({
        rect: cell.getBoundingClientRect(),
        value: cell.dataset['raw'] ?? '',
        onInput: (value) => {
          if (!activeTable) return;
          apply(setCell(activeTable.table, row, column, value));
        },
        onAddRow: () => {
          if (!activeTable) return;
          apply(addRow(activeTable.table));
          closeOverlay();
        },
      });
    };

    const addCell = (
      tag: 'th' | 'td',
      text: string,
      row: number,
      column: number
    ): HTMLElement => {
      const cell = document.createElement(tag);
      cell.dataset['raw'] = text;
      cell.innerHTML = renderCell(text, this.renderMath);
      cell.dataset['row'] = String(row);
      cell.dataset['column'] = String(column);
      cell.addEventListener('mousedown', (event) => {
        event.preventDefault();
        editCell(row, column, cell);
      });
      return cell;
    };

    const head = document.createElement('tr');
    this.table.header.forEach((text, column) => head.append(addCell('th', text, -1, column)));
    table.append(head);
    this.table.rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      for (let column = 0; column < this.table.header.length; column += 1) {
        tr.append(addCell('td', row[column] ?? '', index, column));
      }
      table.append(tr);
    });

    wrapper.append(table);
    return wrapper;
  }
}
