import { describe, expect, it } from 'vitest';
import { parseDocument, renderHTML } from '@inklet/academic-md-core';
import { imageTargets, printDocument } from '../src/export.js';

describe('PDF export assembly', () => {
  it('wraps the rendered body in a standalone document', () => {
    const html = printDocument('elliptic.md', '<h1>标题</h1>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>elliptic.md</title>');
    expect(html).toContain('<h1>标题</h1>');
    // No external stylesheet: the file must print on its own.
    expect(html).not.toContain('<link');
  });

  it('escapes the title so a filename cannot break the markup', () => {
    const html = printDocument('<script>x</script>.md', '');
    expect(html).not.toContain('<script>');
  });

  it('collects image targets for inlining', () => {
    const parsed = parseDocument('![示意图](papers/figure.png)\n\n![另一个](img/a.png)');
    expect(imageTargets(parsed).sort()).toEqual(['img/a.png', 'papers/figure.png']);
  });

  it('inlines images as data URIs in the exported HTML', () => {
    const parsed = parseDocument('![示意图](papers/figure.png)');
    const body = renderHTML(parsed, {
      resolveImage: (target) => (target === 'papers/figure.png' ? 'data:image/png;base64,AAAA' : null),
    });
    expect(body).toContain('<img');
    expect(body).toContain('data:image/png;base64,AAAA');
    expect(body).not.toContain('image-placeholder');
  });

  it('falls back to a placeholder when an image cannot be read', () => {
    const parsed = parseDocument('![示意图](missing.png)');
    const body = renderHTML(parsed, { resolveImage: () => null });
    expect(body).toContain('image-placeholder');
    expect(body).not.toContain('<img');
  });
});
