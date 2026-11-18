import { createMathRenderer } from '@inklet/math-render';
import { SAMPLES } from './samples.js';
import { mountSyntaxPanel } from './syntax-panel.js';

const renderer = createMathRenderer();

// MathJax's SVG output ships its own stylesheet (display centring, container
// metrics). Injecting it once is all the embedding page needs to do.
const style = document.createElement('style');
style.textContent = renderer.styles();
document.head.append(style);

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const meta = $('meta');
const gallery = $('gallery');

let galleryMs = 0;
let errors = 0;

for (const sample of SAMPLES) {
  const row = document.createElement('div');
  row.className = 'row';

  const src = document.createElement('code');
  src.textContent = `${sample.display ? '\\\\[ … \\\\]' : '$ … $'}\n${sample.tex}`;

  const out = document.createElement('div');
  out.className = 'out';

  const started = performance.now();
  const rendered = renderer.render(sample.tex, { display: sample.display });
  galleryMs += performance.now() - started;

  if (rendered.error) errors += 1;
  out.innerHTML = rendered.html;
  if (rendered.error) {
    const note = document.createElement('div');
    note.className = 'err';
    note.textContent = `TeX error: ${rendered.error} (expected for the error sample)`;
    out.append(note);
  }

  row.append(src, out);
  gallery.append(row);
}

const stats = renderer.stats();
meta.textContent = `${renderer.engine} · ${SAMPLES.length} samples · ${errors} expected error · ${galleryMs.toFixed(0)}ms cold · ${stats.misses} misses`;

// --- live input: measure the keystroke path the editor will use.
const liveIn = $<HTMLTextAreaElement>('liveIn');
const liveOut = $('liveOut');
const liveStats = $('stats');

liveIn.value = '\\mathbb{E}\\left[ \\sum_{i=1}^{n} \\bm{x}_i \\right]';
let lastMs = 0;

function renderLive(): void {
  const started = performance.now();
  const rendered = renderer.render(liveIn.value, { display: true });
  lastMs = performance.now() - started;
  liveOut.innerHTML = rendered.html;
  const s = renderer.stats();
  liveStats.textContent = `${lastMs.toFixed(2)}ms · hits ${s.hits} / misses ${s.misses} · cached ${s.cached}${
    rendered.error ? ` · error: ${rendered.error}` : ''
  }`;
}

liveIn.addEventListener('input', renderLive);
renderLive();

mountSyntaxPanel();
