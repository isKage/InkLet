import type { Tree } from '@lezer/common';
import { NodeNames } from './syntax/nodes.js';
import type { Diagnostic, HeadingAnchor, MacroTable, MacroValue } from './types.js';

/**
 * The pass between the syntax tree and everything that consumes it.
 *
 * Two jobs only: collect the headings the outline lists, and report unclosed
 * display maths. Numbering, environments and cross references used to live
 * here; they belong to a feature set the editor no longer offers.
 *
 * Macros come from the front matter (see `parseFrontMatter`); `\newcommand`
 * blocks inside the body went away with the `::: macros` environment.
 */

const HEADING_NAMES: Readonly<Record<string, number>> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
};

function headingLevel(name: string): number | null {
  return HEADING_NAMES[name] ?? null;
}

/** Heading text without `##`, the closing `#`s and inline markup noise. */
export function headingText(raw: string): string {
  return raw
    .replace(/^#{1,6}[ \t]*/, '')
    .replace(/[ \t]+#+[ \t]*$/, '')
    .trim();
}

export interface AnalysisInput {
  readonly src: string;
  readonly tree: Tree;
  /** Nodes ending before this offset are ignored (front matter). */
  readonly bodyFrom: number;
  /** Macros from the front matter and the workspace; the document wins. */
  readonly baseMacros: MacroTable;
  readonly frontMatterDiagnostics: readonly Diagnostic[];
}

export interface AnalysisResult {
  readonly headings: readonly HeadingAnchor[];
  readonly diagnostics: readonly Diagnostic[];
  readonly macros: MacroTable;
}

export function analyze(input: AnalysisInput): AnalysisResult {
  const { src, tree, bodyFrom } = input;

  const headings: HeadingAnchor[] = [];
  const diagnostics: Diagnostic[] = [...input.frontMatterDiagnostics];
  const macros: Record<string, MacroValue> = { ...input.baseMacros };

  tree.iterate({
    enter(node) {
      if (node.to <= bodyFrom) return false;

      if (node.name === NodeNames.DisplayMath) {
        // A block without both `$$` marks was never closed.
        let marks = 0;
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (child.name === NodeNames.MathMark) marks += 1;
        }
        if (marks < 2) {
          diagnostics.push({
            severity: 'error',
            code: 'BadMath',
            message: '公式块未闭合',
            from: node.from,
            to: Math.min(node.to, node.from + 2),
          });
        }
        return false;
      }

      const level = headingLevel(node.name);
      if (level !== null) {
        headings.push({
          level,
          text: headingText(src.slice(node.from, node.to)),
          from: node.from,
          to: node.to,
        });
        return false;
      }

      return undefined;
    },
  });

  return { headings, diagnostics, macros };
}
