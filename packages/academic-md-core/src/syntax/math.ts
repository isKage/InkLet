import type {
  BlockContext,
  BlockParser,
  Element,
  InlineContext,
  InlineParser,
  Line,
  MarkdownConfig,
} from '@lezer/markdown';
import { NodeNames } from './nodes.js';
import {
  BACKSLASH,
  CARRIAGE,
  DOLLAR,
  NEWLINE,
  isBlankText,
} from './chars.js';
import type { NodeSpec } from '@lezer/markdown';

export const MATH_NODES: readonly NodeSpec[] = [
  // `$…$` — a single line, delimiters included.
  { name: NodeNames.InlineMath },
  // `$$…$$` — a block construct, possibly several lines.
  { name: NodeNames.DisplayMath, block: true },
  // The TeX source, excluding delimiters. One node per source line when the
  // construct spans lines (blockquote markers may interleave), so consumers
  // join the slices with "\n".
  { name: NodeNames.MathContent },
  // Delimiter runs (`$`, `$$`).
  { name: NodeNames.MathMark },
];

// `$`, `\`, newline handling and blank-ness come from ./chars.js, which also
// documents why CR counts as blank (CRLF files keep a trailing "\r").
const isBlank = isBlankText;

/**
 * `$…$` inline maths.
 *
 * Deliberately conservative, because false positives are worse than false
 * negatives in a writing tool: prose such as "costs $5 and $10" must stay text.
 * Rules (each has a test):
 *  - opening `$` is not followed by whitespace or another `$`
 *  - the construct never spans a line break
 *  - a backslash escapes the next character, so `\$` cannot close
 *  - the closing `$` is not preceded by whitespace
 */
export const inlineMath: InlineParser = {
  name: 'InlineMath',
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== DOLLAR) return -1;
    // `$$` belongs to the block parser: never open inline maths on it, nor on
    // the second half of a `$$` run.
    if (cx.char(pos + 1) === DOLLAR) return -1;
    if (pos > 0 && cx.char(pos - 1) === DOLLAR) return -1;
    if (pos + 1 >= cx.end || isBlank(cx.char(pos + 1))) return -1;

    for (let i = pos + 1; i < cx.end; i += 1) {
      const code = cx.char(i);
      if (code === BACKSLASH) {
        i += 1; // `\$` is not a delimiter
        continue;
      }
      if (code === NEWLINE || code === CARRIAGE) return -1;
      if (code !== DOLLAR) continue;
      if (isBlank(cx.char(i - 1))) return -1;
      return cx.addElement(
        cx.elt(NodeNames.InlineMath, pos, i + 1, [
          cx.elt(NodeNames.MathMark, pos, pos + 1),
          cx.elt(NodeNames.MathContent, pos + 1, i),
          cx.elt(NodeNames.MathMark, i, i + 1),
        ])
      );
    }
    return -1;
  },
};

/**
 * True when a line will start a display-math block.
 *
 * Either the line is a bare `$$` (block form), or it holds a complete
 * `$$ … $$` (single-line form, optionally labelled). A line like `$$ x` that
 * matches neither is deliberately left as text: swallowing the rest of the
 * document because of a typo is a far worse failure than not rendering.
 */
function startsDisplayMath(line: Line): boolean {
  const { text, pos } = line;
  if (text.charCodeAt(pos) !== DOLLAR || text.charCodeAt(pos + 1) !== DOLLAR) return false;
  const rest = text.slice(pos + 2);
  if (rest.trim() === '') return true;
  const close = rest.indexOf('$$');
  return close >= 0 && restIsBlank(text, pos + 2 + close + 2);
}

/**
 * Depth of the enclosing composite block (blockquote/list).
 *
 * `cx.stack` is internal, but this is exactly the rule the shipped `FencedCode`
 * parser uses (`line.depth >= cx.stack.length`) to stop consuming lines once the
 * enclosing block ends; without it an unclosed `$$` inside a quote would swallow
 * the rest of the document.
 */
