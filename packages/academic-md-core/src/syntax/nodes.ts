/**
 * Node names produced by the dialect.
 *
 * The tree stays a normal Lezer Markdown tree — these are added node types, not
 * a parallel AST. Downstream code (editor decorations, export, diagnostics)
 * locates constructs by these names and their source ranges.
 */
export const NodeNames = {
  // --- maths
  InlineMath: 'InlineMath',
  DisplayMath: 'DisplayMath',
  MathContent: 'MathContent',
  MathMark: 'MathMark',

  // --- inline formatting the dialect adds (Markdown has no underline)
  Underline: 'Underline',
  UnderlineMark: 'UnderlineMark',
} as const;

export type MathNodeName = 'InlineMath' | 'DisplayMath' | 'MathContent' | 'MathMark';
