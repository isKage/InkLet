export type {
  Diagnostic,
  DiagnosticCode,
  ExportContext,
  HeadingAnchor,
  MacroTable,
  MacroValue,
  ParseOptions,
  ParsedDocument,
  SourceRange,
} from './types.js';

export { academicParser, createAcademicParser } from './parser.js';
export { parseDocument } from './document.js';
export { analyze, headingText } from './analysis.js';
export type { AnalysisInput, AnalysisResult } from './analysis.js';
export { parseFrontMatter } from './front-matter.js';
export type { FrontMatter } from './front-matter.js';
export { extractMathSource } from './math-source.js';
export { dumpTree } from './debug.js';
export { escapeHTML, renderHTML, renderNodeHTML } from './render-html.js';
export type { MathOutput, RenderOptions } from './render-html.js';
export {
  MATH_NODES,
  NodeNames,
  academicMarkdown,
  formatExtension,
  underline,
  displayMath,
  inlineMath,
  mathExtension,
} from './syntax/index.js';
export type { MathNodeName } from './syntax/index.js';
