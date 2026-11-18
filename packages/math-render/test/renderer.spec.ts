import { describe, expect, it } from 'vitest';
import { createMathRenderer } from '../src/index.js';

const renderer = createMathRenderer({ adaptor: 'node' });

type Case = readonly [name: string, tex: string, display: boolean];

/**
 * Capability corpus. Every entry must render without a TeX error. This is the
 * regression net for the product promise "expression power close to LaTeX":
 * if a real paper construct stops rendering, it lands here.
 */
const CORPUS: readonly Case[] = [
  ['inline', 'E = mc^2 + \\frac{a}{b}', false],
  ['bm-latin', '\\bm{x} + \\bm{y}', false],
  ['bm-greek', '\\bm{\\alpha} \\otimes \\beta', false],
  ['mathbb', 'x \\in \\mathbb{R}^{n}', false],
  ['frak', '\\mathfrak{g}', false],
  ['script', '\\mathscr{L}', false],
  ['mathcal', '\\mathcal{L}(V)', false],
  ['mathbf', '\\mathbf{v} \\cdot \\mathbf{w}', false],
  ['align', '\\begin{align} a &= b + c \\\\ d &= e \\end{align}', true],
  ['align-star', '\\begin{align*} a &= b \\end{align*}', true],
  ['gather', '\\begin{gather} a = b \\\\ c = d \\end{gather}', true],
  ['multline', '\\begin{multline} a + b + c \\\\ + d + e \\end{multline}', true],
  ['split', '\\begin{equation} \\begin{split} a &= b \\\\ &= c \\end{split} \\end{equation}', true],
  ['cases', 'f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}', true],
  ['nested-matrix', '\\begin{pmatrix} \\begin{matrix} 1 & 2 \\end{matrix} & 3 \\end{pmatrix}', true],
  ['intertext', '\\begin{align} a &= b \\\\ \\intertext{and so} c &= d \\end{align}', true],
  ['substack', '\\sum_{\\substack{i=1 \\\\ j=2}} a_{ij}', true],
  ['operatorname-star', '\\operatorname*{arg\\,min}_{x} f(x)', false],
  ['coloneqq', 'x \\coloneqq y', false],
  ['newcommand-inline', '\\newcommand{\\nR}{\\mathbb{R}} x \\in \\nR', false],
  ['def-inline', '\\def\\nN{\\mathbb{N}} n \\in \\nN', false],
  ['tag', 'a = b \\tag{2.7}', true],
  ['overbrace', '\\overbrace{a + b}^{n}', false],
  ['xrightarrow', 'A \\xrightarrow{f} B', false],
  ['text-cjk', '\\text{当 } x > 0 \\text{ 时}', false],
  ['units', '5\\,\\mathrm{ms}', false],
];