function contextDepth(cx: BlockContext): number {
  return (cx as unknown as { stack: readonly unknown[] }).stack.length;
}

/** `Line.depth` is marked internal; it is how the enclosing block's depth is read. */
function lineDepth(line: Line): number {
  return (line as unknown as { depth: number }).depth;
}


/**
 * After a closing `$$` only whitespace may follow.
 *
 * Anything else means the `$$` was ordinary text (`$$5 and $$10` should stay
 * prose), which keeps a typo from swallowing the rest of the document.
 */
function restIsBlank(text: string, from: number): boolean {
  for (let i = from; i < text.length; i += 1) {
    if (!isBlankText(text.charCodeAt(i))) return false;
  }
  return true;
}

/**
 * Appends a trimmed content segment, skipping empty ones (e.g. a bare `$$` line).
 *
 * TeX ignores whitespace, so trimming keeps the tree tidy and makes the
 * extracted source independent of block indentation. `lineText` must be the text
 * of the line that owns `[from, to)`, whose start is `lineStart`.
 */
function pushContent(
  marks: Element[],
  cx: BlockContext,
  from: number,
  to: number,
  lineText: string,
  lineStart: number
): void {
  let a = from;
  let b = to;
  while (a < b && isBlankText(lineText.charCodeAt(a - lineStart))) a += 1;
  while (b > a && isBlankText(lineText.charCodeAt(b - 1 - lineStart))) b -= 1;
  if (b > a) marks.push(cx.elt(NodeNames.MathContent, a, b));
}

/**
 * `$$…$$` display maths.
 *
 * Two forms share one parser:
 *  - one line: `$$ a = b $$` (nothing but whitespace may follow the closer)
 *  - block: `$$` … `$$`, where the closing fence must be alone on its line
 *
 * An unclosed block runs to the end of the enclosing block (same strategy as a
 * code fence) so the tree stays well formed; the analysis pass reports it as a
 * diagnostic rather than the parser producing an error node.
 */
export const displayMath: BlockParser = {
  name: 'DisplayMath',
  // Must see fences before FencedCode claims them, and after IndentedCode so
  // that four-space-indented `$$` stays a code block.
  before: 'FencedCode',

  endLeaf(_cx: BlockContext, line: Line): boolean {
    // A `$$` line interrupts a paragraph, exactly like a fence does.
    return startsDisplayMath(line);
  },

  parse(cx: BlockContext, line: Line): boolean {
    if (!startsDisplayMath(line)) return false;

    const from = cx.lineStart + line.pos;
    const depth = contextDepth(cx);
    const openLineText = line.text;
    const marks: Element[] = [cx.elt(NodeNames.MathMark, from, from + 2)];

    // --- single-line form: `$$ a = b $$`
    const rest = openLineText.slice(line.pos + 2);
    const closeInRest = rest.indexOf('$$');
    if (closeInRest >= 0 && restIsBlank(openLineText, line.pos + 2 + closeInRest + 2)) {
      const contentFrom = from + 2;
      const contentTo = contentFrom + closeInRest;
      pushContent(marks, cx, contentFrom, contentTo, openLineText, cx.lineStart);
      marks.push(cx.elt(NodeNames.MathMark, contentTo, contentTo + 2));
      cx.nextLine();
      cx.addElement(cx.elt(NodeNames.DisplayMath, from, cx.prevLineEnd(), marks));
      return true;
    }

    // --- block form: by `startsDisplayMath`, the opener line is a bare `$$`
    while (cx.nextLine() && lineDepth(line) >= depth) {
      const start = cx.lineStart;
      const text = line.text;
      // `basePos` skips composite markup such as a blockquote's `> `.
      const base = start + line.basePos;
      let a = base;
      while (a < start + text.length && isBlankText(text.charCodeAt(a - start))) a += 1;

      // Blockquote/list markers belong to the tree on every line, closer included.
      for (const marker of line.markers) marks.push(marker);

      // Closing line: a bare `$$`.
      if (text.charCodeAt(a - start) === DOLLAR && text.charCodeAt(a + 1 - start) === DOLLAR) {
        if (restIsBlank(text, a + 2 - start)) {
          marks.push(cx.elt(NodeNames.MathMark, a, a + 2));
          // Consume the closing line so the node ends after it (FencedCode does
          // the same); otherwise the parser re-reads `$$` as a new block.
          cx.nextLine();
          break;
        }
      }
      pushContent(marks, cx, base, start + text.length, text, start);
    }

    cx.addElement(cx.elt(NodeNames.DisplayMath, from, cx.prevLineEnd(), marks));
    return true;
  },
};

