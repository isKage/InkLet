/**
 * Syntax-highlight colours, in one place.
 *
 * The editor and the PDF read the same table: the editor swaps the values for
 * CSS variables (so dark mode is one rule set in styles.css), the print sheet
 * uses the light values directly because paper is always light.
 */
export interface HighlightToken {
  /** highlight.js class name, without the leading dot. */
  readonly cls: string;
  /** CSS variable that overrides the colour per theme. */
  readonly name: string;
  /** Light-theme colour, also used for print and as the variable fallback. */
  readonly fallback: string;
  readonly italic?: boolean;
}

export const HIGHLIGHT_TOKENS: ReadonlyArray<HighlightToken> = [
  { cls: 'hljs-comment', name: '--hl-comment', fallback: '#7b8794', italic: true },
  { cls: 'hljs-quote', name: '--hl-comment', fallback: '#7b8794', italic: true },
  { cls: 'hljs-keyword', name: '--hl-keyword', fallback: '#8a3fa8' },
  { cls: 'hljs-selector-tag', name: '--hl-keyword', fallback: '#8a3fa8' },
  { cls: 'hljs-literal', name: '--hl-literal', fallback: '#a15c00' },
  { cls: 'hljs-number', name: '--hl-literal', fallback: '#a15c00' },
  { cls: 'hljs-string', name: '--hl-string', fallback: '#2f7d32' },
  { cls: 'hljs-doctag', name: '--hl-string', fallback: '#2f7d32' },
  { cls: 'hljs-regexp', name: '--hl-string', fallback: '#2f7d32' },
  { cls: 'hljs-title', name: '--hl-title', fallback: '#1a5fb4' },
  { cls: 'hljs-section', name: '--hl-title', fallback: '#1a5fb4' },
  { cls: 'hljs-name', name: '--hl-title', fallback: '#1a5fb4' },
  { cls: 'hljs-built_in', name: '--hl-type', fallback: '#0f6f8c' },
  { cls: 'hljs-type', name: '--hl-type', fallback: '#0f6f8c' },
  { cls: 'hljs-attr', name: '--hl-attr', fallback: '#9a4a12' },
  { cls: 'hljs-attribute', name: '--hl-attr', fallback: '#9a4a12' },
  { cls: 'hljs-variable', name: '--hl-attr', fallback: '#9a4a12' },
  { cls: 'hljs-symbol', name: '--hl-attr', fallback: '#9a4a12' },
  { cls: 'hljs-meta', name: '--hl-meta', fallback: '#6b6b76' },
  { cls: 'hljs-params', name: '--hl-plain', fallback: '#3a3a44' },
  { cls: 'hljs-emphasis', name: '--hl-plain', fallback: '#3a3a44', italic: true },
];

/** Rules for the print sheet, where the light values are simply the values. */
export function highlightCssText(): string {
  return HIGHLIGHT_TOKENS.map(
    (token) =>
      `.${token.cls}{color:${token.fallback}${token.italic ? ';font-style:italic' : ''}}`
  ).join('\n');
}
