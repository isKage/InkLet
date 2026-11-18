import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import latex from 'highlight.js/lib/languages/latex';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * Syntax highlighting for fenced code blocks.
 *
 * Only the languages offered in the picker are registered: `highlight.js/lib/core`
 * plus an explicit list keeps roughly 100KB of unused grammars out of the bundle,
 * and makes "which tags are supported" a single readable table instead of a
 * guess about what a bundle happens to include.
 */

/** Everything the picker offers, in the order it shows them. */
export const CODE_LANGUAGES: ReadonlyArray<{ readonly tag: string; readonly label: string }> = [
  { tag: 'python', label: 'Python' },
  { tag: 'java', label: 'Java' },
  { tag: 'c', label: 'C' },
  { tag: 'cpp', label: 'C++' },
  { tag: 'csharp', label: 'C#' },
  { tag: 'javascript', label: 'JavaScript' },
  { tag: 'typescript', label: 'TypeScript' },
  { tag: 'latex', label: 'LaTeX' },
  { tag: 'markdown', label: 'Markdown' },
  { tag: 'bash', label: 'Bash' },
  { tag: 'sql', label: 'SQL' },
  { tag: 'json', label: 'JSON' },
  { tag: 'yaml', label: 'YAML' },
  { tag: 'xml', label: 'HTML / XML' },
  { tag: 'rust', label: 'Rust' },
  { tag: 'go', label: 'Go' },
];

const GRAMMARS: Readonly<Record<string, Parameters<typeof hljs.registerLanguage>[1]>> = {
  bash,
  c,
  cpp,
  csharp,
  go,
  java,
  javascript,
  json,
  latex,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

for (const [tag, grammar] of Object.entries(GRAMMARS)) hljs.registerLanguage(tag, grammar);

/** Fence tags that mean the same grammar, so `js` and `ts` also work by hand. */
const ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  cs: 'csharp',
  'c++': 'cpp',
  tex: 'latex',
  md: 'markdown',
  html: 'xml',
  yml: 'yaml',
};

/** Cache: the same block must not be re-tokenised on every decoration rebuild. */
const cache = new Map<string, string | null>();
const CACHE_LIMIT = 200;

/**
 * Tokenises one fenced block. Returns HTML that is already escaped, or `null`
 * when the language is unknown — the caller then shows the plain text, which is
 * better than guessing and colouring the wrong thing.
 */
export function highlightCode(code: string, language: string | null): string | null {
  if (!language) return null;
  const tag = ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  if (!hljs.getLanguage(tag)) return null;

  const cacheKey = `${tag}\u0000${code}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;

  let result: string | null;
  try {
    result = hljs.highlight(code, { language: tag, ignoreIllegals: true }).value;
  } catch {
    // A grammar that trips over its own input must not break the document.
    result = null;
  }

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(cacheKey, result);
  return result;
}
