import { EditorView, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { NodeNames, parseDocument } from '@inklet/academic-md-core';
import type { ParsedDocument } from '@inklet/academic-md-core';
import { findParsedDocument } from './live-preview.js';

/**
 * Keys that create and traverse the block constructs of a Markdown document.
 *
 * Three jobs, all of them about the boundary between "I am typing prose" and "I
 * am inside a block":
 *
 * - typing `$$`, `\[` or a fenced code opener and pressing Enter inserts the
 *   closer, so a block exists after one keystroke;
 * - Enter is left to the editor: one press writes one newline, exactly what the
 *   file then contains. A new paragraph is a blank line, which is two presses —
 *   the same rule the renderer and every Markdown tool already follow;
 * - ArrowDown/ArrowUp at the edge of a display formula step into it, which
 *   reveals its source and the live preview.
 */

/** Closer to insert when Enter is pressed on a bare opener line. */
export function closerForLine(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '$$') return '$$';
  if (trimmed === '\\[') return '\\]';
  // A fenced code block: three backticks, optionally with a language tag.
  if (/^```[\w+.#-]*$/.test(trimmed)) return '```';
  return null;
}

export interface MathRange {
  readonly from: number;
  readonly to: number;
}

/** Blocks whose content is not prose: Enter stays a plain newline inside them. */
const BLOCK_NODES = new Set<string>([
  'ListItem',
  'Blockquote',
  'FencedCode',
  'CodeBlock',
  NodeNames.DisplayMath,
  'Table',
]);

/**
 * The name of the innermost block that *strictly* contains `position`, if any.
 *
 * Strict containment matters at the edges: the end of a closing `$$` or fence is
 * where the block stops, so Enter there starts a new paragraph after it rather
 * than continuing the block's content.
 */
export function enclosingBlock(parsed: ParsedDocument, position: number): string | null {
  let found: string | null = null;
  for (let node: SyntaxNode | null = parsed.tree.resolveInner(position, 1); node; node = node.parent) {
    if (BLOCK_NODES.has(node.name) && node.from < position && position < node.to) {
      found = node.name;
    }
  }
  return found;
}

/** Blocks that carry their own closing line. */
const CLOSED_KINDS = new Set<string>([NodeNames.DisplayMath, 'FencedCode']);

/** The innermost block of `kinds` that contains `position`, boundaries included. */
function blockAt(parsed: ParsedDocument, position: number, kinds: ReadonlySet<string>): SyntaxNode | null {
  // Side -1 finds the node ending at a line end (the common case); at position 0
  // there is nothing before, so the other side is the only way in.
  for (const start of [parsed.tree.resolveInner(position, -1), parsed.tree.resolveInner(position, 1)]) {
    for (let node: SyntaxNode | null = start; node; node = node.parent) {
      if (kinds.has(node.name) && position >= node.from && position <= node.to) return node;
    }
  }
  return null;
}

/**
 * A block is closed once its source ends with a closer on a later line.
 *
 * This cannot be read off the tree: the dialect's `$$` rule happily extends an
 * unterminated block to the end of the document, so `$$\ntext` and `$$\ntext\n$$`
 * both produce a DisplayMath node — and an unclosed fence node ends on its own
 * opener. Only the text tells them apart.
 */
function hasCloser(parsed: ParsedDocument, node: SyntaxNode): boolean {
  const text = parsed.src.slice(node.from, node.to);
  const breakAt = text.lastIndexOf('\n');
  if (breakAt < 0) return false; // one line: the opener is all there is
  const last = text.slice(breakAt + 1).trim();
  if (node.name === NodeNames.DisplayMath) {
    // Usually the closer has its own line; `x = 1$$` is also legal.
    return last === '$$' || last === '\\]' || last.endsWith('$$') || last.endsWith('\\]');
  }
  return last.startsWith('```');
}

/**
 * Whether `position` sits inside a display formula or a fenced code block whose
 * opener has already been closed. A dangling `$$` is not a block yet, which is
 * exactly when the closer should be inserted.
 */
export function insideClosedBlock(parsed: ParsedDocument, position: number): boolean {
  const node = blockAt(parsed, position, CLOSED_KINDS);
  return node !== null && hasCloser(parsed, node);
}

/**
 * The display-maths block immediately before/after `position`, if any.
 * A blank line in between is allowed, which is how people actually type.
 */
export function adjacentDisplayMath(
  parsed: ParsedDocument,
  position: number,
  direction: 'up' | 'down'
): MathRange | null {
  let best: MathRange | null = null;
  parsed.tree.iterate({
    enter(node) {
      if (node.name !== NodeNames.DisplayMath) return;
      if (direction === 'down') {
        const gap = node.from - position;
        if (gap >= 1 && gap <= 2 && (!best || node.from < best.from)) {
          best = { from: node.from, to: node.to };
        }
      } else {
        const gap = position - node.to;
        if (gap >= 1 && gap <= 2 && (!best || node.to > best.to)) {
          best = { from: node.from, to: node.to };
        }
      }
    },
  });
  return best;
}

/**
 * Whether this view may insert text right now. `composing` matters: an IME that
 * confirms a candidate with Enter must not also break the paragraph.
 */
const canEdit = (view: EditorView): boolean => !view.state.readOnly && !view.composing;

/** `- `, `* `, `+ `, `1. ` or `1) ` at the start of a line. */
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;

/**
 * Enter on a list item ends the item and leaves the list.
 *
 * One newline would only continue the same item, which is not what pressing
 * Enter after a bullet feels like it should do; the blank line that makes a real
 * paragraph break is what Typora leaves behind too. Writing the next marker is
 * the author's job, as it is for every other block.
 */
const exitListOnEnter = (view: EditorView): boolean => {
  if (!canEdit(view)) return false;
  const { head, from, to } = view.state.selection.main;
  if (from !== to) return false;
  const line = view.state.doc.lineAt(head);
  if (!LIST_ITEM.test(line.text)) return false;
  // `enclosingBlock` is strict about the end: the caret at the end of an item is
  // outside it, so ask about the last character of the line instead.
  const probe = head > line.from ? head - 1 : line.from;
  if (enclosingBlock(parsedOf(view), probe) !== 'ListItem') return false;
  view.dispatch({
    changes: { from: head, insert: '\n\n' },
    selection: { anchor: head + 2 },
    scrollIntoView: true,
  });
  return true;
};

/** Parsed tree for the current document, reusing the live-preview field when present. */
const parsedOf = (view: EditorView): ParsedDocument =>
  findParsedDocument(view.state) ?? parseDocument(view.state.doc.toString());

/**
 * Enter on a bare opener line closes it, leaving the caret inside the block.
 * Does nothing when the line is already part of a closed block: otherwise the
 * closing `$$` would read as a fresh opener every time the caret rested on it.
 */
const closeBlockOnEnter = (view: EditorView): boolean => {
  if (!canEdit(view)) return false;
  const { head, from, to } = view.state.selection.main;
  if (from !== to) return false;
  const line = view.state.doc.lineAt(head);
  if (head !== line.to) return false;
  const closer = closerForLine(line.text);
  if (!closer) return false;
  if (insideClosedBlock(parsedOf(view), head)) return false;
  view.dispatch({
    changes: { from: line.to, insert: `\n\n${closer}` },
    selection: { anchor: line.to + 1 },
  });
  return true;
};

const enterAdjacentMath = (view: EditorView, direction: 'up' | 'down'): boolean => {
  const parsed = parsedOf(view);
  const { head } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  const position = direction === 'down' ? line.to : line.from;
  const target = adjacentDisplayMath(parsed, position, direction);
  if (!target) return false;

  const anchor =
    direction === 'down' ? Math.min(target.from + 2, target.to) : Math.max(target.to - 2, target.from);
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
  return true;
};

export const blockKeys: Extension = keymap.of([
  { key: 'Enter', run: closeBlockOnEnter },
  { key: 'Enter', run: exitListOnEnter },
  { key: 'ArrowDown', run: (view) => enterAdjacentMath(view, 'down') },
  { key: 'ArrowUp', run: (view) => enterAdjacentMath(view, 'up') },
]);
