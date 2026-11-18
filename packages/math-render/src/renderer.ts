import { mathjax } from './fonts.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { browserAdaptor } from '@mathjax/src/js/adaptors/browserAdaptor.js';
import { TEX_PACKAGES } from './fonts.js';
import type {
  AdaptorKind,
  MacroTable,
  MacroValue,
  MathRenderOptions,
  MathRenderer,
  MathRendererStats,
  RenderedMath,
} from './types.js';

/**
 * `\bm` comes from the LaTeX `bm` package, which MathJax does not ship.
 * Mapping it to `\boldsymbol` covers the documented uses (single symbols,
 * greek, and `\bm{A}`); it is a macro, so users can override it.
 */
export const DEFAULT_MACROS: MacroTable = {
  '\\bm': ['\\boldsymbol{#1}', 1],
};

const CACHE_LIMIT = 800;
const DISPLAY_WIDTH_EX = 900;

/** Structural view of whatever adaptor we picked; both expose these. */
interface AdaptorLike {
  outerHTML(node: unknown): string;
  textContent(node: unknown): string;
}

interface Engine {
  readonly adaptor: AdaptorLike;
  readonly document: { convert(math: string, options: Record<string, unknown>): unknown };
  readonly styles: string;
}

const registered = new Set<AdaptorKind>();
const adaptors = new Map<AdaptorKind, AdaptorLike>();

/**
 * Canonical macro names carry a leading backslash (`\bm`) because that is how
 * documents and the core parser refer to them. MathJax's own `macros` option
 * wants the *bare* name (`bm`); passing the backslash silently registers an
 * unreachable macro, which is a bug we hit and now guard with tests.
 */
function toCanonical(macros: MacroTable): Record<string, MacroValue> {
  const out: Record<string, MacroValue> = {};
  for (const [key, value] of Object.entries(macros)) {
    out[key.startsWith('\\') ? key : `\\${key}`] = value;
  }
  return out;
}

function toMathJaxMacros(macros: MacroTable): Record<string, MacroValue> {
  const out: Record<string, MacroValue> = {};
  for (const [key, value] of Object.entries(macros)) {
    out[key.replace(/^\\+/, '')] = value;
  }
  return out;
}

function fingerprint(macros: MacroTable): string {
  return Object.keys(macros)
    .sort()
    .map((k) => `${k}=${JSON.stringify(macros[k])}`)
    .join(';');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function buildEngine(adaptor: AdaptorLike, kind: AdaptorKind, macros: MacroTable): Engine {
  const tex = new TeX({
    packages: [...TEX_PACKAGES],
    // Our own numbering pass owns equation numbers; MathJax must not add any.
    tags: 'none',
    macros: toMathJaxMacros(macros),
  });

  const svg = getOutputJax(kind);

  const html = mathjax.document('', { InputJax: tex, OutputJax: svg });
  const styleNode = svg.styleSheet(html);
  return {
    adaptor,
    document: html as unknown as Engine['document'],
    styles: adaptor.outerHTML(styleNode),
  };
}

/**
 * MathJax keeps resolved dynamic font data on the output jax *class*, so a
 * second SVG instance sees "already loading" markers it can never resolve and
 * recurses in `getChar`. One output jax per adaptor kind for the whole process.
 */
function makeOutputJax() {
  return new SVG({
    // Self-contained <defs> per formula: safe when widgets are mounted and
    // unmounted as the user scrolls.
    fontCache: 'local',
    // MathJax 4 splits inline maths at every break opportunity by default,
    // producing several <svg> joined by <mjx-break>. That breaks inline widget
    // baseline and height measurement inside CodeMirror.
    linebreaks: { inline: false },
  });
}

type OutputJax = ReturnType<typeof makeOutputJax>;

/**
 * MathJax keeps resolved dynamic font data on the output jax *class*, so a
 * second SVG instance sees "already loading" markers it can never resolve and
 * recurses in `getChar`. One output jax per adaptor kind for the whole process.
 */
const outputJaxes = new Map<AdaptorKind, OutputJax>();
function getOutputJax(kind: AdaptorKind): OutputJax {
  let jax = outputJaxes.get(kind);
  if (!jax) {
    jax = makeOutputJax();
    outputJaxes.set(kind, jax);
  }
  return jax;
}

function pickAdaptor(kind: AdaptorKind): { kind: AdaptorKind; adaptor: AdaptorLike } {
  const resolved: AdaptorKind =
    kind === 'auto' ? (typeof window === 'undefined' ? 'node' : 'browser') : kind;
  // One adaptor per kind: MathJax registers handlers globally, and the adaptor
  // that produced a node must be the one that serialises it back.
  let adaptor = adaptors.get(resolved);
  if (!adaptor) {
    adaptor =
      resolved === 'browser'
        ? (browserAdaptor() as unknown as AdaptorLike)
        : (liteAdaptor() as unknown as AdaptorLike);
    adaptors.set(resolved, adaptor);
  }
  return { kind: resolved, adaptor };
}

export function createMathRenderer(
  options: { readonly adaptor?: AdaptorKind; readonly cacheLimit?: number } = {}
): MathRenderer {
  const { kind, adaptor } = pickAdaptor(options.adaptor ?? 'auto');

  if (!registered.has(kind)) {
    RegisterHTMLHandler(adaptor as never);
    registered.add(kind);
  }

  const cacheLimit = options.cacheLimit ?? CACHE_LIMIT;
  const cache = new Map<string, RenderedMath>();
  let hits = 0;
  let misses = 0;

  let macros: MacroTable = toCanonical(DEFAULT_MACROS);
  let macrosKey = fingerprint(macros);
  let engine = buildEngine(adaptor, kind, macros);

  const remember = (key: string, value: RenderedMath): RenderedMath => {
    if (cache.size >= cacheLimit) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, value);
    return value;
  };

  return {
    engine: `mathjax-svg:${mathjax.version}`,

    render(tex: string, opts: MathRenderOptions): RenderedMath {
      const width = opts.containerWidth ?? DISPLAY_WIDTH_EX;
      const key = `${opts.display ? 'd' : 'i'}|${macrosKey}|${width}|${tex}`;
      const cached = cache.get(key);
      if (cached) {
        hits += 1;
        return cached;
      }
      misses += 1;

      const node = engine.document.convert(tex, {
        display: opts.display,
        em: 16,
        ex: 8,
        // Inline maths must never wrap: the editor measures it as one unit.
        containerWidth: opts.display ? width : 100_000,
      });
      const html = engine.adaptor.outerHTML(node);
      const match = /data-mjx-error="([^"]*)"/.exec(html);
      const error = match?.[1];
      return remember(key, error ? { html, error: decodeEntities(error) } : { html });
    },

    setMacros(next: MacroTable): void {
      macros = toCanonical({ ...DEFAULT_MACROS, ...next });
      macrosKey = fingerprint(macros);
      // Cached entries keep working: the key carries the macro fingerprint, so
      // switching tabs back and forth does not re-typeset anything.
      engine = buildEngine(adaptor, kind, macros);
    },

    get macros(): MacroTable {
      return macros;
    },

    styles(): string {
      return engine.styles;
    },

    clearCache(): void {
      cache.clear();
      hits = 0;
      misses = 0;
    },

    stats(): MathRendererStats {
      return { hits, misses, cached: cache.size };
    },
  };
}
