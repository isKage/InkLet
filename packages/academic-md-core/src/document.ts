import { academicParser } from './parser.js';
import { parseFrontMatter } from './front-matter.js';
import { analyze } from './analysis.js';
import type { ParseOptions, ParsedDocument } from './types.js';

/**
 * The single entry point that turns Markdown text into document semantics.
 *
 * Pure: no DOM, no I/O, no editor — so the same call backs the preview, the
 * outline and the exporter. Everything it returns is derived from the source;
 * nothing is persisted, which is what keeps a `.md` file shareable.
 */
export function parseDocument(src: string, opts: ParseOptions = {}): ParsedDocument {
  const frontMatter = parseFrontMatter(src);
  const tree = opts.tree ?? academicParser.parse(src);
  const analysis = analyze({
    src,
    tree,
    bodyFrom: frontMatter.bodyFrom,
    baseMacros: { ...(opts.workspaceMacros ?? {}), ...frontMatter.macros },
    frontMatterDiagnostics: frontMatter.diagnostics,
  });

  return {
    src,
    tree,
    macros: analysis.macros,
    headings: analysis.headings,
    diagnostics: analysis.diagnostics,
  };
}
