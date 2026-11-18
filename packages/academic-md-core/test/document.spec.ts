import { describe, expect, it } from 'vitest';
import { academicParser, parseDocument } from '../src/index.js';
import type { ParsedDocument } from '../src/index.js';

const doc = (src: string, opts?: Parameters<typeof parseDocument>[1]): ParsedDocument =>
  parseDocument(src, opts);

const codes = (parsed: ParsedDocument): string[] => parsed.diagnostics.map((d) => d.code);

describe('headings', () => {
  it('lists headings in document order with their level and text', () => {
    const parsed = doc('# 一\n\n## 二\n\n### 三\n\n## 四');
    expect(parsed.headings.map((h) => [h.level, h.text])).toEqual([
      [1, '一'],
      [2, '二'],
      [3, '三'],
      [2, '四'],
    ]);
  });

  it('strips the closing hashes and the inline markup noise', () => {
    expect(doc('## 标题 ##').headings[0]?.text).toBe('标题');
    expect(doc('#\t缩进').headings[0]?.text).toBe('缩进');
  });

  it('does not treat `---` under a paragraph as a heading', () => {
    // Setext headings are disabled: `---` is a divider, not a promotion.
    const parsed = doc('文字\n\n---\n');
    expect(parsed.headings).toHaveLength(0);
  });
});

describe('diagnostics', () => {
  it('reports an unclosed maths block', () => {
    expect(codes(doc('$$\nx = 1'))).toContain('BadMath');
  });

  it('accepts a closed block', () => {
    expect(codes(doc('$$\nx = 1\n$$'))).toEqual([]);
  });

  it('reports a broken front matter', () => {
    expect(codes(doc('---\n: : :\n  bad\n---\n\ntext'))).toContain('BadFrontMatter');
  });
});

describe('front matter', () => {
  it('skips the block as content', () => {
    const src = ['---', 'language: en', '---', '', '# S', '', 'text'].join('\n');
    const parsed = doc(src);
    expect(parsed.headings.map((h) => h.text)).toEqual(['S']);
  });

  it('treats an unterminated --- as ordinary markdown', () => {
    const parsed = doc('---\njust text');
    expect(codes(parsed)).toEqual([]);
    expect(parsed.headings).toHaveLength(0);
  });

  it('reads macros from front matter', () => {
    const parsed = doc('---\nmacros:\n  RR: "\\\\mathbb{R}"\n---\n\ntext');
    expect(parsed.macros['\\RR']).toBe('\\mathbb{R}');
  });

  it('ignores unknown keys instead of rejecting the file', () => {
    const parsed = doc('---\nnumbering: sequential\nnonsense: 1\n---\n\ntext');
    expect(codes(parsed)).toEqual([]);
  });
});

describe('document shape', () => {
  const FRAGMENT = [
    '---',
    'language: zh',
    '---',
    '',
    '# 第一章',
    '',
    '见 $a^2$，且',
    '',
    '$$',
    'a = b',
    '$$',
    '',
    '- 列表项',
    '- 另一项',
    '',
    '| 甲 | 乙 |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```python',
    'print(1)',
    '```',
  ].join('\n');

  it('covers the whole document with the tree', () => {
    expect(doc(FRAGMENT).tree.length).toBe(FRAGMENT.length);
  });

  it('parses a realistic fragment without diagnostics', () => {
    const parsed = doc(FRAGMENT);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.headings).toHaveLength(1);
  });

  it('handles a ~190KB document in a few tens of milliseconds', () => {
    // Measured ~30ms median on this machine; the bound is loose so CI noise
    // cannot make it flaky.
    const block = (i: number): string =>
      [
        `# Section ${i}`,
        '',
        `Some prose with $a_i + b_i$ and a table below.`,
        '',
        '| 甲 | 乙 |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '$$',
        'x = 1',
        '$$',
        '',
        '```python',
        'print(1)',
        '```',
        '',
      ].join('\n');
    let src = '';
    for (let i = 0; i < 1200; i += 1) src += block(i);
    expect(src.length).toBeGreaterThan(150_000);

    const started = Date.now();
    const parsed = doc(src);
    const elapsed = Date.now() - started;
    expect(parsed.tree.length).toBe(src.length);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.headings).toHaveLength(1200);
    expect(elapsed).toBeLessThan(1000);
  });

  it('accepts a pre-parsed tree equivalent to parsing itself', () => {
    const withTree = parseDocument(FRAGMENT, { tree: academicParser.parse(FRAGMENT) });
    const withoutTree = parseDocument(FRAGMENT);
    expect(withTree.headings).toEqual(withoutTree.headings);
    expect(withTree.macros).toEqual(withoutTree.macros);
    expect(withTree.tree.length).toBe(withoutTree.tree.length);
  });
});

describe('thematic breaks', () => {
  const names = (src: string): string[] => {
    const found: string[] = [];
    parseDocument(src).tree.iterate({ enter: (node) => void found.push(node.name) });
    return found;
  };

  it('reads a --- under a paragraph as a rule, not a heading underline', () => {
    const found = names('文字\n\n---\n');
    expect(found).toContain('HorizontalRule');
    expect(found).not.toContain('SetextHeading2');
  });

  it('still recognises ATX headings', () => {
    expect(names('## 标题')).toContain('ATXHeading2');
  });
});
