import { EditorView, WidgetType } from '@codemirror/view';

export interface MathOutput {
  readonly html: string;
  readonly error?: string;
}

/** TeX → SVG, injected so this package never imports a DOM-bound renderer. */
export type MathRender = (tex: string, options: { display: boolean }) => MathOutput;

/** Fenced code → highlighted HTML (already escaped), or `null` for plain text. */
export type HighlightCode = (code: string, language: string | null) => string | null;

/**
 * Resolves a document-relative image path to something an `<img>` can load
 * (a data URI in the desktop shell). `null` means "cannot display".
 */
export type ImageResolver = (src: string) => Promise<string | null>;

export function fallbackRenderMath(tex: string): MathOutput {
  return { html: `<code>${tex.replace(/[&<>]/g, '')}</code>`, error: 'no renderer' };
}

/**
 * Bumped when the maths engine is reconfigured (e.g. new macros). Widgets carry
 * the generation so a stale DOM — for instance a formula rendered before its
 * macro was known — is rebuilt instead of being reused by `eq`.
 */
let generation = 0;

export function bumpMathGeneration(): void {
  generation += 1;
}

export function mathGeneration(): number {
  return generation;
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Maps a click inside a rendered construct back to a document position.
 *
 * The rendered layout does not correspond to the source line by line, so this is
 * deliberately coarse: the vertical position picks the source line, the
 * horizontal position picks the character within it. Clicking a formula should
 * put the caret "about there" and reveal the source, not be a dead zone.
 */
function caretFromClick(view: EditorView, event: MouseEvent, from: number, to: number): number {
  const element = event.currentTarget as HTMLElement | null;
  if (!element) return from;
  const rect = element.getBoundingClientRect();
  const x = clamp01((event.clientX - rect.left) / Math.max(1, rect.width));
  const y = clamp01((event.clientY - rect.top) / Math.max(1, rect.height));

  const text = view.state.doc.sliceString(from, to);
  const lines = text.split('\n');
  const index = Math.min(lines.length - 1, Math.floor(y * lines.length));

  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += (lines[i] ?? '').length + 1;
  offset += Math.round(x * (lines[index] ?? '').length);

  return Math.max(from, Math.min(to, from + offset));
}

/** Clicking a widget moves the caret into the construct, which reveals its source. */
function attachCaret(view: EditorView, element: HTMLElement, from: number, to: number): void {
  element.addEventListener('mousedown', (event) => {
    event.preventDefault();
    view.dispatch({ selection: { anchor: caretFromClick(view, event, from, to) } });
    view.focus();
  });
}

class MathWidget extends WidgetType {
  constructor(
    private readonly tex: string,
    private readonly display: boolean,
    private readonly renderMath: MathRender,
    private readonly range: { from: number; to: number },
    private readonly generation = mathGeneration()
  ) {
    super();
  }

  /** Comparing by source keeps the DOM (and the MathJax work) stable. */
  override eq(other: MathWidget): boolean {
    return (
      other.tex === this.tex &&
      other.display === this.display &&
      other.generation === this.generation &&
      other.range.from === this.range.from &&
      other.range.to === this.range.to
    );
  }

  override get estimatedHeight(): number {
    return this.display ? 44 : -1;
  }

  override ignoreEvent(): boolean {
    return true;
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = document.createElement(this.display ? 'div' : 'span');
    host.className = this.display ? 'ink-math-block' : 'ink-math';

    const out = this.renderMath(this.tex, { display: this.display });
    const holder = document.createElement('span');
    holder.className = out.error ? 'ink-math-error' : 'ink-math-body';
    if (out.error) {
      holder.textContent = this.tex;
      holder.title = out.error;
    } else {
      holder.innerHTML = out.html;
    }
    host.append(holder);

    attachCaret(view, host, this.range.from, this.range.to);
    return host;
  }
}

export class InlineMathWidget extends MathWidget {
  constructor(tex: string, renderMath: MathRender, range: { from: number; to: number }) {
    super(tex, false, renderMath, range);
  }
}

export class DisplayMathWidget extends MathWidget {
  constructor(tex: string, renderMath: MathRender, range: { from: number; to: number }) {
    super(tex, true, renderMath, range);
  }
}

/**
 * A pre-rendered block of HTML (tables today). Built with the same renderer the
 * export uses, so the two cannot drift.
 */
export class HtmlBlockWidget extends WidgetType {
  constructor(
    private readonly html: string,
    private readonly className: string,
    private readonly range: { from: number; to: number }
  ) {
    super();
  }

  override eq(other: HtmlBlockWidget): boolean {
    return (
      other.html === this.html &&
      other.className === this.className &&
      other.range.from === this.range.from &&
      other.range.to === this.range.to
    );
  }

  override ignoreEvent(): boolean {
    return true;
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = document.createElement('div');
    host.className = this.className;
    host.innerHTML = this.html;
    attachCaret(view, host, this.range.from, this.range.to);
    return host;
  }
}

/** A list bullet or the original number of an ordered item. */
export class ListMarkWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly ordered: boolean
  ) {
    super();
  }

  override eq(other: ListMarkWidget): boolean {
    return other.text === this.text && other.ordered === this.ordered;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = this.ordered ? 'ink-list-number' : 'ink-list-mark';
    span.textContent = this.text;
    return span;
  }
}