const BRACKET_OPEN = '\\[';
const BRACKET_CLOSE = '\\]';

/**
 * True when the line will start a bracket block: either a bare `\[` or a
 * complete `\[ … \]`. Anything else stays prose, the same rule the `$$` parser
 * uses — a typo must not swallow the rest of the document.
 */
function startsBracketMath(line: Line): boolean {
  if (!line.text.startsWith(BRACKET_OPEN, line.pos)) return false;
  const rest = line.text.slice(line.pos + 2);
  if (rest.trim() === '') return true;
  const closeAt = rest.indexOf(BRACKET_CLOSE);
  return closeAt >= 0 && restIsBlank(line.text, line.pos + 2 + closeAt + 2);
}

/**
 * `\[…\]` display maths — the LaTeX delimiter people already type.
 *
 * Emits the same `DisplayMath` node as `$$…$$`, so rendering and export need no
 * special case.
 */
export const bracketMath: BlockParser = {
  name: 'BracketDisplayMath',
  before: 'FencedCode',

  endLeaf(_cx: BlockContext, line: Line): boolean {
    return startsBracketMath(line);
  },

  parse(cx: BlockContext, line: Line): boolean {
    if (!startsBracketMath(line)) return false;

    const from = cx.lineStart + line.pos;
    const depth = contextDepth(cx);
    const openLineText = line.text;
    const marks: Element[] = [cx.elt(NodeNames.MathMark, from, from + 2)];

    const rest = openLineText.slice(line.pos + 2);
    const closeAt = rest.indexOf(BRACKET_CLOSE);
    if (closeAt >= 0 && restIsBlank(openLineText, line.pos + 2 + closeAt + 2)) {
      const contentFrom = from + 2;
      const contentTo = contentFrom + closeAt;
      pushContent(marks, cx, contentFrom, contentTo, openLineText, cx.lineStart);
      marks.push(cx.elt(NodeNames.MathMark, contentTo, contentTo + 2));
      cx.nextLine();
      cx.addElement(cx.elt(NodeNames.DisplayMath, from, cx.prevLineEnd(), marks));
      return true;
    }

    while (cx.nextLine() && lineDepth(line) >= depth) {
      const start = cx.lineStart;
      const text = line.text;
      const base = start + line.basePos;
      let a = base;
      while (a < start + text.length && isBlankText(text.charCodeAt(a - start))) a += 1;

      for (const marker of line.markers) marks.push(marker);

      const tail = text.slice(a - start);
      if (tail.startsWith(BRACKET_CLOSE) && restIsBlank(text, a + 2 - start)) {
        marks.push(cx.elt(NodeNames.MathMark, a, a + 2));
        cx.nextLine();
        break;
      }
      pushContent(marks, cx, base, start + text.length, text, start);
    }

    cx.addElement(cx.elt(NodeNames.DisplayMath, from, cx.prevLineEnd(), marks));
    return true;
  },
};

/**
 * The maths portion of the dialect as a `MarkdownConfig`, composable with GFM,
 * tables and later extensions via `parser.configure([...])`.
 */
export const mathExtension: MarkdownConfig = {
  defineNodes: MATH_NODES,
  parseBlock: [displayMath, bracketMath],
  parseInline: [inlineMath],
};
