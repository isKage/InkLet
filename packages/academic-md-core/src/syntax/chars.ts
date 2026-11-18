/** Character predicates shared by the dialect's parsers. */

export const COLON = 58;
export const STAR = 42;
export const LBRACE = 123;
export const RBRACE = 125;
export const BACKSLASH = 92;
export const DOLLAR = 36;
export const NEWLINE = 10;
export const CARRIAGE = 13;

export const isBlankText = (code: number): boolean =>
  code === 32 || code === 9 || code === CARRIAGE || code === NEWLINE;

export const isNameChar = (code: number): boolean =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
