import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { academicLanguage } from '../src/markdown.js';
import { parseDocument } from '@inklet/academic-md-core';
import {
  anchorIdCounts,
  findParsedDocument,
  livePreview,
  paragraphStartLines,
  revealsBlockSource,
  revealsSource,
} from '../src/live-preview.js';

const renderMath = (tex: string) => ({ html: `<svg>${tex}</svg>` });

function stateOf(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [academicLanguage, livePreview({ renderMath })],
  });
}

function names(state: EditorState): string[] {
  const found: string[] = [];
  syntaxTree(state).iterate({ enter: (node) => void found.push(node.name) });
  return found;
}

const SRC = [
  '# 第一章',
  '',
  '行内 $x^2$ 与 ++下划线++ 混排。',
  '',
  '## 一节',
  '',
  '$$',
  'a = b',
  '$$',
].join('\n');

describe('code editor language', () => {
  it('parses the academic dialect inside CodeMirror', () => {
    const found = names(stateOf(SRC));
    expect(found).toContain('InlineMath');
    expect(found).toContain('DisplayMath');
    expect(found).toContain('Underline');
    expect(found).toContain('ATXHeading2');
  });

  it('keeps GFM tables available', () => {
    expect(names(stateOf('| a | b |\n|---|---|\n| 1 | 2 |'))).toContain('Table');
  });
});

describe('live preview state', () => {
  it('exposes the parsed document for the app chrome', () => {
    const parsed = findParsedDocument(stateOf(SRC));
    expect(parsed?.headings.map((h) => h.text)).toEqual(['第一章', '一节']);
    expect(parsed?.diagnostics).toEqual([]);
  });

  it('re-parses when the document changes', () => {
    const state = stateOf(SRC);
    const next = state.update({ changes: { from: 0, to: 0, insert: '# 新的\n\n' } }).state;
    const parsed = findParsedDocument(next);
    expect(parsed?.headings.map((h) => h.text)).toEqual(['新的', '第一章', '一节']);
    expect(parsed?.tree.length).toBe(next.doc.length);
  });

  it('updates without a document change when the selection moves', () => {
    const state = stateOf('$$ a = b $$');
    const moved = state.update({ selection: { anchor: 3 } }).state;
    expect(findParsedDocument(moved)).toBeDefined();
  });

  it('reports nothing when the extension is absent', () => {
    const bare = EditorState.create({ doc: 'x' });
    expect(findParsedDocument(bare)).toBeUndefined();
  });
});

describe('in-document anchors', () => {
  it('counts each <id:…> marker so duplicates can be flagged', () => {
    const counts = anchorIdCounts('a <id:x> b <id:y> c <id:x>');
    expect(counts.get('x')).toBe(2);
    expect(counts.get('y')).toBe(1);
    expect(counts.get('missing')).toBeUndefined();
  });
});

describe('paragraph breaks', () => {
  const starts = (doc: string): number[] =>
    paragraphStartLines(parseDocument(doc), EditorState.create({ doc }).doc);

  it('marks the line after a blank line, not the soft-wrapped lines inside one', () => {
    expect(starts('one\ntwo\n\nthree')).toEqual([4]);
  });

  it('skips the first line of the document', () => {
    expect(starts('only paragraph')).toEqual([]);
  });

  it('collapses extra blank lines to a single break', () => {
    expect(starts('a\n\n\n\nb')).toEqual([5]);
  });

  it('leaves list and quote paragraphs to their own layout', () => {
    expect(starts('- item one\n\n- item two')).toEqual([]);
    expect(starts('> quote one\n>\n> quote two')).toEqual([]);
  });
});

describe('reveal boundaries', () => {
  const inside = (position: number) => [{ from: position, to: position }];

  it('keeps inline maths rendered when the caret sits right after it', () => {
    // `x$y$|` must stay rendered; only entering the formula shows its source.
    expect(revealsSource(inside(4), 0, 4)).toBe(false);
    expect(revealsSource(inside(3), 0, 4)).toBe(true);
  });

  it('lets the caret rest after a closing fence', () => {
    // The closing `$$` line is part of the block, so "just after it" is a
    // position inside the source range and has to keep the source visible.
    expect(revealsBlockSource(inside(30), 10, 30)).toBe(true);
    expect(revealsBlockSource(inside(31), 10, 30)).toBe(false);
  });

  it('still refuses to reveal at the very start', () => {
    expect(revealsBlockSource(inside(10), 10, 30)).toBe(false);
    expect(revealsBlockSource(inside(12), 10, 30)).toBe(true);
  });
});
