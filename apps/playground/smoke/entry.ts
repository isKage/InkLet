import { createMathRenderer } from '@inklet/math-render';
import {
  createAcademicParser,
  dumpTree,
  extractMathSource,
  parseDocument,
  NodeNames,
} from '@inklet/academic-md-core';

// Built as an IIFE and executed by `scripts/smoke.mjs` inside jsdom: this is the
// only check that exercises the *bundled* browser code path (adaptor + font
// variant tree-shaking + the Lezer dialect), which the Node tests cannot cover.
const renderer = createMathRenderer({ adaptor: 'browser' });

const mathbb = renderer.render('\\mathbb{R}', { display: false });
const bm = renderer.render('\\bm{\\alpha}', { display: false });
const display = renderer.render('\\begin{align} a &= b \\\\ c &= d \\end{align}', { display: true });

const parser = createAcademicParser();
const doc = [
  '# Title',
  '',
  'Inline $a_i + b_i$ and a price trap: $5 and $10.',
  '',
  '## Method',
  '',
  'Body with a list:',
  '',
  '- one',
  '- two',
  '',
  '$$',
  '\\begin{align} x &= y \\\\ u &= v \\end{align}',
  '$$',
].join('\n');
const tree = parser.parse(doc);
const maths: { name: string; tex: string }[] = [];
const headings: string[] = [];
tree.iterate({
  enter(node) {
    if (node.name === NodeNames.InlineMath || node.name === NodeNames.DisplayMath) {
      maths.push({ name: node.name, tex: extractMathSource(doc, node.node) });
    } else if (node.name === 'ATXHeading2') {
      headings.push(doc.slice(node.from, node.to));
    }
  },
});

const semantics = parseDocument(doc);

Object.assign(globalThis, {
  __INKLET_SMOKE__: {
    engine: renderer.engine,
    stylesLen: renderer.styles().length,
    mathbb,
    bm,
    display,
    maths,
    headings,
    semantics: {
      headings: semantics.headings.map((h) => [h.level, h.text]),
      diagnostics: semantics.diagnostics.map((d) => d.code),
      macros: Object.keys(semantics.macros),
    },
    dumpLen: dumpTree(doc, tree).length,
    treeLength: tree.length,
    docLength: doc.length,
  },
});
