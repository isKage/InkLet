import type { MarkdownConfig } from '@lezer/markdown';
import { mathExtension } from './math.js';
import { formatExtension } from './format.js';

export { NodeNames } from './nodes.js';
export type { MathNodeName } from './nodes.js';
export { MATH_NODES, bracketMath, displayMath, inlineMath, mathExtension } from './math.js';
export { FORMAT_NODES, formatExtension, underline } from './format.js';

/**
 * The whole dialect as one config: maths plus the underline Markdown lacks.
 * Compose it with GFM (and anything else) via `parser.configure([...])`.
 */
export const academicMarkdown: MarkdownConfig = {
  defineNodes: [...(mathExtension.defineNodes ?? []), ...(formatExtension.defineNodes ?? [])],
  parseBlock: [...(mathExtension.parseBlock ?? [])],
  parseInline: [...(formatExtension.parseInline ?? []), ...(mathExtension.parseInline ?? [])],
};
