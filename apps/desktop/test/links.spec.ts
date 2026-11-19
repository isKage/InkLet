import { describe, expect, it } from 'vitest';
import { resolveLink } from '../src/links.js';

const docText = 'intro\n\n<a id="x"></a>\n\nsee <id:sec1> and <id:方法> here.\n';
const context = {
  docText,
  fromRel: 'papers/note.md',
  files: ['papers/note.md', 'papers/a.md', 'notes/b.md', 'README.md'],
  root: '/work',
};

describe('link targets', () => {
  it('opens http, https and mailto links', () => {
    expect(resolveLink('https://example.com/x', context)).toEqual({
      kind: 'url',
      href: 'https://example.com/x',
    });
    expect(resolveLink('mailto:a@b.c', context)).toEqual({ kind: 'url', href: 'mailto:a@b.c' });
  });

  it('accepts a web address without https://', () => {
    expect(resolveLink('google.com', context)).toEqual({
      kind: 'url',
      href: 'https://google.com',
    });
    expect(resolveLink('www.example.com/search?q=1', context)).toEqual({
      kind: 'url',
      href: 'https://www.example.com/search?q=1',
    });
  });

  it('keeps file-like targets out of the web fallback', () => {
    expect(resolveLink('notes.md', context)).toEqual({ kind: 'none' });
    expect(resolveLink('data.csv', context)).toEqual({ kind: 'none' });
  });

  it('does not follow other schemes', () => {
    expect(resolveLink('javascript:alert(1)', context)).toEqual({ kind: 'none' });
    expect(resolveLink('data:text/html,hi', context)).toEqual({ kind: 'none' });
  });

  it('treats #id and a known bare id as in-document anchors', () => {
    expect(resolveLink('#sec1', context)).toEqual({ kind: 'anchor', id: 'sec1' });
    expect(resolveLink('sec1', context)).toEqual({ kind: 'anchor', id: 'sec1' });
    expect(resolveLink('方法', context)).toEqual({ kind: 'anchor', id: '方法' });
  });

  it('resolves a workspace file relative to the document that holds the link', () => {
    expect(resolveLink('a.md', context)).toEqual({ kind: 'file', rel: 'papers/a.md' });
    expect(resolveLink('../notes/b.md', context)).toEqual({ kind: 'file', rel: 'notes/b.md' });
    expect(resolveLink('a.md#part-2', context)).toEqual({ kind: 'file', rel: 'papers/a.md' });
  });

  it('accepts an absolute path inside the workspace and URL-encoded spaces', () => {
    expect(resolveLink('/work/README.md', context)).toEqual({ kind: 'file', rel: 'README.md' });
    const spaced = { ...context, files: ['papers/two words.md'] };
    expect(resolveLink('two%20words.md', spaced)).toEqual({
      kind: 'file',
      rel: 'papers/two words.md',
    });
  });

  it('does nothing for a file that is not in the workspace', () => {
    expect(resolveLink('missing.md', context)).toEqual({ kind: 'none' });
    expect(resolveLink('/elsewhere/x.md', context)).toEqual({ kind: 'none' });
    expect(resolveLink('', context)).toEqual({ kind: 'none' });
  });
});
