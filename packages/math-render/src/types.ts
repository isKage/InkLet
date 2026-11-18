/**
 * Macro table shared with `academic-md-core`.
 *
 * `\newcommand`-style entries may be written with or without the leading
 * backslash; the renderer normalises keys before handing them to MathJax.
 * A tuple form carries the argument count, mirroring MathJax's own config shape.
 */
export type MacroValue = string | readonly [string, number];
export type MacroTable = Readonly<Record<string, MacroValue>>;

export interface MathRenderOptions {
  readonly display: boolean;
  /**
   * Layout width in `ex` units, used for display maths only. Omitted means
   * "wide enough not to wrap", which is what the editor wants.
   */
  readonly containerWidth?: number;
}

export interface RenderedMath {
  /** Self-contained `<mjx-container>` markup (local font cache, no external refs). */
  readonly html: string;
  /**
   * Present when TeX failed. The markup is still a valid (red) error rendering,
   * but callers usually prefer to show the raw source instead.
   */
  readonly error?: string;
}

export interface MathRendererStats {
  readonly hits: number;
  readonly misses: number;
  readonly cached: number;
}

export interface MathRenderer {
  readonly engine: string;
  /** Synchronous by design: every font variant is preloaded at import time. */
  render(tex: string, opts: MathRenderOptions): RenderedMath;
  /** Rebuilds the TeX input with a new macro table. Cached entries stay valid. */
  setMacros(macros: MacroTable): void;
  readonly macros: MacroTable;
  /** `<style>` markup required by the SVG output; inject once per document. */
  styles(): string;
  clearCache(): void;
  stats(): MathRendererStats;
}

export type AdaptorKind = 'auto' | 'node' | 'browser';
