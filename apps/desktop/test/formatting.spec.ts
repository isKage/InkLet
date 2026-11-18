import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  buildTable,
  insertText,
  toggleLinePrefix,
  wrapInFence,
  wrapSelection,
} from '../src/formatting.js';

function state(doc: string, anchor = 0, head = anchor): EditorState {
  return EditorState.create({ doc, selection: { anchor, head } });
}

const applied = (before: EditorState, spec: ReturnType<typeof wrapSelection>): string =>
  before.update(spec).state.doc.toString();

describe('段落 menu', () => {
  it('adds a heading prefix', () => {
    expect(applied(state('标题'), toggleLinePrefix(state('标题'), '## '))).toBe('## 标题');
  });

  it('leaves the caret after the marker, ready to type', () => {
    const before = state('标题', 0);
    const after = before.update(toggleLinePrefix(before, '## ')).state;
    expect(after.selection.main.anchor).toBe(3);
  });

  it('leaves the caret after a list marker', () => {
    const before = state('条目', 0);
    const after = before.update(toggleLinePrefix(before, '- ')).state;
    expect(after.doc.toString()).toBe('- 条目');
    expect(after.selection.main.anchor).toBe(2);
  });

  it('shifts the caret when a heading level changes', () => {
    const before = state('## 标题', 5);
    const after = before.update(toggleLinePrefix(before, '# ')).state;
    expect(after.doc.toString()).toBe('# 标题');
    expect(after.selection.main.anchor).toBe(4);
  });

  it('moves the caret back when the prefix is removed', () => {
    const before = state('- 条目', 2);
    const after = before.update(toggleLinePrefix(before, '- ')).state;
    expect(after.doc.toString()).toBe('条目');
    expect(after.selection.main.anchor).toBe(0);
  });

  it('replaces a heading level instead of stacking prefixes', () => {
    const before = state('## 标题');
    expect(applied(before, toggleLinePrefix(before, '# '))).toBe('# 标题');
  });

  it('toggles the same prefix off', () => {
    const before = state('- 条目');
    expect(applied(before, toggleLinePrefix(before, '- '))).toBe('条目');
  });

  it('prefixes the line the caret is on', () => {
    const before = state('第一行\n第二行', 5);
    expect(applied(before, toggleLinePrefix(before, '> '))).toBe('第一行\n> 第二行');
  });

  it('wraps the selection in a fence', () => {
    const before = state('code here', 0, 9);
    expect(applied(before, wrapInFence(before))).toBe('```\ncode here\n```\n');
  });

  it('puts the language on the opening fence only', () => {
    const before = state('x = 1', 0, 5);
    const result = applied(before, wrapInFence(before, 'python'));
    expect(result).toBe('```python\nx = 1\n```\n');
    // A closer carrying an info string would not close anything.
    expect(result.trimEnd().endsWith('```')).toBe(true);
  });
});

describe('格式 menu', () => {
  it('wraps a selection in bold markers', () => {
    const before = state('重点', 0, 2);
    expect(applied(before, wrapSelection(before, '**'))).toBe('**重点**');
  });

  it('leaves the caret inside the markers when nothing is selected', () => {
    const before = state('abc', 1);
    const after = before.update(wrapSelection(before, '**')).state;
    expect(after.doc.toString()).toBe('a****bc');
    expect(after.selection.main.anchor).toBe(3);
  });

  it('supports the underline dialect', () => {
    const before = state('下划线', 0, 3);
    expect(applied(before, wrapSelection(before, '++'))).toBe('++下划线++');
  });

  it('inserts a table template at the caret', () => {
    const before = state('', 0);
    expect(applied(before, insertText(before, '| a |\n| --- |'))).toBe('| a |\n| --- |');
  });
});

describe('table insertion', () => {
  it('builds an empty table of the requested size', () => {
    const source = buildTable(3, 2);
    const lines = source.trimEnd().split('\n');
    // header + alignment rule + (rows - 1) body rows
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('| --- | --- |');
    expect(lines[1]!.split('---')).toHaveLength(3); // two columns → three parts
  });

  it('clamps silly sizes instead of emitting a broken table', () => {
    expect(buildTable(0, 0).trimEnd().split('\n')).toHaveLength(2);
    expect(buildTable(99, 99).trimEnd().split('\n')).toHaveLength(31);
  });
});
