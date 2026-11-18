import { describe, expect, it } from 'vitest';
import { parseDocument } from '@inklet/academic-md-core';
import {
  adjacentDisplayMath,
  closerForLine,
  enclosingBlock,
  insideClosedBlock,
} from '../src/block-keys.js';

describe('block openers', () => {
  it('closes a display formula typed on its own line', () => {
    expect(closerForLine('$$')).toBe('$$');
    expect(closerForLine('  $$  ')).toBe('$$');
    expect(closerForLine('\\[')).toBe('\\]');
  });

  it('closes a fenced code block', () => {
    expect(closerForLine('```')).toBe('```');
    expect(closerForLine('```ts')).toBe('```');
    expect(closerForLine('  ```python ')).toBe('```');
  });

  it('leaves other lines alone', () => {
    expect(closerForLine('$$ x')).toBeNull();
    expect(closerForLine('text')).toBeNull();
    expect(closerForLine('``` a b')).toBeNull();
    expect(closerForLine('\\[0,1\\]')).toBeNull();
  });
});

describe('closed blocks', () => {
  const src = '$$\nx\n$$\nafter';
  const closerEnd = src.lastIndexOf('$$') + 2;

  it('recognises a display formula that already has its closer', () => {
    expect(insideClosedBlock(parseDocument(src), closerEnd)).toBe(true);
    expect(insideClosedBlock(parseDocument(src), 0)).toBe(true);
  });

  it('treats a dangling opener as open', () => {
    const dangling = '$$\nx';
    expect(insideClosedBlock(parseDocument(dangling), dangling.length)).toBe(false);
  });

  it('recognises a closed fence, so Enter does not add a second one', () => {
    const fence = '```\ncode\n```';
    expect(insideClosedBlock(parseDocument(fence), fence.length)).toBe(true);
    expect(insideClosedBlock(parseDocument('```\ncode'), 10)).toBe(false);
  });

  it('treats a bare opener as open, however the parser stretches it', () => {
    // Both of these parse into a block node that runs to the end of the file,
    // yet neither has a closer: Enter must still produce one.
    expect(insideClosedBlock(parseDocument('```'), 3)).toBe(false);
    expect(insideClosedBlock(parseDocument('$$\n'), 2)).toBe(false);
    expect(insideClosedBlock(parseDocument('```\ncode'), 10)).toBe(false);
  });

  it('accepts a closer that shares the last content line', () => {
    const src = '$$\nx = 1$$';
    expect(insideClosedBlock(parseDocument(src), src.length)).toBe(true);
  });

  it('says yes on the closing line but no just after it', () => {
    // The caret on the closer is still inside the block (source shown, frame
    // drawn); one position further it is ordinary prose again.
    const doc = parseDocument('$$\nx\n$$');
    expect(insideClosedBlock(doc, 6)).toBe(true);
  });
});

describe('enclosing blocks', () => {
  it('reports prose as free', () => {
    const src = 'one\n\ntwo';
    expect(enclosingBlock(parseDocument(src), src.indexOf('two') + 1)).toBeNull();
  });

  it('reports a fenced block from inside its content', () => {
    const src = '```\nlet x = 1;\n```';
    expect(enclosingBlock(parseDocument(src), src.indexOf('let') + 3)).toBe('FencedCode');
  });

  it('releases the caret at the very end of a block', () => {
    // Enter after the closing fence starts a new paragraph, it does not extend
    // the code block.
    const src = '```\nlet x = 1;\n```';
    expect(enclosingBlock(parseDocument(src), src.length)).toBeNull();
  });

  it('keeps list items on the default Enter', () => {
    const src = '- first\n- second';
    expect(enclosingBlock(parseDocument(src), src.indexOf('second') + 2)).toBe('ListItem');
  });
});

describe('display maths navigation', () => {
  it('finds the block right below the caret line', () => {
    const src = 'before\n\n$$\nx\n$$';
    const parsed = parseDocument(src);
    const above = src.indexOf('\n\n$$');
    const found = adjacentDisplayMath(parsed, above, 'down');
    expect(found).not.toBeNull();
    expect(src.slice(found?.from, found?.to)).toContain('$$');
  });

  it('finds the block above the caret line', () => {
    const src = '$$\nx\n$$\nafter';
    const parsed = parseDocument(src);
    const below = src.indexOf('after');
    expect(adjacentDisplayMath(parsed, below, 'up')).not.toBeNull();
  });

  it('returns nothing when the neighbour is plain prose', () => {
    const src = 'a\n\nb';
    const parsed = parseDocument(src);
    expect(adjacentDisplayMath(parsed, src.indexOf('\n\n'), 'down')).toBeNull();
  });

  it('stops at intervening prose', () => {
    // A blank line may separate the caret from the block, but a paragraph may not.
    const src = 'a\n\nprose\n\nmore text\n\n$$\nx\n$$';
    const parsed = parseDocument(src);
    expect(adjacentDisplayMath(parsed, src.indexOf('prose') + 5, 'down')).toBeNull();
  });
});
