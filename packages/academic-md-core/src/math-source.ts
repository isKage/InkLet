import type { SyntaxNode } from '@lezer/common';
import { NodeNames } from './syntax/nodes.js';

/**
 * The TeX source of an `InlineMath`/`DisplayMath` node, with delimiters removed.
 *
 * Content is stored as one node per source line (blockquote/list markers can
 * interleave, so a single span would swallow them), hence the join.
 */
export function extractMathSource(src: string, node: SyntaxNode): string {
  const segments: string[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === NodeNames.MathContent) segments.push(src.slice(child.from, child.to));
  }
  return segments.join('\n');
}
