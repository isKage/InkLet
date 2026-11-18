import { parse as parseYaml } from 'yaml';
import type { Diagnostic, MacroTable, MacroValue } from './types.js';

export interface FrontMatter {
  readonly macros: MacroTable;
  /** Offset where the document body starts (0 when there is no front matter). */
  readonly bodyFrom: number;
  readonly diagnostics: readonly Diagnostic[];
}

const EMPTY: FrontMatter = {
  macros: {},
  bodyFrom: 0,
  diagnostics: [],
};

const OPENING = /^---[ \t]*\r?\n/;
const CLOSING = /^(?:---|\.\.\.)[ \t]*\r?$/m;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the optional `---` YAML block at the top of a document.
 *
 * Only three settings exist on purpose: everything else belongs in the body
 * where it stays visible and shareable. Unknown keys are ignored rather than
 * rejected, so a file written for a newer version still opens.
 */
export function parseFrontMatter(src: string): FrontMatter {
  const opening = OPENING.exec(src);
  if (!opening) return EMPTY;

  const contentStart = opening[0].length;
  const closing = CLOSING.exec(src.slice(contentStart));
  if (!closing || closing.index === undefined) {
    // An unterminated `---` is just a horizontal rule; leave the document alone.
    return EMPTY;
  }

  const yamlText = src.slice(contentStart, contentStart + closing.index);
  const bodyFrom = contentStart + closing.index + closing[0].length + (src[contentStart + closing.index + closing[0].length] === '\n' ? 1 : 0);

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (error) {
    return {
      ...EMPTY,
      bodyFrom,
      diagnostics: [
        {
          severity: 'error',
          code: 'BadFrontMatter',
          message: `front matter 解析失败：${(error as Error).message}`,
          from: 0,
          to: bodyFrom,
        },
      ],
    };
  }

  if (!isRecord(parsed)) return { ...EMPTY, bodyFrom };

  const macros: Record<string, MacroValue> = {};
  const rawMacros = parsed['macros'];
  if (isRecord(rawMacros)) {
    for (const [rawKey, value] of Object.entries(rawMacros)) {
      const key = rawKey.trim().startsWith('\\') ? rawKey.trim() : `\\${rawKey.trim()}`;
      if (typeof value === 'string') macros[key] = value;
      else if (Array.isArray(value) && typeof value[0] === 'string') {
        const count = typeof value[1] === 'number' ? value[1] : 0;
        macros[key] = count > 0 ? [value[0], count] : value[0];
      }
    }
  }

  return { macros, bodyFrom, diagnostics: [] };
}