describe('math corpus', () => {
  it.each(CORPUS)('%s renders an svg without a TeX error', (_name, tex, display) => {
    const out = renderer.render(tex, { display });
    expect(out.html).toContain('<svg');
    expect(out.error).toBeUndefined();
  });

  it('emits self-contained markup with no external resource references', () => {
    const out = renderer.render('\\begin{align} a &= \\mathbb{R} \\end{align}', {
      display: true,
    });
    // xmlns attributes are URIs but not fetched; anything else would break offline use.
    expect(out.html).not.toMatch(/xlink:href="https?:/);
    expect(out.html).not.toMatch(/<image[^>]+href="https?:/);
    expect(out.html).not.toMatch(/url\(\s*['"]?https?:/);
  });

  it('ships the stylesheet the SVG output needs', () => {
    expect(renderer.styles()).toContain('<style');
    expect(renderer.styles().length).toBeGreaterThan(100);
  });
});

describe('capability gaps that are deliberate', () => {
  it('renders an unknown macro as an inline error instead of throwing', () => {
    const fresh = createMathRenderer({ adaptor: 'node' });
    // `noundefined` turns unknown macros into red text, so rendering survives
    // an incomplete macro table; core turns this into an UnknownMacro diagnostic.
    const out = fresh.render('\\notARealMacro{x}', { display: false });
    expect(out.html).toContain('<svg');
  });

  it('reports a TeX error without throwing and still returns markup', () => {
    const fresh = createMathRenderer({ adaptor: 'node' });
    const out = fresh.render('\\frac{1}{', { display: false });
    expect(out.html).toContain('<svg');
    expect(out.error).toBeTypeOf('string');
    expect(out.error?.length).toBeGreaterThan(0);
  });
});

describe('caching', () => {
  it('returns the identical result object for a repeated formula', () => {
    const r = createMathRenderer({ adaptor: 'node' });
    const first = r.render('x^2 + y^2', { display: false });
    const second = r.render('x^2 + y^2', { display: false });
    expect(second).toBe(first);
    expect(r.stats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('keys the cache on display mode', () => {
    const r = createMathRenderer({ adaptor: 'node' });
    r.render('x^2', { display: false });
    r.render('x^2', { display: true });
    expect(r.stats()).toMatchObject({ hits: 0, misses: 2 });
  });

  it('evicts oldest entries beyond the cache limit', () => {
    const r = createMathRenderer({ adaptor: 'node', cacheLimit: 2 });
    r.render('a', { display: false });
    r.render('b', { display: false });
    r.render('c', { display: false });
    expect(r.stats().cached).toBe(2);
  });

  it('serves cached renders dramatically faster than cold ones', () => {
    const r = createMathRenderer({ adaptor: 'node' });
    const cold = performance.now();
    for (let i = 0; i < 60; i += 1) r.render(`x_{${i}} + y^{${i}}`, { display: false });
    const coldMs = performance.now() - cold;

    const warm = performance.now();
    for (let i = 0; i < 600; i += 1) r.render(`x_{${i % 60}} + y^{${i % 60}}`, { display: false });
    const warmMs = performance.now() - warm;

    expect(warmMs).toBeLessThan(coldMs);
  });
});

describe('engine sharing', () => {
  it('supports several renderer instances in one process', () => {
    // Regression: a second SVG output jax used to recurse forever in
    // FontData.getChar because MathJax stores resolved font data on the class.
    const a = createMathRenderer({ adaptor: 'node' });
    const b = createMathRenderer({ adaptor: 'node' });
    expect(a.render('\\mathbb{R}', { display: false }).error).toBeUndefined();
    expect(b.render('\\mathbb{R}', { display: false }).error).toBeUndefined();
    expect(b.render('\\bm{x} + \\mathfrak{g}', { display: false }).error).toBeUndefined();
  });

  it('never returns a promise from render', () => {
    // Synchronous by contract: the editor renders inside toDOM().
    const r = createMathRenderer({ adaptor: 'node' });
    const out = r.render('x', { display: false });
    expect(typeof (out as unknown as { then?: unknown }).then).toBe('undefined');
  });
});

describe('macros', () => {
  /**
   * Local font cache assigns per-render ids and MathJax echoes the source in
   * `data-latex`; neither is semantically meaningful for equivalence checks.
   */
  const norm = (html: string): string =>
    html.replace(/MJX-[A-Za-z0-9-]+/g, 'MJX').replace(/data-latex="[^"]*"/g, 'data-latex=""');

  it('provides \\bm by default (MathJax does not ship the bm package)', () => {
    const r = createMathRenderer({ adaptor: 'node' });
    const bm = r.render('\\bm{A}', { display: false });
    const boldsymbol = r.render('\\boldsymbol{A}', { display: false });
    expect(bm.error).toBeUndefined();
    // \bm must behave exactly like \boldsymbol, not degrade to red undefined text.
    expect(norm(bm.html)).toBe(norm(boldsymbol.html));
  });

  it('lets a document override a default macro', () => {
    const r = createMathRenderer({ adaptor: 'node' });
    r.setMacros({ '\\foo': '\\mathbb{R}' });
    const out = r.render('\\foo', { display: false });
    const direct = r.render('\\mathbb{R}', { display: false });
    expect(out.error).toBeUndefined();
    expect(norm(out.html)).toBe(norm(direct.html));
  });

  it('accepts macro names with or without a leading backslash', () => {
    const withSlash = createMathRenderer({ adaptor: 'node' });
    withSlash.setMacros({ '\\zz': 'z_1' });
    const a = withSlash.render('\\zz', { display: false });

    const withoutSlash = createMathRenderer({ adaptor: 'node' });
    withoutSlash.setMacros({ zz: 'z_1' });
    const b = withoutSlash.render('\\zz', { display: false });

    expect(norm(a.html)).toBe(norm(b.html));
    expect(withSlash.macros).toEqual({ '\\bm': ['\\boldsymbol{#1}', 1], '\\zz': 'z_1' });
  });

  it('keeps cached entries per macro table after switching', () => {
    const r = createMathRenderer({ adaptor: 'node' });
    const a = r.render('\\w', { display: false });
    r.setMacros({ '\\w': 'w_1' });
    const b = r.render('\\w', { display: false });
    r.setMacros({});
    const aAgain = r.render('\\w', { display: false });
    expect(norm(b.html)).not.toBe(norm(a.html));
    expect(aAgain).toBe(a); // cache hit across macro-table switches
  });
});