/** GFM task-list checkbox, rendered read-only (clicking the line reveals source). */
export class TaskMarkerWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  override eq(other: TaskMarkerWidget): boolean {
    return other.checked === this.checked;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'ink-task';
    span.textContent = this.checked ? '☑' : '☐';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

/**
 * An image resolved through an injected resolver. The desktop shell returns a
 * data URI read from the workspace; the browser has no resolver and shows a
 * labelled placeholder instead of a broken image icon.
 */
export class ImageWidget extends WidgetType {
  constructor(
    private readonly spec: {
      readonly src: string;
      readonly alt: string;
      readonly range: { from: number; to: number };
      readonly resolve?: ImageResolver;
    }
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return (
      other.spec.src === this.spec.src &&
      other.spec.alt === this.spec.alt &&
      other.spec.resolve === this.spec.resolve &&
      other.spec.range.from === this.spec.range.from &&
      other.spec.range.to === this.spec.range.to
    );
  }

  override ignoreEvent(): boolean {
    return true;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'ink-image';
    const label = this.spec.alt || this.spec.src;

    const missing = (): void => {
      wrap.classList.add('ink-image-missing');
      wrap.textContent = `图：${label}`;
    };

    if (!this.spec.resolve) {
      missing();
    } else {
      const image = document.createElement('img');
      image.className = 'ink-image-el';
      image.alt = this.spec.alt;
      image.addEventListener('load', () => view.requestMeasure());
      wrap.append(image);
      this.spec
        .resolve(this.spec.src)
        .then((url) => {
          if (url) image.src = url;
          else {
            image.remove();
            missing();
          }
        })
        .catch(() => {
          image.remove();
          missing();
        });
    }

    attachCaret(view, wrap, this.spec.range.from, this.spec.range.to);
    return wrap;
  }
}

/**
 * Live preview shown under a display-maths block while it is being edited, so
 * the formula is visible without leaving the source.
 */
export class MathPreviewWidget extends WidgetType {
  constructor(
    private readonly tex: string,
    private readonly renderMath: MathRender,
    private readonly generation = mathGeneration()
  ) {
    super();
  }

  override eq(other: MathPreviewWidget): boolean {
    return other.tex === this.tex && other.generation === this.generation;
  }

  override ignoreEvent(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'ink-math-preview';
    const out = this.renderMath(this.tex, { display: true });
    if (out.error) {
      const error = document.createElement('span');
      error.className = 'ink-math-error';
      error.textContent = this.tex;
      error.title = out.error;
      panel.append(error);
    } else {
      panel.innerHTML = out.html;
    }
    return panel;
  }
}

/** Placeholder for block replacements that should collapse to nothing. */
/** A thematic break (`---`, `***`, `___`) drawn where its source line was. */
export class RuleWidget extends WidgetType {
  constructor(private readonly range: { from: number; to: number }) {
    super();
  }

  override eq(other: RuleWidget): boolean {
    return other.range.from === this.range.from && other.range.to === this.range.to;
  }

  override ignoreEvent(): boolean {
    return true;
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = document.createElement('div');
    host.className = 'ink-rule';
    host.append(document.createElement('hr'));
    attachCaret(view, host, this.range.from, this.range.to);
    return host;
  }
}

export class EmptyWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'ink-hidden';
    return span;
  }

  override get estimatedHeight(): number {
    return 0;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}
