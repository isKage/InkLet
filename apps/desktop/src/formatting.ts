import type { EditorState, TransactionSpec } from '@codemirror/state';

/**
 * Editing commands behind the 段落 / 格式 menus.
 *
 * Kept as pure transaction specs so they can be unit-tested against an
 * `EditorState` without a DOM, and so the menu wiring stays a lookup table.
 */

/**
 * Toggles a line prefix; heading prefixes replace each other rather than stack.
 *
 * The caret is moved by the same delta as the text, so after inserting `- ` or
 * `## ` it sits *after* the marker and the user can type immediately.
 */
export function toggleLinePrefix(state: EditorState, prefix: string): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head);
  const head = state.selection.main.head;

  if (line.text.startsWith(prefix)) {
    return {
      changes: { from: line.from, to: line.from + prefix.length, insert: '' },
      selection: { anchor: Math.max(line.from, head - prefix.length) },
    };
  }

  const heading = /^#{1,6} /.exec(line.text);
  const removed = heading ? heading[0].length : 0;
  return {
    changes: { from: line.from, to: line.from + removed, insert: prefix },
    selection: { anchor: Math.max(line.from, head + prefix.length - removed) },
  };
}

export function wrapSelection(state: EditorState, before: string, after: string = before): TransactionSpec {
  const { from, to } = state.selection.main;
  const selected = state.doc.sliceString(from, to);
  return {
    changes: { from, to, insert: `${before}${selected}${after}` },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  };
}

export function insertText(state: EditorState, text: string): TransactionSpec {
  const { from, to } = state.selection.main;
  return { changes: { from, to, insert: text }, selection: { anchor: from + text.length } };
}

/** Empty GFM table of the requested size; `rows` counts the header row. */
export function buildTable(rows: number, columns: number): string {
  const width = Math.max(1, Math.min(12, columns));
  const height = Math.max(1, Math.min(30, rows));
  const empty = Array.from({ length: width }, () => ' ').join(' | ');
  const rule = Array.from({ length: width }, () => '---').join(' | ');
  const body = Array.from({ length: Math.max(0, height - 1) }, () => `| ${empty} |`);
  return [`| ${empty} |`, `| ${rule} |`, ...body, ''].join('\n');
}

/**
 * Wraps the selected lines in a fenced code block.
 *
 * `language` goes on the opening fence only: a closer with an info string is not
 * a closer, so `\`\`\`python … \`\`\`python` would not parse.
 */
export function wrapInFence(state: EditorState, language = ''): TransactionSpec {
  const selection = state.selection.main;
  const start = state.doc.lineAt(selection.from);
  const end = state.doc.lineAt(selection.to);
  const body = state.doc.sliceString(start.from, end.to);
  const opener = `\`\`\`${language}`;
  return {
    changes: { from: start.from, to: end.to, insert: `${opener}\n${body}\n\`\`\`\n` },
    selection: { anchor: start.from + opener.length + 1 },
  };
}
