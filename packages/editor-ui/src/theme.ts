import { EditorView } from '@codemirror/view';
import { HIGHLIGHT_TOKENS } from './highlight-tokens.js';

/**
 * Editor theme. Colours come from CSS variables so the host app owns light/dark
 * mode; everything else is typography for prose that reads like a paper.
 */
/** Syntax colours: the same table the PDF uses, pointed at theme variables. */
const tokenStyles = Object.fromEntries(
  HIGHLIGHT_TOKENS.map((token) => [
    `.${token.cls}`,
    {
      color: `var(${token.name}, ${token.fallback})`,
      ...(token.italic ? { fontStyle: 'italic' } : {}),
    },
  ])
);

export const theme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--ink-paper, #ffffff)',
    color: 'var(--ink-fg, #1b1b1f)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--ink-serif, Georgia, "Songti SC", "Noto Serif CJK SC", serif)',
    fontSize: 'var(--ink-editor-size, 16.5px)',
    lineHeight: 'var(--ink-editor-leading, 1.85)',
  },
  '.cm-content': {
    // The column fills the pane; the page-margin setting is what insets it, so
    // a small margin really does let the text use the whole line.
    maxWidth: '1600px',
    margin: '0 auto',
    padding: '30px 0 220px',
    caretColor: 'var(--ink-accent, #b0894a)',
  },
  // The list hanging indent is expressed relative to this padding, so it is a
  // variable rather than a literal.
  '.cm-line': { padding: '0 var(--ink-line-pad, 28px)' },
  // A real paragraph break (`\n\n` in the source) earns extra space; the leading
  // inside a paragraph stays as set, so the two distances read differently.
  '.ink-para-start': { paddingTop: 'var(--ink-para-gap, 0.9em)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink-accent, #b0894a)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--ink-selection, rgba(176, 137, 74, 0.22))',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },

  // Headings
  '.ink-h1': { fontSize: '1.55em', fontWeight: '700', lineHeight: '1.4', paddingTop: '0.5em' },
  '.ink-h2': {
    fontSize: '1.22em',
    fontWeight: '700',
    lineHeight: '1.45',
    paddingTop: '0.4em',
  },
  // The rule under an h2 follows the text, so it stops where the words stop.
  '.ink-h2-rule': {
    borderBottom: '1px solid var(--ink-line, #e3e3ea)',
    paddingBottom: '3px',
  },
  '.ink-h3': { fontSize: '1.08em', fontWeight: '700' },

  // Source shown while the cursor is inside a construct
  '.ink-src': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.82em',
    backgroundColor: 'var(--ink-src-bg, rgba(176, 137, 74, 0.1))',
    borderRadius: '3px',
  },

  // Markup that stays on screen while its line is edited (`#`, `-`, `[ ]`).
  // Muted blue reads as "this is syntax, not prose", and losing the bold keeps
  // a `##` from competing with the heading it introduces.
  '.ink-mark': {
    color: 'var(--ink-mark, #7f96b8)',
    fontWeight: '400',
  },

  // Lists.
  //
  // Entries sit closer together than prose: a bullet is its own line, and a
  // paragraph's leading looks airy between two short items. `--ink-list-leading`
  // is the knob (see also `.ink-list-mark` for the bullet gutter).
  '.ink-list-line': { lineHeight: 'var(--ink-list-leading, 1.38)' },
  '.ink-list-mark': {
    display: 'inline-block',
    // Fixed gutter width: the hanging indent is computed against it.
    // 0.7em ≈ the dot plus one space.
    width: '0.7em',
    color: 'var(--ink-accent, #a8792f)',
    fontWeight: '700',
  },
  '.ink-list-number': {
    display: 'inline-block',
    width: '1.3em',
    textAlign: 'right',
    color: 'var(--ink-accent, #a8792f)',
    fontVariantNumeric: 'tabular-nums',
  },
  '.ink-task': {
    color: 'var(--ink-accent, #a8792f)',
    marginRight: '4px',
  },

  // Code blocks (rendered by the shared HTML renderer).
  //
  // A block widget is a sibling of the lines, not inside one, so it does not
  // inherit `.cm-line`'s side padding: without this the grey box came out 56px
  // wider than the prose above it.
  '.ink-code-block': {
    padding: '0 var(--ink-line-pad, 28px)',
  },
  '.ink-code-block pre': {
    margin: '0.35em 0',
    padding: '10px 14px',
    borderRadius: '6px',
    backgroundColor: 'var(--ink-code-bg, #f3f3f6)',
    overflowX: 'auto',
  },
  '.ink-code-block code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.86em',
    lineHeight: '1.6',
  },

  // Thematic break
  '.ink-rule': { padding: '0 var(--ink-line-pad, 28px)' },
  '.ink-rule hr': {
    border: 'none',
    borderTop: '1px solid var(--ink-line, #e2e2e8)',
    margin: '1.4em 0',
  },

  ...tokenStyles,

  // Images
  '.ink-image': { display: 'inline-block', maxWidth: '100%' },
  '.ink-image-el': {
    display: 'block',
    maxWidth: '100%',
    borderRadius: '4px',
  },
  '.ink-image-missing': {
    padding: '1px 8px',
    border: '1px dashed var(--ink-line, #e2e2e8)',
    borderRadius: '4px',
    color: 'var(--ink-muted, #64646f)',
    fontSize: '0.84em',
  },

  // Inline markup
  '.ink-strong': { fontWeight: '700' },
  '.ink-em': { fontStyle: 'italic' },
  '.ink-strike': { textDecoration: 'line-through' },
  '.ink-underline': { textDecoration: 'underline', textUnderlineOffset: '2px' },
  '.ink-code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.86em',
    backgroundColor: 'var(--ink-code-bg, #f3f3f6)',
    borderRadius: '3px',
    padding: '0 3px',
  },
  // A rendered link: the URL is hidden, the text keeps the link colour and a
  // pointer cursor so it reads as clickable.
  '.ink-link': {
    color: 'var(--ink-link, #1556a3)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
  },
  '.ink-link:hover': {
    backgroundColor: 'var(--ink-src-bg, rgba(168, 121, 47, 0.1))',
    borderRadius: '2px',
  },
  // A reference to an identifier that occurs more than once: the link still
  // works (and jumps to the first marker), the yellow wave only warns.
  '.ink-dup': {
    textDecoration: 'underline wavy #d9a400',
    textUnderlineOffset: '3px',
  },
  // `<id:xxx>` stays visible, quietly, so it can be read and edited.
  '.ink-anchor': {
    color: 'var(--ink-muted, #64646f)',
    opacity: '0.62',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.86em',
  },

  // Comment blocks (`> …`). The `>` is hidden, the text sits in a grey box;
  // `background-clip: content-box` keeps the box aligned with the text column
  // instead of running to the pane edges.
  '.ink-comment': {
    backgroundColor: 'var(--ink-code-bg, #f3f3f6)',
    backgroundClip: 'content-box',
  },
  '.ink-comment-first': {
    borderTopLeftRadius: '6px',
    borderTopRightRadius: '6px',
  },
  '.ink-comment-last': {
    borderBottomLeftRadius: '6px',
    borderBottomRightRadius: '6px',
  },

  // Tables (rendered by the same code the export uses)
  // Same inset as the code block: tables align with the text column.
  '.ink-table-editable': {
    padding: '0 var(--ink-line-pad, 28px)',
  },
  '.ink-table-editable table': {
    borderCollapse: 'collapse',
    margin: '0.6em 0',
    width: '100%',
    fontFamily: 'var(--ink-sans, -apple-system, sans-serif)',
    fontSize: '0.86em',
  },
  '.ink-table-editable th, .ink-table-editable td': {
    border: '1px solid var(--ink-line, #e2e2e8)',
    padding: '6px 10px',
    // Empty cells should still breathe at the body line height.
    height: '1.9em',
    minWidth: '48px',
    verticalAlign: 'top',
    cursor: 'text',
  },
  '.ink-table-editable th': {
    background: 'var(--ink-code-bg, #f3f3f6)',
    fontWeight: '600',
  },
  '.ink-table-editable th:hover, .ink-table-editable td:hover': {
    backgroundColor: 'var(--ink-hover, rgba(20, 20, 30, 0.05))',
  },
  '.ink-table-block': { padding: '0.35em var(--ink-line-pad, 28px)', overflowX: 'auto' },
  '.ink-table-block table': {
    borderCollapse: 'collapse',
    margin: '0 auto',
    fontSize: '0.9em',
  },
  '.ink-table-block th, .ink-table-block td': {
    border: '1px solid var(--ink-line, #e2e2e8)',
    padding: '4px 10px',
    textAlign: 'left',
  },
  '.ink-table-block th': {
    backgroundColor: 'var(--ink-chrome, #f5f5f8)',
    fontFamily: 'var(--ink-sans, -apple-system, sans-serif)',
  },

  // Maths
  '.ink-math': { fontSize: '1em' },
  '.ink-math-body': { display: 'inline-block' },
  '.ink-math-block': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    margin: '0.15em 0',
    overflowX: 'auto',
  },
  '.ink-math-error': {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '0.82em',
    color: 'var(--ink-bad, #b3261e)',
    backgroundColor: 'rgba(179, 38, 30, 0.08)',
    borderRadius: '3px',
    padding: '0 3px',
  },

  // The source panel is drawn per line with edge shadows, since a display block
  // or a fence is several lines rather than one element. Display maths and code
  // share the frame: both are "a block you are inside of".
  // Margins mirror the line padding so the frame's edges land on the text
  // column, exactly like the rendered code box it turns into.
  '.ink-block-editing': {
    backgroundColor: 'var(--ink-code-bg, #f3f3f6)',
    marginLeft: 'var(--ink-line-pad, 28px)',
    marginRight: 'var(--ink-line-pad, 28px)',
    paddingLeft: '12px',
    paddingRight: '12px',
    boxShadow: '-1px 0 0 var(--ink-line, #e2e2e8), 1px 0 0 var(--ink-line, #e2e2e8)',
  },
  '.ink-block-editing-first': {
    borderTopLeftRadius: '6px',
    borderTopRightRadius: '6px',
    paddingTop: '4px',
    boxShadow:
      '0 -1px 0 var(--ink-line, #e2e2e8), -1px 0 0 var(--ink-line, #e2e2e8), 1px 0 0 var(--ink-line, #e2e2e8)',
  },
  '.ink-block-editing-last': {
    borderBottomLeftRadius: '6px',
    borderBottomRightRadius: '6px',
    paddingBottom: '4px',
    boxShadow:
      '0 1px 0 var(--ink-line, #e2e2e8), -1px 0 0 var(--ink-line, #e2e2e8), 1px 0 0 var(--ink-line, #e2e2e8)',
  },
  '.ink-math-preview': {
    margin: '4px var(--ink-line-pad, 28px) 10px',
    padding: '10px 14px',
    borderRadius: '6px',
    border: '1px solid var(--ink-line, #e2e2e8)',
    backgroundColor: 'var(--ink-paper, #fff)',
    boxShadow: '0 8px 24px rgba(20, 20, 30, 0.10)',
    overflowX: 'auto',
  },

  '.ink-hidden': { display: 'none' },
});
