import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';

/**
 * The terminal pane.
 *
 * xterm.js owns the screen and the key handling; every keystroke goes straight
 * to the PTY in Rust, and the PTY's output comes back as `terminal:data`
 * events. Collapsing only hides the pane — the shell keeps running — while
 * "close" kills the session and drops the buffer.
 */

interface TerminalOutput {
  id: number;
  data: string;
}

interface TerminalExit {
  id: number;
}

export interface TerminalStrings {
  /** Written into the scrollback when the shell exits. */
  readonly exited: string;
}

const LIGHT_ANSI: ITheme = {
  black: '#1b1b1f',
  red: '#b3261e',
  green: '#17703a',
  yellow: '#8a6d1f',
  blue: '#1556a3',
  magenta: '#8a3fa8',
  cyan: '#0f6f8c',
  white: '#d7d7e0',
  brightBlack: '#64646f',
  brightRed: '#c0392b',
  brightGreen: '#1f8a4c',
  brightYellow: '#a8821f',
  brightBlue: '#1f6fbf',
  brightMagenta: '#9b52b8',
  brightCyan: '#1b819c',
  brightWhite: '#ffffff',
};

export class TerminalPanel {
  private term: Terminal | null = null;
  private fit: FitAddon | null = null;
  private sessionId: number | null = null;
  private alive = false;
  private sizeObserver: ResizeObserver | null = null;
  /** Output that arrived before `terminal_open` returned its id. */
  private readonly early = new Map<number, string>();
  private readonly ready: Promise<void>;

  constructor(
    private readonly panel: HTMLElement,
    private readonly host: HTMLElement,
    private readonly cwdLabel: HTMLElement,
    private readonly strings: () => TerminalStrings
  ) {
    this.ready = this.wire();
  }

  private async wire(): Promise<void> {
    await listen<TerminalOutput>('terminal:data', (event) => {
      const { id, data } = event.payload;
      if (this.sessionId === null) {
        this.early.set(id, (this.early.get(id) ?? '') + data);
        return;
      }
      if (id === this.sessionId) this.term?.write(data);
    });
    await listen<TerminalExit>('terminal:exit', (event) => {
      if (event.payload.id !== this.sessionId) return;
      this.alive = false;
      this.term?.write(`\r\n\x1b[2m${this.strings().exited}\x1b[0m\r\n`);
    });
    new MutationObserver(() => {
      if (this.term) this.term.options.theme = this.theme();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  isOpen(): boolean {
    return !this.panel.classList.contains('hidden');
  }

  /** Shows the pane, starting a shell in `cwd` if there is none yet. */
  async open(cwd: string): Promise<void> {
    this.panel.classList.remove('hidden');
    this.cwdLabel.textContent = cwd;
    this.cwdLabel.title = cwd;
    await this.ready;
    this.ensureTerminal();
    if (this.sessionId === null || !this.alive) {
      if (this.term && !this.alive) this.term.reset();
      await this.start(cwd);
    }
    requestAnimationFrame(() => {
      this.fitNow();
      this.term?.focus();
    });
  }

  /** Hides the pane but keeps the shell running. */
  collapse(): void {
    this.panel.classList.add('hidden');
  }

  /** Kills the shell and forgets the buffer. */
  async close(): Promise<void> {
    const id = this.sessionId;
    this.sessionId = null;
    this.alive = false;
    if (id !== null) await invoke('terminal_close', { id }).catch(() => undefined);
    this.sizeObserver?.disconnect();
    this.sizeObserver = null;
    this.term?.dispose();
    this.term = null;
    this.fit = null;
    this.host.replaceChildren();
    this.early.clear();
    this.panel.classList.add('hidden');
  }

  /** Re-fits the grid after the pane was resized by hand. */
  refresh(): void {
    this.fitNow();
  }

  private ensureTerminal(): void {
    if (this.term) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      macOptionIsMeta: true,
      scrollback: 5000,
      theme: this.theme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    this.fit = fit;
    term.open(this.host);
    term.onData((data) => {
      if (this.sessionId !== null && this.alive) {
        void invoke('terminal_write', { id: this.sessionId, data }).catch(() => undefined);
      }
    });
    term.onResize(({ cols, rows }) => {
      if (this.sessionId !== null) {
        void invoke('terminal_resize', { id: this.sessionId, cols, rows }).catch(() => undefined);
      }
    });
    this.term = term;
    this.sizeObserver = new ResizeObserver(() => this.fitNow());
    this.sizeObserver.observe(this.host);
  }

  private async start(cwd: string): Promise<void> {
    const cols = this.term?.cols ?? 80;
    const rows = this.term?.rows ?? 24;
    const id = await invoke<number>('terminal_open', { cwd, cols, rows });
    this.sessionId = id;
    this.alive = true;
    const buffered = this.early.get(id);
    if (buffered) {
      this.term?.write(buffered);
      this.early.delete(id);
    }
  }

  private fitNow(): void {
    if (!this.term || !this.fit || this.panel.classList.contains('hidden')) return;
    try {
      this.fit.fit();
    } catch {
      /* The pane has no box yet; the ResizeObserver will call again. */
    }
  }

  private theme(): ITheme {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;
    const base: ITheme = {
      background: read('--ink-paper', '#ffffff'),
      foreground: read('--ink-fg', '#1b1b1f'),
      cursor: read('--ink-fg', '#1b1b1f'),
      cursorAccent: read('--ink-paper', '#ffffff'),
      selectionBackground: read('--ink-selection', 'rgba(168, 121, 47, 0.22)'),
    };
    if (document.documentElement.dataset.theme === 'dark') return base;
    return { ...base, ...LIGHT_ANSI };
  }
}
