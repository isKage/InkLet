import type { Tree } from '@lezer/common';

/**
 * Domain model for the Markdown dialect.
 *
 * Invariant that governs this package: every field is *derived* from the source
 * text. Nothing here is persisted — a `.md` file remains the single source of
 * truth, so documents stay shareable and diffable.
 */

/**
 * Structurally identical to the type exported by `@inklet/math-render`.
 * Duplicated on purpose: core must not depend on a DOM-bound package, and the
 * two are related by structure, not by identity.
 */
export type MacroValue = string | readonly [string, number];
export type MacroTable = Readonly<Record<string, MacroValue>>;

export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export type DiagnosticCode =
  | 'UnknownMacro'
  | 'BadMath'
  | 'BadFrontMatter'
  | 'BadMacroDefinition'
  | 'UnconvertibleSyntax';

export interface Diagnostic extends SourceRange {
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: DiagnosticCode;
  readonly message: string;
}

/** One entry in the outline panel. */
export interface HeadingAnchor extends SourceRange {
  readonly level: number;
  readonly text: string;
}

export interface ParseOptions {
  readonly path?: string;
  /**
   * Pre-parsed tree. The editor passes the one CodeMirror already maintains
   * incrementally, so a keystroke costs analysis only instead of a full reparse.
   * Must have been produced by the same dialect (see `academicParser`).
   */
  readonly tree?: Tree;
  /** Macro table contributed by the workspace; document-level wins. */
  readonly workspaceMacros?: MacroTable;
}

/**
 * Result of parsing one document. `tree` carries source positions; everything
 * else is a projection of it that the editor and the exporter consume.
 */
export interface ParsedDocument {
  readonly src: string;
  readonly tree: Tree;
  readonly macros: MacroTable;
  readonly headings: readonly HeadingAnchor[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface ExportContext {
  /** TeX → SVG. Injected so the exporter never imports the editor. */
  readonly renderMath: (tex: string, options: { display: boolean }) => {
    readonly html: string;
    readonly error?: string;
  };
}
