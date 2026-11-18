/**
 * End-to-end check of the *bundled* browser path.
 *
 * 1. `vite build -c vite.smoke.config.ts` produces an IIFE bundle containing
 *    MathJax, the TeX packages and the preloaded font variants.
 * 2. This script evaluates that bundle inside jsdom (a real DOM, no ESM) and
 *    asserts the markup is not just present but actually carries glyph paths.
 *
 * The distinction matters: a tree-shaking regression would still produce
 * `<svg>` elements, just with empty/fallback glyphs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, '..', 'dist-smoke', 'smoke.js');
const code = readFileSync(bundlePath, 'utf8');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
dom.window.eval(code);

const smoke = dom.window.__INKLET_SMOKE__;
const failures = [];

const check = (name, condition, detail) => {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
};

check('bundle produced a result object', Boolean(smoke));
if (smoke) {
  check('engine reported', typeof smoke.engine === 'string', smoke.engine);
  check('stylesheet exported', smoke.stylesLen > 100, String(smoke.stylesLen));

  for (const key of ['mathbb', 'bm', 'display']) {
    const out = smoke[key];
    check(`${key} rendered`, typeof out?.html === 'string' && out.html.includes('<svg'));
    check(`${key} had no TeX error`, !out?.error, out?.error);
    check(`${key} is not red fallback text`, !/red/i.test(out?.html ?? ''));

    // Mount into the real DOM: this exercises the browser adaptor's node shape.
    const host = dom.window.document.createElement('div');
    host.innerHTML = out.html;
    dom.window.document.body.append(host);
    const svg = host.querySelector('svg');
    check(`${key} mounts an <svg> element`, Boolean(svg));
    const paths = host.querySelectorAll('path');
    check(`${key} carries glyph paths`, paths.length > 0, `${paths.length} paths`);
    const withGeometry = [...paths].filter((p) => (p.getAttribute('d') ?? '').length > 10);
    check(`${key} glyph paths have geometry`, withGeometry.length > 0);
  }

  // \mathbb{R} must use double-struck data; a stripped variant would fall back.
  const dd = /glyph|211D|𝕣/.test(smoke.mathbb.html) || smoke.mathbb.html.length > 400;
  check('double-struck data present', dd);

  // --- the Lezer dialect must bundle and behave identically in the browser.
  check('tree covers the whole document', smoke.treeLength === smoke.docLength, `${smoke.treeLength}/${smoke.docLength}`);
  check('tree dump produced', smoke.dumpLen > 100, String(smoke.dumpLen));
  const maths = smoke.maths ?? [];
  check('one inline span found', maths.filter((m) => m.name === 'InlineMath').length === 1);
  check('inline source extracted', maths.find((m) => m.name === 'InlineMath')?.tex === 'a_i + b_i');
  check('one display block found', maths.filter((m) => m.name === 'DisplayMath').length === 1);
  check(
    'align block preserved',
    (maths.find((m) => m.name === 'DisplayMath')?.tex ?? '').includes('\\begin{align}')
  );

  // --- headings and derived semantics must behave identically once bundled.
  const sem = smoke.semantics ?? {};
  check(
    'headings collected',
    JSON.stringify(sem.headings) === JSON.stringify([[1, 'Title'], [2, 'Method']]),
    JSON.stringify(sem.headings)
  );
  check(
    'the heading node is visible in the tree',
    JSON.stringify(smoke.headings) === JSON.stringify(['## Method']),
    JSON.stringify(smoke.headings)
  );
  check('no diagnostics', (sem.diagnostics ?? []).length === 0, JSON.stringify(sem.diagnostics));
}

if (failures.length > 0) {
  console.error('browser smoke FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`browser smoke OK · ${smoke.engine} · styles ${smoke.stylesLen}B · bundle ${(code.length / 1024).toFixed(0)}KB`);
