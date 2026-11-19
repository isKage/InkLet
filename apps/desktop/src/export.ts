import type { ParsedDocument } from '@inklet/academic-md-core';

/** Assembly of the standalone HTML that the PDF export prints. */

/** Print stylesheet for the exported document. */
import { highlightCssText } from '@inklet/editor-ui';

export const PRINT_CSS = `
@page { size: A4; margin: 20mm 18mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #17171d; background: #fff;
  font-family: "Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", Georgia, serif;
  font-size: 11.5pt; line-height: 1.75; }
h1, h2, h3, h4, h5, h6 { font-family: "PingFang SC", -apple-system, "Helvetica Neue", sans-serif;
  line-height: 1.35; margin: 1.3em 0 0.5em; page-break-after: avoid; }
h1 { font-size: 1.9em; } h2 { font-size: 1.45em; } h3 { font-size: 1.2em; }
h4, h5, h6 { font-size: 1.05em; }
p { margin: 0.65em 0; text-align: justify; }
ul, ol { margin: 0.6em 0; padding-left: 2em; }
li { margin: 0.25em 0; }
.math-block { text-align: center; margin: 1em 0; page-break-inside: avoid; }
.math-block .eq-number { float: right; }
.math-error { color: #b3261e; font-family: "SF Mono", Menlo, monospace; font-size: 9.5pt; }
pre { background: #f5f5f7; padding: 10px 12px; border-radius: 4px; font-size: 9.5pt;
  line-height: 1.5; white-space: pre-wrap; page-break-inside: avoid; }
code { font-family: "SF Mono", Menlo, monospace; font-size: 0.92em; }
table { border-collapse: collapse; margin: 1em auto; font-size: 10.5pt; page-break-inside: avoid; }
th, td { border: 1px solid #d8d8de; padding: 4px 10px; }
th { background: #f5f5f7; }
blockquote { margin: 0.8em 0; padding: 7px 14px; border-left: 3px solid #d8d8de;
  background: #f5f5f7; border-radius: 4px; color: #3a3a44; }
blockquote p { margin: 0.25em 0; }
img { max-width: 100%; }
.image-placeholder { color: #55555f; font-style: italic; }
${highlightCssText()}
`;

export function printDocument(title: string, body: string): string {
  const safeTitle = title.replace(/[<>&"]/g, '');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<title>${safeTitle}</title><style>${PRINT_CSS}</style></head>` +
    `<body><main class="ink-doc">${body}</main></body></html>`;
}

/** Every image target in the document, so the export can inline them. */
export function imageTargets(parsed: ParsedDocument): string[] {
  const targets = new Set<string>();
  parsed.tree.iterate({
    enter(node) {
      if (node.name !== 'Image') return;
      const url = node.node.getChild('URL');
      if (url) targets.add(parsed.src.slice(url.from, url.to));
    },
  });
  return [...targets];
}

