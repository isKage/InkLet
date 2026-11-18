/**
 * Side-effect module: registers TeX packages and preloads font variants.
 *
 * MUST be imported before any rendering happens.
 *
 * Why every font variant is imported statically: MathJax loads glyph path data
 * for secondary variants (double-struck, fraktur, script, bold greek, ...) on
 * demand through `mathjax.asyncLoad`, which requires a dynamic `import()` of a
 * package specifier. That resolves fine in Node but cannot be statically
 * analysed by Vite in the browser bundle. Preloading keeps typesetting fully
 * synchronous, which removes the async-placeholder machinery from the editor.
 *
 * Adding a variant is a deliberate size/coverage trade-off: see `docs/adr/0001`.
 */
import { mathjax } from '@mathjax/src/js/mathjax.js';

// --- TeX input packages (each package is registered by importing its config).
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/noundefined/NoUndefinedConfiguration.js';

// --- SVG font variants (subset: academic usage, ~1.4 MB of path data).
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/double-struck.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/fraktur.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/script.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/variants.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-b.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-bi.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/greek-ss.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols-b-i.js';

export const TEX_PACKAGES = [
  'base',
  'ams',
  'mathtools',
  'boldsymbol',
  'newcommand',
  'configmacros',
  'noundefined',
] as const;

// Every variant module above has already been evaluated, so the synchronous
// loader has nothing left to do. Missing variants degrade to fallback glyphs
// with a console warning instead of throwing.
mathjax.asyncIsSynchronous = true;
mathjax.asyncLoad = () => {};

export { mathjax };
