import { GFM, parser as baseParser, type MarkdownExtension } from '@lezer/markdown';
import { academicMarkdown } from './syntax/index.js';

/**
 * The dialect as a configured Lezer Markdown parser: GFM (tables, strikethrough,
 * autolinks, task lists) plus our maths extension.
 *
 * The editor passes this to `@codemirror/lang-markdown`, so there is exactly one
 * grammar behind preview, diagnostics and export.
 */
export function createAcademicParser(...extra: readonly MarkdownExtension[]) {
  // Setext headings are off on purpose: `---` under a paragraph is far more
  // often a divider than a request to promote the paragraph above it to a
  // heading, and the surprise was that the text above changed size the moment
  // Enter was pressed. `#`-style headings are the documented way.
  return baseParser.configure([GFM, academicMarkdown, { remove: ['SetextHeading'] }, ...extra]);
}

/**
 * Shared parser instance. `parseDocument` is called on every keystroke, and
 * reconfiguring a parser per call would allocate a node set each time.
 */
export const academicParser = createAcademicParser();
