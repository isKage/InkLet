import { EditorState, Facet, StateField, type Extension, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { NodeNames, parseDocument, renderNodeHTML } from '@inklet/academic-md-core';
import type { ParsedDocument } from '@inklet/academic-md-core';
import { EditableTableWidget, parseTable } from './table-widget.js';
import {
  DisplayMathWidget,
  HtmlBlockWidget,
  ImageWidget,
  InlineMathWidget,
  ListMarkWidget,
  MathPreviewWidget,
  RuleWidget,
  TaskMarkerWidget,
  fallbackRenderMath,
  type HighlightCode,
  type ImageResolver,
  type MathRender,
} from './widgets.js';
import { theme } from './theme.js';

/**
 * Typora-style live preview.
 *
 * The document is a normal CodeMirror document; rendering is purely decorative.
 * A construct shows its source while the selection touches it and its rendered
 * form otherwise. Two invariants matter:
 *
 * 1. Rendering never mutates the document (all changes are decorations), so
 *    undo, IME and the file on disk stay in sync.
 * 2. Decorations live in a StateField, not a ViewPlugin: CodeMirror only allows
 *    block-level decorations (the display-maths widget) from state fields.
 */

const mathRenderFacet = Facet.define<MathRender, MathRender>({
  combine: (values) => values[0] ?? ((tex) => fallbackRenderMath(tex)),
});

/**
 * Whether the construct under the selection falls back to source. A read-only
 * preview (the comparison pane) turns this off so it always shows the document
 * as rendered, using the very same decorator as the editing pane.
 */
const revealFacet = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? true,
});

const imageResolverFacet = Facet.define<ImageResolver | undefined, ImageResolver | undefined>({
  combine: (values) => values[0],
});

/** Optional syntax highlighter for fenced blocks. */
const highlightFacet = Facet.define<HighlightCode | undefined, HighlightCode | undefined>({
  combine: (values) => values[0],
});

const BULLETS = ['•', '◦', '▪'] as const;

/**
 * Whether a construct shows its source because the selection touches it.
 *
 * The start is exclusive on purpose: a caret at the very beginning of a document
 * would otherwise reveal its first block (usually the macro block), so opening a
 * file showed raw TeX at the top. This is the rule for inline constructs, where
 * the caret sitting just after `$x$` must leave it rendered.
 */
export function revealsSource(
  ranges: readonly { readonly from: number; readonly to: number }[],
  from: number,
  to: number
): boolean {
  return ranges.some((range) => range.from < to && range.to > from);
}

/**
 * The same question for a block whose closing line is part of its source.
 *
 * Here the end is inclusive. A display block's last line is the `$$` (or the
 * closing fence), so "just after the block" and "on the closer" are the same
 * position; excluding it made the caret jump into the block, and Enter then read
 * the closer as a fresh opener.
 */
export function revealsBlockSource(
  ranges: readonly { readonly from: number; readonly to: number }[],
  from: number,
  to: number
): boolean {
  return ranges.some(
    (range) => (range.from < to && range.to > from) || (range.to === to && range.from > from)
  );
}

/**
 * Whether a block's source already contains its closing delimiter.
 *
 * An unterminated fence or `$$` block runs to the end of the document — the
 * parser has nowhere else to put the text — so rendering or framing it would
 * swallow every line below it while it is still being typed. Only a closed block
 * is treated as one.
 */
/** A label may ride along after a block's closer; it is not part of the delimiting. */
const TRAILING_LABEL = /(?:\s*\{#[^}]*\}|\s*\\label\{[^}]*\})+\s*$/;

export function blockIsComplete(parsed: ParsedDocument, node: SyntaxNode): boolean {
  const raw = parsed.src.slice(node.from, node.to);
  if (node.name === NodeNames.DisplayMath) {
    const text = raw.replace(TRAILING_LABEL, '');
    // Two `$$` runs (or a `\[ … \]` pair) mean the block already has its closer.
    if ((text.match(/\$\$/g)?.length ?? 0) >= 2) return true;
    return text.includes('\\[') && text.trimEnd().endsWith('\\]');
  }
  const trimmed = raw.trimEnd();
  const breakAt = trimmed.lastIndexOf('\n');
  if (breakAt < 0) return false;
  return trimmed.slice(breakAt + 1).trim().startsWith('```');
}

/**
 * Line numbers of the first line of every paragraph that is not the document's
 * own first line. Paragraphs nested in lists, quotes or tables are excluded:
 * those already carry their own layout.
 */
export function paragraphStartLines(parsed: ParsedDocument, doc: Text): number[] {
  const lines: number[] = [];
  parsed.tree.iterate({
    enter(ref) {
      if (ref.name !== 'Paragraph') return undefined;
      let nested = false;
      for (let parent = ref.node.parent; parent; parent = parent.parent) {
        if (
          parent.name === 'ListItem' ||
          parent.name === 'Blockquote' ||
          parent.name === 'Table'
        ) {
          nested = true;
        }
      }
      if (nested) return false;
      const line = doc.lineAt(Math.min(ref.node.from, doc.length));
      if (line.number > 1) lines.push(line.number);
      return false;
    },
  });
  return lines;
}

/** Nesting depth of a list mark, used to pick a bullet glyph. */
function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'ListItem') depth += 1;
  }
  return Math.max(0, depth - 1);
}

