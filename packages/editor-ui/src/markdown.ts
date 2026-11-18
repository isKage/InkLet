import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { academicMarkdown } from '@inklet/academic-md-core';

/**
 * CodeMirror language for the academic dialect.
 *
 * Uses the same `academicMarkdown` extension as `parseDocument`, so the tree the
 * editor decorates and the semantics the app displays come from one grammar.
 * `markdownLanguage` brings GFM (tables, strikethrough) in as the base.
 */
export const academicLanguage = markdown({
  base: markdownLanguage,
  extensions: [academicMarkdown],
  // `markdown()` otherwise binds Enter to "continue the list marker" and Backspace
  // to "delete the markup". Both are surprising when the file is the source of
  // truth and the user types their own numbering and indentation.
  addKeymap: false,
});
