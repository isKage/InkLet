import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, dropCursor, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { academicLanguage } from './markdown.js';
import { livePreview } from './live-preview.js';
import { blockKeys } from './block-keys.js';
import type { HighlightCode, ImageResolver, MathRender } from './widgets.js';

export type EditorMode = 'live' | 'source';

export interface EditorOptions {
  readonly renderMath: MathRender;
  readonly onChange?: (value: string) => void;
  /** `live` renders constructs as you type; `source` keeps the raw Markdown. */
  readonly mode?: EditorMode;
  /** Renders everything and drops editing (comparison pane). */
  readonly readOnly?: boolean;
  /** `false` never falls back to source (used with `readOnly`). */
  readonly revealSelection?: boolean;
  /** Resolves image paths to something an `<img>` can load. */
  readonly resolveImage?: ImageResolver;
  /** Caption language for environments (定理 vs Theorem). */
  readonly language?: 'zh' | 'en';
  /** Syntax highlighting for fenced code blocks. */
  readonly highlightCode?: HighlightCode;
  /** Follows a link clicked in the rendered document. */
  readonly onLink?: (target: string) => void;
}

/** The subset `livePreview` needs; kept together so reconfiguration cannot drop options. */
function liveOptions(options: {
  renderMath: MathRender;
  revealSelection?: boolean;
  resolveImage?: ImageResolver;
  language?: 'zh' | 'en';
  highlightCode?: HighlightCode;
  onLink?: (target: string) => void;
}) {
  return {
    renderMath: options.renderMath,
    revealSelection: options.revealSelection ?? true,
    ...(options.resolveImage ? { resolveImage: options.resolveImage } : {}),
    ...(options.language ? { language: options.language } : {}),
    ...(options.highlightCode ? { highlightCode: options.highlightCode } : {}),
    ...(options.onLink ? { onLink: options.onLink } : {}),
  };
}

/**
 * The dialect has no comment syntax, so CodeMirror's `Mod-/` would wrap the
 * selection in `<!-- -->` and leave it in the paper. The shortcut is simply not
 * offered: a key that damages a draft is worse than a missing convenience.
 */
const defaultKeys = defaultKeymap.filter((binding) => binding.key !== 'Mod-/');

/** Lets the app switch between live and source rendering without recreating the view. */
const modeCompartment = new Compartment();


function extensions(options: EditorOptions): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    // Must precede the default keymap: it binds Enter and ArrowUp/ArrowDown, and
    // the first binding that handles the key wins.
    blockKeys,
    keymap.of([...defaultKeys, ...historyKeymap, indentWithTab]),
    academicLanguage,
    EditorView.lineWrapping,
    EditorState.readOnly.of(options.readOnly ?? false),
    EditorView.editable.of(!(options.readOnly ?? false)),
    modeCompartment.of(
      (options.mode ?? 'live') === 'live'
        ? livePreview(liveOptions(options))
        : []
    ),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange?.(update.state.doc.toString());
    }),
  ];
}

export function createEditorState(doc: string, options: EditorOptions): EditorState {
  return EditorState.create({ doc, extensions: extensions(options) });
}

export function createEditor(parent: HTMLElement, doc: string, options: EditorOptions): EditorView {
  return new EditorView({ state: createEditorState(doc, options), parent });
}

/**
 * Loads a different document. Uses a fresh state on purpose: undo history must
 * not leak across files, or Cmd+Z after switching tabs would paste one file's
 * text into another.
 */
export function replaceDocument(view: EditorView, doc: string, options: EditorOptions): void {
  view.setState(createEditorState(doc, options));
}

/**
 * Forces the decorations to be rebuilt. Needed after the maths engine is
 * reconfigured: without it the widgets keep the DOM rendered with the old macros.
 */
export function refreshDecorations(view: EditorView): void {
  view.dispatch({ selection: view.state.selection });
}

/** Moves the caret to `pos` and centres that line, without touching the text. */
export function jumpToPosition(
  view: EditorView,
  pos: number,
  options: { focus?: boolean } = {}
): void {
  const clamped = Math.max(0, Math.min(pos, view.state.doc.length));
  view.dispatch({
    selection: { anchor: clamped },
    effects: EditorView.scrollIntoView(clamped, { y: 'center' }),
  });
  if (options.focus !== false) view.focus();
}

export function setEditorMode(
  view: EditorView,
  mode: EditorMode,
  options: {
    renderMath: MathRender;
    revealSelection?: boolean;
    resolveImage?: ImageResolver;
    language?: 'zh' | 'en';
    highlightCode?: HighlightCode;
    onLink?: (target: string) => void;
  }
): void {
  view.dispatch({
    effects: modeCompartment.reconfigure(mode === 'live' ? livePreview(liveOptions(options)) : []),
  });
}
