import { describe, expect, it } from 'vitest';
import { createAcademicParser, extractMathSource, NodeNames } from '../src/index.js';

const parser = createAcademicParser();

interface MathHit {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly tex: string;
}

/** Every inline/display maths node in the document, with its TeX source. */
function maths(src: string): MathHit[] {
  const tree = parser.parse(src);
  const hits: MathHit[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== NodeNames.InlineMath && node.name !== NodeNames.DisplayMath) return;
      hits.push({
        name: node.name,
        from: node.from,
        to: node.to,
        tex: extractMathSource(src, node.node),
      });
    },
  });
  return hits;
}

function names(src: string): string[] {
  const tree = parser.parse(src);
  const found: string[] = [];
  tree.iterate({ enter: (node) => void found.push(node.name) });
  return found;
}

describe('inline maths', () => {
  it('parses a simple span and strips the delimiters', () => {
    const [hit, ...rest] = maths('a $x^2$ b');
    expect(rest).toHaveLength(0);
    expect(hit).toMatchObject({ name: NodeNames.InlineMath, from: 2, to: 7, tex: 'x^2' });
  });

  it('parses several spans on one line', () => {
    expect(maths('$a$ and $b$').map((m) => m.tex)).toEqual(['a', 'b']);
  });

  it('keeps brackets and braces as content', () => {
    expect(maths('$[a, b] \\cup \\{c\\}$')[0]?.tex).toBe('[a, b] \\cup \\{c\\}');
  });

  it('does not let emphasis parse inside maths', () => {
    const found = names('$a_b * c$ and *real*');
    expect(found).toContain(NodeNames.InlineMath);
    expect(found.filter((n) => n === 'Emphasis')).toHaveLength(1); // only the outer one
  });

  it('lets a backslash escape a dollar inside the span', () => {
    expect(maths('$a\\$b$')[0]?.tex).toBe('a\\$b');
  });

  it('leaves prose prices alone', () => {
    expect(maths('costs $5 and $10 total')).toHaveLength(0);
  });

  it('rejects an unclosed span', () => {
    expect(maths('$x is not maths')).toHaveLength(0);
  });

  it('rejects whitespace right after the opener', () => {
    expect(maths('$ x$')).toHaveLength(0);
  });

  it('rejects whitespace right before the closer', () => {
    expect(maths('$x $')).toHaveLength(0);
  });

  it('never spans a line break', () => {
    expect(maths('$x\n$')).toHaveLength(0);
  });

  it('ignores maths inside a code span', () => {
    expect(maths('`$x$`')).toHaveLength(0);
  });

  it('ignores an escaped opener', () => {
    expect(maths('\\$x\\$')).toHaveLength(0);
  });

  it('does not treat $$ mid-paragraph as inline maths', () => {
    expect(maths('a $$x$$ b')).toHaveLength(0);
  });
});

describe('display maths', () => {
  it('parses the single-line form and trims the content', () => {
    const src = '$$ a = b $$';
    const [hit] = maths(src);
    expect(hit).toMatchObject({ name: NodeNames.DisplayMath, from: 0, to: src.length, tex: 'a = b' });
  });

  it('parses the block form into one TeX source', () => {
    const src = '$$\na = b\nc = d\n$$';
    const [hit] = maths(src);
    expect(hit).toMatchObject({ name: NodeNames.DisplayMath, from: 0, to: src.length });
    expect(hit?.tex).toBe('a = b\nc = d');
  });

  it('keeps amsmath environments intact', () => {
    const body = '\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}';
    const [hit] = maths(`$$\n${body}\n$$`);
    expect(hit?.tex).toBe(body);
  });

  it('interrupts a paragraph, like a fence does', () => {
    const src = 'before\n$$\nx\n$$\nafter';
    const [hit] = maths(src);
    expect(hit?.tex).toBe('x');
    const found = names(src);
    expect(found.filter((n) => n === 'Paragraph')).toHaveLength(2);
    expect(found.filter((n) => n === NodeNames.DisplayMath)).toHaveLength(1);
  });

  it('nests inside a list item', () => {
    const src = '- item\n  $$\n  x = 1\n  $$';
    const [hit] = maths(src);
    expect(hit?.tex).toBe('x = 1');
    expect(names(src)).toContain('ListItem');
  });

  it('nests inside a blockquote and keeps the quote markers in the tree', () => {
    const src = '> $$\n> x = 1\n> $$';
    const [hit] = maths(src);
    expect(hit?.tex).toBe('x = 1');
    expect(names(src)).toContain('Blockquote');
  });

  it('does not swallow following blocks when a quote ends unclosed', () => {
    const src = '> $$\n> x\nafter';
    const [hit] = maths(src);
    expect(hit?.tex).toBe('x');
    expect(names(src)).toContain('Paragraph');
    expect(src.slice(hit?.from, hit?.to)).not.toContain('after');
  });

  it('runs an unclosed block to the end without throwing', () => {
    const src = '$$\nx = 1';
    const [hit] = maths(src);
    expect(hit).toMatchObject({ from: 0, to: src.length, tex: 'x = 1' });
  });

  it('ignores fences and dollars inside a fenced code block', () => {
    const src = '```md\n$$\nx\n$$\n```';
    expect(maths(src)).toHaveLength(0);
    expect(names(src)).toContain('FencedCode');
  });

  it('leaves four-space-indented dollars to the code block parser', () => {
    expect(maths('    $$\n    x\n    $$')).toHaveLength(0);
  });

  it('treats blank content lines as empty, not as content', () => {
    const [hit] = maths('$$\na\n\nb\n$$');
    expect(hit?.tex).toBe('a\nb');
  });

  it('accepts a closing fence followed by trailing spaces', () => {
    const [hit] = maths('$$\nx\n$$   ');
    expect(hit?.tex).toBe('x');
  });
});