interface PreviewValue {
  readonly parsed: ParsedDocument;
  readonly decorations: DecorationSet;
}

const previewField = StateField.define<PreviewValue>({
  create(state) {
    return compute(state);
  },
  update(value, tr) {
    // Selection-only changes matter: leaving a construct re-renders it.
    if (!tr.docChanged && !tr.selection && !tr.reconfigured) return value;
    const parsed = tr.docChanged ? parseDocument(tr.state.doc.toString()) : value.parsed;
    return { parsed, decorations: buildDecorations(tr.state, parsed) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const HEADING_LEVELS: Readonly<Record<string, number>> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
};

/** Markup nodes that disappear when their parent is not being edited. */
const HIDDEN_MARKS = new Set([
  'EmphasisMark',
  'StrikethroughMark',
  NodeNames.UnderlineMark,
  'CodeMark',
  'EndMark',
]);

/**
 * Inline markup that carries presentation. Hiding the marks alone (`**bold**`)
 * left the text unstyled, so emphasis and code looked like plain prose.
 */
const INLINE_STYLE_CLASS: Readonly<Record<string, string>> = {
  StrongEmphasis: 'ink-strong',
  Emphasis: 'ink-em',
  Strikethrough: 'ink-strike',
  Underline: 'ink-underline',
  InlineCode: 'ink-code',
};

function* childrenOf(node: SyntaxNode): Generator<SyntaxNode> {
  for (let child = node.firstChild; child; child = child.nextSibling) yield child;
}

function compute(state: EditorState): PreviewValue {
  // Always parse with our own dialect: CodeMirror's language configuration is
  // external input, and a mismatched tree here would break every decoration.
  const parsed = parseDocument(state.doc.toString());
  return { parsed, decorations: buildDecorations(state, parsed) };
}

function buildDecorations(state: EditorState, parsed: ParsedDocument): DecorationSet {
  const doc = state.doc;
  const renderMath = state.facet(mathRenderFacet);
  const decorations: Range<Decoration>[] = [];

  const slice = (from: number, to: number): string => doc.sliceString(from, to);
  const revealSelection = state.facet(revealFacet);
  const imageResolver = state.facet(imageResolverFacet);
  const highlight = state.facet(highlightFacet);
  const ranges = state.selection.ranges;
  const isRevealed = (from: number, to: number): boolean =>
    revealSelection && revealsSource(ranges, from, to);
  const isBlockRevealed = (from: number, to: number): boolean =>
    revealSelection && revealsBlockSource(ranges, from, to);
  const hide = (from: number, to: number): void => {
    decorations.push(Decoration.replace({}).range(from, to));
  };
  const markSource = (from: number, to: number): void => {
    decorations.push(Decoration.mark({ class: 'ink-src' }).range(from, to));
  };

  // A line-start marker (`#`, `-`, `[ ]`) stays visible while the caret is
  // anywhere on its line, so it can still be selected, edited or deleted; it
  // only turns into its rendered form once the caret leaves the line. Revealing
  // on the marker's own range alone would swap `- ` for a bullet the moment the
  // first character of the item was typed.
  const onMarkerLine = (from: number, to: number): boolean => {
    if (!revealSelection) return false;
    const start = doc.lineAt(from).from;
    const end = doc.lineAt(to).to;
    return ranges.some((range) => range.from <= end && range.to >= start);
  };
  const markMarkup = (from: number, to: number): void => {
    decorations.push(Decoration.mark({ class: 'ink-mark' }).range(from, to));
  };

  // A block being edited keeps its source visible, so it needs a frame to read
  // as one object — the same treatment for display maths and fenced code.
  // The frame is drawn per line (edges only on the first and last), because a
  // block is a run of lines rather than one element.
  const framedLines = new Set<number>();
  const frameBlock = (from: number, to: number): void => {
    const firstLine = doc.lineAt(from).number;
    const lastLine = doc.lineAt(to).number;
    for (let n = firstLine; n <= lastLine; n += 1) {
      const classes = ['ink-block-editing'];
      if (n === firstLine) classes.push('ink-block-editing-first');
      if (n === lastLine) classes.push('ink-block-editing-last');
      decorations.push(Decoration.line({ class: classes.join(' ') }).range(doc.line(n).from));
      framedLines.add(n);
    }
  };

  // Ranges already replaced by a block widget; inline decorations inside them
  // would overlap and CodeMirror rejects that.
  const blockRanges: Array<{ from: number; to: number }> = [];
  const insideBlock = (pos: number): boolean =>
    blockRanges.some((range) => pos >= range.from && pos < range.to);
  /** Line numbers that start with a list marker, for the hanging-indent pass. */
  const markerLines = new Set<number>();
  /** Marker width (em) per list item, so continuation lines align with its text. */
  const markerBox = new Map<number, number>();
  /** Lines that already carry their own vertical space. */
  const headingLines = new Set<number>();
  let sawList = false;

  const mathSourceOf = (node: SyntaxNode): string => {
    const parts: string[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === NodeNames.MathContent) parts.push(slice(child.from, child.to));
    }
    return parts.join('\n');
  };

  parsed.tree.iterate({
    enter(ref) {
      const node = ref.node;

      switch (ref.name) {
        case NodeNames.InlineMath: {
          if (isRevealed(node.from, node.to)) {
            markSource(node.from, node.to);
            return false;
          }
          decorations.push(
            Decoration.replace({
              widget: new InlineMathWidget(mathSourceOf(node), renderMath, {
                from: node.from,
                to: node.to,
              }),
            }).range(node.from, node.to)
          );
          return false;
        }

        case NodeNames.DisplayMath: {
          // The number is rendered by our frame, so an explicit `\tag` must not
          // also be typeset by MathJax (it would appear twice).
          const maths = mathSourceOf(node);
          if (!blockIsComplete(parsed, node)) {
            markSource(node.from, node.to);
            return false;
          }
          if (isBlockRevealed(node.from, node.to)) {
            markSource(node.from, node.to);
            frameBlock(node.from, node.to);
            // Live preview under the source, inside the document (no separate pane).
            decorations.push(
              Decoration.widget({
                widget: new MathPreviewWidget(maths, renderMath),
                block: true,
                side: 1,
              }).range(doc.lineAt(node.to).to)
            );
            return false;
          }
          const first = doc.lineAt(node.from);
          if (first.from !== node.from) {
            // Not at a line start (inside a list or quote): replacing it would
            // break the surrounding block structure, so keep the source visible.
            markSource(node.from, node.to);
            return false;
          }
          const last = doc.lineAt(node.to);
          decorations.push(
            Decoration.replace({
              widget: new DisplayMathWidget(maths, renderMath, { from: node.from, to: node.to }),
              block: true,
            }).range(first.from, last.to)
          );
          return false;
        }

        case 'HeaderMark': {
          // The `#`s of a heading stay in the text, in the markup colour, until
          // the caret moves off the line — see `onMarkerLine`.
          if (onMarkerLine(node.from, node.to)) {
            markMarkup(node.from, node.to);
            return false;
          }
          // Hide the separating space too, otherwise the heading keeps a stray
          // indent once its `#` is gone.
          const space = doc.sliceString(node.to, Math.min(node.to + 1, doc.length)) === ' ' ? 1 : 0;
          hide(node.from, node.to + space);
          return false;
        }

        case 'ListMark': {
          sawList = true;
          markerLines.add(doc.lineAt(node.from).number);
          if (node.parent) markerBox.set(node.parent.from, node.parent.parent?.name === 'OrderedList' ? 1.3 : 0.7);
          // The raw `- `/`1. ` stays on screen while the item is being written.
          if (onMarkerLine(node.from, node.to)) {
            markMarkup(node.from, node.to);
            return false;
          }
          const item = node.parent;
          const ordered = item?.parent?.name === 'OrderedList';
          const text = ordered
            ? slice(node.from, node.to).trim()
            : (BULLETS[listDepth(node) % BULLETS.length] as string);
          decorations.push(
            Decoration.replace({ widget: new ListMarkWidget(text, ordered) }).range(
              node.from,
              node.to
            )
          );
          return false;
        }

        case 'TaskMarker': {
          if (onMarkerLine(node.from, node.to)) {
            markMarkup(node.from, node.to);
            return false;
          }
          const checked = /\[[xX]\]/.test(slice(node.from, node.to));
          decorations.push(
            Decoration.replace({ widget: new TaskMarkerWidget(checked) }).range(node.from, node.to)
          );
          return false;
        }

        case 'Image': {
          if (isRevealed(node.from, node.to)) {
            markSource(node.from, node.to);
            return false;
          }
          const kids = [...childrenOf(node)];
          const marks = kids.filter((child) => child.name === 'LinkMark');
          const urlNode = kids.find((child) => child.name === 'URL');
          const alt =
            marks.length >= 2 && marks[0] && marks[1] ? slice(marks[0].to, marks[1].from) : '';
          decorations.push(
            Decoration.replace({
              widget: new ImageWidget({
                src: urlNode ? slice(urlNode.from, urlNode.to) : '',
                alt,
                range: { from: node.from, to: node.to },
                ...(imageResolver ? { resolve: imageResolver } : {}),
              }),
            }).range(node.from, node.to)
          );
          return false;
        }

        case 'HorizontalRule': {
          // `---` on its own line. The rule is drawn as one object; the source
          // comes back while the caret is on the line, in the markup colour.
          if (onMarkerLine(node.from, node.to)) {
            markMarkup(node.from, node.to);
            return false;
          }
          const first = doc.lineAt(node.from);
          if (first.from !== node.from) {
            markSource(node.from, node.to);
            return false;
          }
          decorations.push(
            Decoration.replace({
              widget: new RuleWidget({ from: node.from, to: node.to }),
              block: true,
            }).range(first.from, doc.lineAt(node.to).to)
          );
          return false;
        }

        case 'FencedCode':
        case 'CodeBlock': {
          // Typing ``` (or ~~~) opens a block that the parser extends to EOF
          // until a closer appears; framing all of it would shade the rest of
          // the document.
          if (ref.name === 'FencedCode' && !blockIsComplete(parsed, node)) {
            markSource(node.from, node.to);
            return false;
          }
          // Editing a fence shows its source inside the same frame as a display
          // formula; the caret then lives in the grey box rather than in plain
          // Markdown that happens to contain backticks.
          if (isBlockRevealed(node.from, node.to)) {
            markSource(node.from, node.to);
            frameBlock(node.from, node.to);
            return false;
          }
          const first = doc.lineAt(node.from);
          if (first.from !== node.from) {
            markSource(node.from, node.to);
            return false;
          }
          const last = doc.lineAt(node.to);
          decorations.push(
            Decoration.replace({
              widget: new HtmlBlockWidget(
                renderNodeHTML(parsed, node, { renderMath, ...(highlight ? { highlight } : {}) }),
                'ink-code-block',
                { from: node.from, to: node.to }
              ),
              block: true,
            }).range(first.from, last.to)
          );
          return false;
        }

        case 'Table': {
          // Never fall back to source: the cells are edited through an overlay
          // input, so clicking the table must not flip it to Markdown.
          const first = doc.lineAt(node.from);
          if (first.from !== node.from) {
            // Indented table (inside a list): a block replacement would break it.
            markSource(node.from, node.to);
            return false;
          }
          const last = doc.lineAt(node.to);
          const source = slice(node.from, node.to);
          const table = parseTable(source);
          if (!table) {
            markSource(node.from, node.to);
            return false;
          }
          decorations.push(
            Decoration.replace({
              widget: new EditableTableWidget(source, table, node.from, renderMath),
              block: true,
            }).range(first.from, last.to)
          );
          return false;
        }

        default:
          break;
      }

      const styleClass = INLINE_STYLE_CLASS[ref.name];
      if (styleClass) {
        decorations.push(Decoration.mark({ class: styleClass }).range(node.from, node.to));
        return undefined;
      }

      if (HIDDEN_MARKS.has(ref.name)) {
        const parent = node.parent;
        if (parent && !isRevealed(parent.from, parent.to)) hide(node.from, node.to);
        return false;
      }

      const level = HEADING_LEVELS[ref.name];
      if (level) {
        const line = doc.lineAt(node.from);
        headingLines.add(line.number);
        decorations.push(Decoration.line({ class: `ink-h${level}` }).range(line.from));
        if (level === 2) {
          // A bottom rule as wide as the text, not as wide as the column: an
          // inline mark draws under the words only, and follows them across a
          // wrapped heading.
          const headerMark = [...childrenOf(node)].find((child) => child.name === 'HeaderMark');
          decorations.push(
            Decoration.mark({ class: 'ink-h2-rule' }).range(headerMark ? headerMark.to : node.from, node.to)
          );
        }
        return undefined;
      }

      return undefined;
    },
  });

  // Hanging indent for list items.
  //
  // Source indentation is hidden and replaced by padding computed from the list
  // depth, so the first line's text and its continuation lines (including
  // soft-wrapped ones) start at the same column. Without this, a multi-line item
  // wrapped back under the bullet.
  if (sawList) {
    // One step = 2 characters of the body font; the marker box is the bullet
    // plus roughly one space, so text resumes one space after the dot.
    const STEP = '2ch';
    const markerBoxFor = (item: SyntaxNode | null): string =>
      item && markerBox.get(item.from) ? `${markerBox.get(item.from)}em` : '0.7em';
    for (let n = 1; n <= doc.lines; n += 1) {
      const line = doc.line(n);
      const text = line.text;
      let lead = 0;
      while (lead < text.length && (text[lead] === ' ' || text[lead] === '\t')) lead += 1;
      if (lead >= text.length) continue;

      const start = line.from + lead;
      let depth = -1;
      let skip = false;
      let item: SyntaxNode | null = null;
      for (
        let current: SyntaxNode | null = parsed.tree.resolveInner(start, 1);
        current;
        current = current.parent
      ) {
        if (current.name === 'ListItem') {
          if (!item) item = current;
          depth += 1;
        }
        if (
          current.name === 'FencedCode' ||
          current.name === 'CodeBlock' ||
          current.name === NodeNames.DisplayMath
        ) {
          skip = true;
        }
      }
      if (depth < 0 || skip) continue;

      // Every list line is tagged, even the one being edited: list entries are
      // spaced tighter than prose, and that has to hold while typing too.
      const classes = ['ink-list-line'];
      if (markerLines.has(n) && onMarkerLine(line.from, line.to)) {
        // The raw `- ` is on screen, so the line sits at the paragraph margin:
        // pushing it out to the hanging indent would look like an indent jump.
        decorations.push(Decoration.line({ class: classes.join(' ') }).range(line.from));
        continue;
      }
      const box = markerBoxFor(item);
      // Indent two characters past the normal text margin, then the marker, then
      // roughly one space before the item text.
      const padding = `calc(var(--ink-line-pad, 28px) + ${depth + 1} * ${STEP} + ${box})`;
      if (lead > 0) hide(line.from, start);
      decorations.push(
        Decoration.line({
          class: classes.join(' '),
          attributes: {
            style: markerLines.has(n)
              ? `padding-left:${padding};text-indent:-${box}`
              : `padding-left:${padding}`,
          },
        }).range(line.from)
      );
    }
  }

  // Space between paragraphs.
  //
  // The source keeps its blank line, but one blank line is only one line box —
  // barely more than the leading inside a paragraph, which is why the paragraph
  // gap setting looked inert. Marking the first line of every real paragraph
  // lets the theme add the extra space exactly once per break, so text inside a
  // paragraph stays tight while paragraphs sit clearly apart.
  for (const n of paragraphStartLines(parsed, doc)) {
    if (framedLines.has(n) || headingLines.has(n) || markerLines.has(n)) continue;
    const at = doc.line(n).from;
    if (insideBlock(at)) continue;
    decorations.push(Decoration.line({ class: 'ink-para-start' }).range(at));
  }

  return Decoration.set(decorations, true);
}

/** The parsed document behind a live-preview editor (for diagnostics, chips, …). */
export function findParsedDocument(state: EditorState): ParsedDocument | undefined {
  return state.field(previewField, false)?.parsed;
}

export interface LivePreviewOptions {
  /** TeX → markup. Injected so this package stays renderer-agnostic. */
  readonly renderMath: MathRender;
  /** `false` renders everything, ignoring the selection (read-only preview). */
  readonly revealSelection?: boolean;
  /** Resolves image paths; without it images render as labelled placeholders. */
  readonly resolveImage?: ImageResolver;
  /** Syntax highlighting for fenced code; without it blocks stay plain. */
  readonly highlightCode?: HighlightCode;
}

export const livePreviewTheme = theme;

export function livePreview(options: LivePreviewOptions): Extension {
  return [
    mathRenderFacet.of(options.renderMath),
    revealFacet.of(options.revealSelection ?? true),
    imageResolverFacet.of(options.resolveImage),
    highlightFacet.of(options.highlightCode),
    previewField,
    theme,
    EditorView.lineWrapping,
  ];
}
