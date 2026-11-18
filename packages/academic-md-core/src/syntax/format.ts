import type { InlineContext, InlineParser, MarkdownConfig, NodeSpec } from '@lezer/markdown';
import { NodeNames } from './nodes.js';
import { BACKSLASH, NEWLINE, CARRIAGE, isBlankText } from './chars.js';

const PLUS = 43;

/**
 * `++underlined++`.
 *
 * Markdown has no underline, so the dialect defines one. A single node (rather
 * than raw `<u>` HTML) keeps it editable in the live preview, renderable by the
 * export, and mappable in the Pandoc filter later.
 *
 * Deliberately conservative, like inline maths: no empty content, no leading or
 * trailing whitespace, and never spans a line break, so prose with `C++` and
 * similar does not turn into formatting.
 */
export const underline: InlineParser = {
  name: 'Underline',
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== PLUS) return -1;
    if (cx.char(pos + 1) !== PLUS) return -1;
    // `+++` is not a delimiter run we want to interpret.
    if (cx.char(pos - 1) === PLUS) return -1;
    if (pos + 2 >= cx.end || isBlankText(cx.char(pos + 2))) return -1;

    for (let i = pos + 2; i < cx.end - 1; i += 1) {
      const code = cx.char(i);
      if (code === BACKSLASH) {
        i += 1;
        continue;
      }
      if (code === NEWLINE || code === CARRIAGE) return -1;
      if (code !== PLUS || cx.char(i + 1) !== PLUS) continue;
      if (i === pos + 2) return -1; // `++++` has no content
      if (isBlankText(cx.char(i - 1))) return -1;
      return cx.addElement(
        cx.elt(NodeNames.Underline, pos, i + 2, [
          cx.elt(NodeNames.UnderlineMark, pos, pos + 2),
          cx.elt(NodeNames.UnderlineMark, i, i + 2),
        ])
      );
    }
    return -1;
  },
};

export const FORMAT_NODES: readonly NodeSpec[] = [
  { name: NodeNames.Underline },
  { name: NodeNames.UnderlineMark },
];

export const formatExtension: MarkdownConfig = {
  defineNodes: FORMAT_NODES,
  parseInline: [underline],
};