describe('robustness', () => {
  it('handles CRLF line endings', () => {
    const src = '$$\r\na = b\r\n$$';
    const [hit] = maths(src);
    expect(hit?.tex).toBe('a = b');
  });

  it('treats $$$$ as an empty single-line block', () => {
    const [hit] = maths('$$$$');
    expect(hit).toMatchObject({ name: NodeNames.DisplayMath, from: 0, to: 4, tex: '' });
  });

  it('keeps a dollar inside display content', () => {
    const [hit] = maths('$$\n\\text{costs \\$5}\n$$');
    expect(hit?.tex).toBe('\\text{costs \\$5}');
  });

  it('stops an unclosed block at the end of its list item', () => {
    const src = '- $$\n  x\n\noutside';
    const [hit] = maths(src);
    expect(hit?.tex).toBe('x');
    expect(names(src).filter((n) => n === 'Paragraph').length).toBeGreaterThanOrEqual(1);
  });

  it('parses a document with many formulas in linear-ish time', () => {
    const block = [
      '# Section',
      '',
      'Some prose with $a_i + b_i$ and more text that keeps the line long enough.',
      '',
      '$$',
      '\\begin{align} x &= y \\\\ u &= v \\end{align}',
      '$$',
      '',
    ].join('\n');
    const doc = block.repeat(60);
    expect(doc.length).toBeGreaterThan(6000);
    const started = Date.now();
    const tree = parser.parse(doc);
    const elapsed = Date.now() - started;
    expect(tree.length).toBe(doc.length);
    expect(elapsed).toBeLessThan(500);
  });
});

describe('LaTeX bracket display maths', () => {
  it('parses the single-line form', () => {
    const [hit] = maths('\\[ a = b \\]');
    expect(hit).toMatchObject({ name: NodeNames.DisplayMath, tex: 'a = b' });
  });

  it('parses the block form', () => {
    const src = '\\[\na = b\nc = d\n\\]';
    const [hit] = maths(src);
    expect(hit).toMatchObject({ from: 0, to: src.length, tex: 'a = b\nc = d' });
  });

  it('interrupts a paragraph like the $$ form', () => {
    const [hit] = maths('before\n\\[\nx\n\\]\nafter');
    expect(hit?.tex).toBe('x');
    expect(names('before\n\\[\nx\n\\]\nafter').filter((n) => n === 'Paragraph')).toHaveLength(2);
  });

  it('runs an unclosed bracket block to the end of its block', () => {
    const src = '\\[\nx = 1';
    const [hit] = maths(src);
    expect(hit).toMatchObject({ from: 0, to: src.length, tex: 'x = 1' });
  });

  it('keeps prose brackets alone', () => {
    expect(maths('区间 \\[0,1\\] 是紧的')).toHaveLength(0);
  });
});

describe('bracket closer rules', () => {
  it('is not display maths when prose follows the closer', () => {
    expect(maths('\\[ a \\] trailing')).toHaveLength(0);
  });

  it('keeps prose brackets alone', () => {
    expect(maths('区间 \\[0,1\\] 是紧的')).toHaveLength(0);
  });
});
