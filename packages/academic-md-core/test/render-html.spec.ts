import { describe, expect, it } from 'vitest';
import { parseDocument, renderHTML, renderNodeHTML } from '../src/index.js';

const mathStub = (tex: string, options: { display: boolean }): { html: string } => ({
  html: `<svg data-display="${options.display}">${tex}</svg>`,
});

function render(src: string, opts?: Parameters<typeof renderHTML>[1]): string {
  return renderHTML(parseDocument(src), { renderMath: mathStub, ...opts });
}

describe('block rendering', () => {
  it('renders headings', () => {
    expect(render('## 方法')).toContain('<h2>方法</h2>');
    expect(render('## Linear Operators')).toContain('<h2>Linear Operators</h2>');
  });

  it('renders paragraphs and inline emphasis', () => {
    expect(render('a **b** and *c*')).toContain('<p>a <strong>b</strong> and <em>c</em></p>');
  });

  it('renders lists without a redundant paragraph wrapper', () => {
    const html = render('- one\n- two');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
  });

  it('renders blockquotes and code', () => {
    expect(render('> quoted')).toContain('<blockquote><p>quoted</p></blockquote>');
    expect(render('```js\nlet a = 1\n```')).toContain(
      '<pre><code class="language-js">let a = 1</code></pre>'
    );
  });

  it('renders tables', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<thead><tr><th>a</th><th>b</th></tr></thead>');
    expect(html).toContain('<tbody><tr><td>1</td><td>2</td></tr></tbody>');
  });

  it('escapes raw HTML from the source', () => {
    const html = render('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('links and anchors', () => {
  it('renders a link as a real anchor', () => {
    expect(render('[GPT](https://example.com)')).toContain(
      '<a class="link" href="https://example.com">GPT</a>'
    );
  });

  it('keeps a link without a target as text', () => {
    expect(render('[label]()')).toContain('<span class="link">label</span>');
  });

  it('renders autolinks', () => {
    expect(render('<https://example.com/x>')).toContain(
      '<a class="link" href="https://example.com/x">https://example.com/x</a>'
    );
  });

  it('turns <id:xxx> into an empty anchor', () => {
    expect(render('see <id:sec1> here')).toContain('<a class="anchor" id="sec1"></a>');
  });

  it('escapes the href', () => {
    expect(render('[x](https://a.example/?a=1&b=2)')).toContain(
      'href="https://a.example/?a=1&amp;b=2"'
    );
  });
});

describe('maths rendering', () => {
  it('delegates inline maths to the injected renderer', () => {
    expect(render('a $x^2$ b')).toContain('<svg data-display="false">x^2</svg>');
  });

  it('delegates display maths', () => {
    const html = render('$$\nx = 1\n$$');
    expect(html).toContain('<svg data-display="true">x = 1</svg>');
  });

  it('falls back to readable source without a renderer', () => {
    const html = renderHTML(parseDocument('a $x$ b'));
    expect(html).toContain('<code class="math-source">x</code>');
  });

  it('marks a failed formula instead of breaking the page', () => {
    const html = renderHTML(parseDocument('$\\frac{1}{$'), {
      renderMath: () => ({ html: '', error: 'Missing close brace' }),
    });
    expect(html).toContain('class="math-error"');
    expect(html).toContain('Missing close brace');
  });
});

describe('single block rendering', () => {
  it('renders one table node', () => {
    const source = '| a | b |\n|---|---|\n| 1 | 2 |';
    const doc = parseDocument(source);
    let table;
    doc.tree.iterate({
      enter(node) {
        if (node.name === 'Table') table = node.node;
      },
    });
    expect(table).toBeDefined();
    const html = renderNodeHTML(doc, table!, { renderMath: mathStub });
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>2</td>');
  });
});

describe('robustness', () => {
  it('renders a whole fragment without dropping text', () => {
    const src = [
      '# Title',
      '',
      'Paragraph with $a$ and a list:',
      '',
      '- item',
      '',
      '| a |',
      '|---|',
      '| 1 |',
      '',
      '```',
      'code',
      '```',
      '---',
    ].join('\n');
    const html = render(src);
    expect(html).toContain('<h1');
    expect(html).toContain('Paragraph with');
    expect(html).toContain('<li>item</li>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<div>');
  });

  it('escapes raw HTML in code fences', () => {
    const html = render('```\n<script>alert(1)</script>\n```');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('code highlighting', () => {
  const doc = parseDocument('```python\nprint(1)\n```');

  it('calls the injected highlighter with the info string', () => {
    const seen: Array<[string, string | null]> = [];
    const html = renderHTML(doc, {
      highlight: (code, language) => {
        seen.push([code, language]);
        return '<span class="hljs-keyword">print</span>(1)';
      },
    });
    expect(seen).toEqual([['print(1)', 'python']]);
    expect(html).toContain('<span class="hljs-keyword">print</span>');
  });

  it('falls back to escaped text, and never highlights an untagged block', () => {
    const calls: Array<string | null> = [];
    const plain = renderHTML(parseDocument('```\n<a>\n```'), {
      highlight: (code, language) => {
        calls.push(language);
        return 'ignored';
      },
    });
    // No language means nothing to highlight, so the highlighter is not asked.
    expect(calls).toEqual([]);
    expect(plain).toContain('&lt;a&gt;');
  });

  it('keeps the language as a class for styling', () => {
    expect(renderHTML(doc)).toContain('class="language-python"');
  });
});
