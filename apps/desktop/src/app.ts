import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { invoke } from '@tauri-apps/api/core';
import { parseDocument, renderHTML } from '@inklet/academic-md-core';
import { CODE_LANGUAGES, highlightCode } from './highlight.js';
import { save } from '@tauri-apps/plugin-dialog';
import type { ParsedDocument } from '@inklet/academic-md-core';
import {
  bumpMathGeneration,
  createEditor,
  jumpToPosition,
  refreshDecorations,
  replaceDocument,
  setEditorMode,
} from '@inklet/editor-ui';
import { createMathRenderer } from '@inklet/math-render';
import { GUIDE } from './guide.js';
import { STRINGS, type Lang, type Strings } from './i18n.js';
import { insertText as insertTextSpec, toggleLinePrefix, wrapInFence, wrapSelection } from './formatting.js';
import { imageTargets, printDocument } from './export.js';
import { buildTable } from './formatting.js';
import { resolveLink } from './links.js';
import { TerminalPanel } from './terminal.js';
import * as ws from './workspace.js';
import './styles.css';

const math = createMathRenderer();
const renderMath = (tex: string, options: { display: boolean }): { html: string; error?: string } =>
  math.render(tex, options);

const mathStyle = document.createElement('style');
mathStyle.textContent = math.styles();
document.head.append(mathStyle);

const must = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
};

const editorHost = must('editorHost');
const previewHost = must('previewHost');
const previewPane = must('previewPane');
const emptyState = must('emptyState');
const emptyOpen = must<HTMLButtonElement>('emptyOpen');
const settingsPanel = must('settingsPanel');
const settingsClose = must<HTMLButtonElement>('settingsClose');
const contextMenu = must('contextMenu');
const renamePanel = must('renamePanel');
const renameInput = must<HTMLInputElement>('renameInput');
const renameTitle = must('renameTitle');
const renameConfirm = must<HTMLButtonElement>('renameConfirm');
const renameCancel = must<HTMLButtonElement>('renameCancel');
const newEntryButton = must<HTMLButtonElement>('newEntry');
const newPanel = must('newPanel');
const newTitle = must('newTitle');
const newKindLabel = must('newKindLabel');
const newNameLabel = must('newNameLabel');
const newName = must<HTMLInputElement>('newName');
const newFileButton = must<HTMLButtonElement>('newFile');
const newDirButton = must<HTMLButtonElement>('newDir');
const newCreate = must<HTMLButtonElement>('newCreate');
const newCancel = must<HTMLButtonElement>('newCancel');
const codePanel = must('codePanel');
const codeTitle = must('codeTitle');
const codeLangLabel = must('codeLangLabel');
const codeLangSelect = must<HTMLSelectElement>('codeLangSelect');
const codeInsert = must<HTMLButtonElement>('codeInsert');
const codeCancel = must<HTMLButtonElement>('codeCancel');
const tablePanel = must('tablePanel');
const tableRowsEl = must('tableRows');
const tableColsEl = must('tableCols');
const tableTitle = must('tableTitle');
const tableRowsLabel = must('tableRowsLabel');
const tableColsLabel = must('tableColsLabel');
const tableInsert = must<HTMLButtonElement>('tableInsert');
const tableCancel = must<HTMLButtonElement>('tableCancel');
const tableRowsUp = must<HTMLButtonElement>('tableRowsUp');
const tableRowsDown = must<HTMLButtonElement>('tableRowsDown');
const tableColsUp = must<HTMLButtonElement>('tableColsUp');
const tableColsDown = must<HTMLButtonElement>('tableColsDown');
const setTheme = must('setTheme');
const setLang = must('setLang');
const fontValue = must('fontValue');
const fontUp = must<HTMLButtonElement>('fontUp');
const fontDown = must<HTMLButtonElement>('fontDown');
const settingsTitle = must('settingsTitle');
const catEditor = must<HTMLButtonElement>('catEditor');
const catLook = must<HTMLButtonElement>('catLook');
const catKeys = must<HTMLButtonElement>('catKeys');
const settingEditorSize = must('settingEditorSize');
const settingLeading = must('settingLeading');
const settingParaGap = must('settingParaGap');
const settingPageMargin = must('settingPageMargin');
const editorValue = must('editorValue');
const leadingValue = must('leadingValue');
const paraGapValue = must('paraGapValue');
const pageMarginValue = must('pageMarginValue');
const editorUp = must<HTMLButtonElement>('editorUp');
const editorDown = must<HTMLButtonElement>('editorDown');
const leadingUp = must<HTMLButtonElement>('leadingUp');
const leadingDown = must<HTMLButtonElement>('leadingDown');
const paraGapUp = must<HTMLButtonElement>('paraGapUp');
const paraGapDown = must<HTMLButtonElement>('paraGapDown');
const pageMarginUp = must<HTMLButtonElement>('pageMarginUp');
const pageMarginDown = must<HTMLButtonElement>('pageMarginDown');
const shortcutList = must('shortcutList');
const settingAppearance = must('settingAppearance');
const settingFont = must('settingFont');
const settingLanguage = must('settingLanguage');
const themeLight = must<HTMLButtonElement>('themeLight');
const themeSepia = must<HTMLButtonElement>('themeSepia');
const themeSlate = must<HTMLButtonElement>('themeSlate');
const themeDark = must<HTMLButtonElement>('themeDark');
const langZh = must<HTMLButtonElement>('langZh');
const langEn = must<HTMLButtonElement>('langEn');

const unsupportedState = must('unsupportedState');
const mediaState = must('mediaState');
const mediaImage = must<HTMLImageElement>('mediaImage');
const mediaPdf = must<HTMLIFrameElement>('mediaPdf');
const mediaNote = must('mediaNote');


const treeEl = must('tree');
const dropHintEl = must('dropHint');
const dropTitleEl = must('dropTitle');
const dropSubEl = must('dropSub');
const brandEl = must('brand');
const unsupportedTitleEl = must('unsupportedTitle');
const sidebarEl = must('sidebar');
const sidebarToggle = must<HTMLButtonElement>('sidebarToggle');
const sidebarResizerEl = must<HTMLElement>('sidebarResizer');
const tabsEl = must('tabs');
const modeLabel = must('modeLabel');
const statusEl = must('status');
const saveEl = must('saveState');
const diagsEl = must('diagnostics');

const toastEl = must('toast');
const modalEl = must('modal');
const modalTitle = must('modalTitle');
const modalBody = must('modalBody');
const modalActions = must('modalActions');
const noticeEl = must('notice');
const workspaceName = must('workspaceName');
const panelFiles = must<HTMLButtonElement>('panelFiles');
const panelOutline = must<HTMLButtonElement>('panelOutline');
const outlineEl = must('outline');
const openFolderButton = must<HTMLButtonElement>('openFolder');

const themeToggle = must<HTMLButtonElement>('themeToggle');
const terminalToggle = must<HTMLButtonElement>('terminalToggle');
const terminalPanel = must('terminalPanel');
const terminalHost = must('terminalHost');
const terminalCwdEl = must('terminalCwd');
const terminalTitle = must('terminalTitle');
const terminalCollapse = must<HTMLButtonElement>('terminalCollapse');
const terminalKill = must<HTMLButtonElement>('terminalKill');
const terminalResizer = must('terminalResizer');

// The terminal only exists in the desktop shell: a browser tab has no PTY.
const terminal = ws.isDesktopShell
  ? new TerminalPanel(terminalPanel, terminalHost, terminalCwdEl, () => ({
      exited: t().terminalExited,
    }))
  : null;

type Mode = 'live' | 'split';
/**
 * The built-in themes. Each is one palette in `styles.css` under
 * `:root[data-theme="…"]`; the document, the chrome and the code tokens all read
 * from those variables, so a theme is a colour set and nothing else.
 */
const THEMES = ['light', 'sepia', 'slate', 'dark'] as const;
type Theme = (typeof THEMES)[number];

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

interface OpenDoc {
  readonly rel: string;
  readonly name: string;
  /** Markdown gets live rendering; plain text is edited as-is. */
  readonly kind: 'markdown' | 'text';
  content: string;
  hash: string | null;
  dirty: boolean;
  conflict: boolean;
  /** The built-in guide: rendered normally, but never edited or written. */
  readonly readonly?: boolean;
}

const state = {
  root: null as string | null,
  entries: [] as ws.Entry[],
  open: [] as OpenDoc[],
  active: null as string | null,
  /** Folder the tree highlights: where a paste lands. '' is the workspace root. */
  selectedDir: null as string | null,
  panel: 'files' as 'files' | 'outline',
  /** Path of a file the tree shows but the editor cannot render. */
  unsupported: null as string | null,
  media: null as { rel: string; kind: MediaKind } | null,
  mode: 'live' as Mode,
};

// ---------------------------------------------------------------- theme

const SETTINGS_KEY = 'inklet.settings';
/** Stable key for the built-in guide tab, so its label can follow the language. */
const GUIDE_REL = 'guide';
/**
 * Bumped when a default changes in a way a stored value would hide. Upgrading
 * resets only the affected controls, never the whole dialog.
 */
const SETTINGS_VERSION = 2;
/** Extra space between paragraphs (em), on top of the leading. */
const DEFAULT_PARA_GAP = 0.9;
const MAX_PARA_GAP = 1.6;
/** Horizontal inset between the page edge and the text column (px). */
const DEFAULT_PAGE_MARGIN = 28;
const MIN_PAGE_MARGIN = 0;
const MAX_PAGE_MARGIN = 240;
/** Sidebar drag range (px). Below the threshold the sidebar collapses instead. */
const MIN_VISIBLE_SIDEBAR = 120;
const MAX_SIDEBAR_WIDTH = 460;
const DEFAULT_SIDEBAR_WIDTH = 224;
const COLLAPSED_SIDEBAR = 0;
const MIN_UI_SCALE = 0.85;
const MAX_UI_SCALE = 1.35;
const MIN_EDITOR_SIZE = 15;
const MAX_EDITOR_SIZE = 30;

interface Settings {
  readonly version: number;
  readonly theme: Theme;
  /** Chrome (menus, sidebar, dialogs) scale; the document has its own size. */
  readonly uiScale: number;
  /** Body text size of the document, changed from the 格式 menu. */
  readonly editorSize: number;
  /** Line height inside a paragraph. */
  readonly leading: number;
  /** Extra space between paragraphs (em). */
  readonly paraGap: number;
  /** Left/right inset of the text column; every block follows it. */
  readonly pageMargin: number;
  /** Sidebar width in px; 0 keeps it collapsed. */
  readonly sidebarWidth: number;
  readonly language: 'zh' | 'en';
}

function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      // Up to version 1 the gap defaulted to 0.35em, which was invisible next to
      // a 1.6 leading; keeping that value would make the new spacing look broken.
      const storedGap = saved.version === SETTINGS_VERSION ? Number(saved.paraGap) : DEFAULT_PARA_GAP;
      return {
        version: SETTINGS_VERSION,
        theme: isTheme(saved.theme) ? saved.theme : 'light',
        uiScale: Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Number(saved.uiScale) || 1)),
        editorSize: Math.min(
          MAX_EDITOR_SIZE,
          Math.max(MIN_EDITOR_SIZE, Number(saved.editorSize) || 19)
        ),
        leading: Math.min(2.2, Math.max(1.2, Number(saved.leading) || 1.6)),
        paraGap: Math.min(MAX_PARA_GAP, Math.max(0, Number.isFinite(storedGap) ? storedGap : DEFAULT_PARA_GAP)),
        pageMargin: Math.min(
          MAX_PAGE_MARGIN,
          Math.max(MIN_PAGE_MARGIN, Number(saved.pageMargin) || DEFAULT_PAGE_MARGIN)
        ),
        sidebarWidth: Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(0, Number(saved.sidebarWidth) || DEFAULT_SIDEBAR_WIDTH)
        ),
        language: saved.language === 'en' ? 'en' : 'zh',
      };
    }
  } catch {
    /* corrupt or unavailable storage: fall through to defaults */
  }
  // Light and Chinese are the product defaults; the OS preference is not used.
  return {
    version: SETTINGS_VERSION,
    theme: 'light',
    uiScale: 1,
    editorSize: 19,
    leading: 1.6,
    paraGap: DEFAULT_PARA_GAP,
    pageMargin: DEFAULT_PAGE_MARGIN,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    language: 'zh',
  };
}

let settings: Settings = loadSettings();

/** Current interface strings. */
function t(): Strings {
  return STRINGS[settings.language as Lang];
}

/** Updates the static chrome text after a language change. */
function applyChromeLanguage(): void {
  const strings = t();
  openFolderButton.textContent = strings.openFolder;
  emptyOpen.textContent = strings.openFolder;
  panelFiles.textContent = strings.files;
  panelOutline.textContent = strings.outline;
  settingsTitle.textContent = strings.settings;
  settingAppearance.textContent = strings.appearance;
  themeLight.textContent = strings.light;
  themeSepia.textContent = strings.sepia;
  themeSlate.textContent = strings.slate;
  themeDark.textContent = strings.dark;
  settingFont.textContent = strings.fontSize;
  settingLanguage.textContent = strings.language;
  langZh.textContent = '中文';
  langEn.textContent = 'English';
  settingsClose.textContent = strings.done;
  brandEl.title = strings.brandTitle;
  unsupportedTitleEl.textContent = strings.cannotPreviewTitle;
  dropTitleEl.textContent = strings.dropTitle;
  dropSubEl.textContent = strings.dropSub;
  sidebarResizerEl.title = strings.resizerHint;
  sidebarToggle.title = strings.showSidebar;
  sidebarToggle.setAttribute('aria-label', strings.showSidebar);
  terminalTitle.textContent = strings.terminal;
  terminalToggle.title = strings.terminalOpen;
  terminalToggle.setAttribute('aria-label', strings.terminalOpen);
  terminalCollapse.title = strings.terminalCollapse;
  terminalCollapse.setAttribute('aria-label', strings.terminalCollapse);
  terminalKill.title = strings.terminalClose;
  terminalKill.setAttribute('aria-label', strings.terminalClose);
  terminalResizer.title = strings.terminalResizerHint;
  newEntryButton.title = strings.newEntry;
  mediaPdf.title = strings.pdfPreview;
  // The guide tab keeps its key but wears the current language. The key is a
  // literal here because this runs before `GUIDE_DOC` is initialised.
  state.open = state.open.map((doc) =>
    doc.rel === GUIDE_REL ? { ...doc, name: strings.guideTitle } : doc
  );
  document.documentElement.lang = settings.language === 'en' ? 'en' : 'zh-CN';
}

function persistSettings(): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private mode: the choice simply does not persist */
  }
}

function applyTheme(theme: Theme): void {
  settings = { ...settings, theme };
  document.documentElement.dataset['theme'] = theme;
  // The toolbar button is a shortcut for the one distinction that changes the
  // whole look (dark vs everything else), not a fifth theme.
  const dark = theme === 'dark';
  themeToggle.textContent = dark ? '☀' : '☾';
  themeToggle.title = dark ? t().switchToLight : t().switchToDark;
  persistSettings();
  syncSettingsUi();
}

/** Scales the application chrome only; the document keeps its own size. */
function applyUiScale(scale: number): void {
  const bounded = Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Math.round(scale * 100) / 100));
  settings = { ...settings, uiScale: bounded };
  document.documentElement.style.setProperty('--ink-ui-scale', String(bounded));
  persistSettings();
  syncSettingsUi();
}

/** Document body size, driven from the 格式 menu and ⌘+ / ⌘-. */
function applyEditorSize(size: number): void {
  const bounded = Math.min(MAX_EDITOR_SIZE, Math.max(MIN_EDITOR_SIZE, Math.round(size)));
  settings = { ...settings, editorSize: bounded };
  document.documentElement.style.setProperty('--ink-editor-size', `${bounded}px`);
  persistSettings();
  syncSettingsUi();
}

function applyLeading(value: number): void {
  const bounded = Math.min(2.2, Math.max(1.2, Math.round(value * 20) / 20));
  settings = { ...settings, leading: bounded };
  document.documentElement.style.setProperty('--ink-editor-leading', String(bounded));
  persistSettings();
  syncSettingsUi();
}

function applyParaGap(value: number): void {
  const bounded = Math.min(MAX_PARA_GAP, Math.max(0, Math.round(value * 20) / 20));
  settings = { ...settings, paraGap: bounded };
  document.documentElement.style.setProperty('--ink-para-gap', `${bounded}em`);
  persistSettings();
  syncSettingsUi();
}

/**
 * Width of the text column's side margins. One variable drives the prose lines,
 * the code and table blocks and the list hanging indent, so nothing drifts out of
 * alignment when it changes.
 */
function applyPageMargin(value: number): void {
  const bounded = Math.min(
    MAX_PAGE_MARGIN,
    Math.max(MIN_PAGE_MARGIN, Math.round(value))
  );
  settings = { ...settings, pageMargin: bounded };
  document.documentElement.style.setProperty('--ink-line-pad', `${bounded}px`);
  persistSettings();
  syncSettingsUi();
}

function stepEditorSize(delta: number): void {
  applyEditorSize(settings.editorSize + delta);
}

/** Captions inside environments follow the document language. */
function applyLanguage(language: 'zh' | 'en'): void {
  settings = { ...settings, language };
  persistSettings();
  syncSettingsUi();
  applyChromeLanguage();
  void invoke('set_language', { language }).catch(() => undefined);
  const doc = activeDoc();
  if (doc) {
    replaceDocument(editor, doc.content, editorOptions());
    if (previewView) replaceDocument(previewView, doc.content, previewOptions());
  }
  refreshChrome();
}

/** Reflects the current settings in the dialog's controls. */
function syncSettingsUi(): void {
  fontValue.textContent = `${Math.round(settings.uiScale * 100)}%`;
  editorValue.textContent = `${settings.editorSize}px`;
  leadingValue.textContent = settings.leading.toFixed(2);
  paraGapValue.textContent = `${settings.paraGap.toFixed(2)}em`;
  pageMarginValue.textContent = `${settings.pageMargin}px`;
  settingEditorSize.textContent = t().editorSize;
  settingLeading.textContent = t().leading;
  settingParaGap.textContent = t().paraGap;
  settingPageMargin.textContent = t().pageMargin;
  settingAppearance.textContent = t().appearance;
  catEditor.textContent = t().catEditor;
  catLook.textContent = t().catLook;
  catKeys.textContent = t().catKeys;
  renderShortcuts();
  for (const button of setTheme.querySelectorAll<HTMLButtonElement>('button')) {
    button.classList.toggle('active', button.dataset['theme'] === settings.theme);
  }
  for (const button of setLang.querySelectorAll<HTMLButtonElement>('button')) {
    button.classList.toggle('active', button.dataset['lang'] === settings.language);
  }
}

// ---------------------------------------------------------------- sidebar

/** The chrome is zoomed, so a pointer delta has to be divided by the zoom. */
function uiZoom(): number {
  const raw = Number(getComputedStyle(document.documentElement).getPropertyValue('--ink-ui-scale'));
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/**
 * Width of the left column, in px. Dragging it below `MIN_VISIBLE_SIDEBAR`
 * collapses the column rather than leaving a sliver; pulling it back out then
 * starts from zero, so the edge follows the pointer instead of jumping.
 */
/**
 * Narrower than this the header cannot show 「文件 | 大纲」 and the + button, so
 * the column is hidden instead of left as a strip of clipped labels — the same
 * call VSCode makes. Measured from the header itself so the threshold follows
 * the interface scale and the language.
 */
function minSidebarWidth(): number {
  // The folder name is excluded on purpose: it truncates, the tabs cannot.
  const tabs =
    panelFiles.offsetWidth + panelOutline.offsetWidth + newEntryButton.offsetWidth;
  return Math.max(MIN_VISIBLE_SIDEBAR, tabs + 16 + 8);
}

function applySidebarWidth(value: number, persist: boolean): void {
  const bounded = Math.min(MAX_SIDEBAR_WIDTH, Math.max(COLLAPSED_SIDEBAR, Math.round(value)));
  // Below the threshold the column is gone entirely, so the stored width snaps to
  // zero: that keeps the drag handle on the edge instead of floating near it.
  const width = bounded < minSidebarWidth() ? COLLAPSED_SIDEBAR : bounded;
  settings = { ...settings, sidebarWidth: width };
  document.documentElement.style.setProperty('--ink-sidebar-width', `${width}px`);
  const collapsed = width === COLLAPSED_SIDEBAR;
  sidebarEl.classList.toggle('collapsed', collapsed);
  sidebarToggle.classList.toggle('hidden', !collapsed);
  if (persist) persistSettings();
}

function resetSidebarWidth(): void {
  applySidebarWidth(DEFAULT_SIDEBAR_WIDTH, true);
}

sidebarResizerEl.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  const zoom = uiZoom();
  const startX = event.clientX;
  const startWidth = settings.sidebarWidth >= MIN_VISIBLE_SIDEBAR ? settings.sidebarWidth : 0;

  sidebarResizerEl.setPointerCapture(event.pointerId);
  sidebarResizerEl.classList.add('dragging');
  document.body.classList.add('resizing');

  const move = (moveEvent: PointerEvent): void => {
    applySidebarWidth(startWidth + (moveEvent.clientX - startX) / zoom, false);
  };
  const stop = (): void => {
    sidebarResizerEl.removeEventListener('pointermove', move);
    sidebarResizerEl.removeEventListener('pointerup', stop);
    sidebarResizerEl.removeEventListener('pointercancel', stop);
    sidebarResizerEl.classList.remove('dragging');
    document.body.classList.remove('resizing');
    persistSettings();
  };
  sidebarResizerEl.addEventListener('pointermove', move);
  sidebarResizerEl.addEventListener('pointerup', stop);
  sidebarResizerEl.addEventListener('pointercancel', stop);
});

// Double-click restores the default, the way most editors behave.
sidebarResizerEl.addEventListener('dblclick', resetSidebarWidth);

// The only way back once the column is gone.
sidebarToggle.addEventListener('click', resetSidebarWidth);

function openSettings(): void {
  syncSettingsUi();
  settingsPanel.classList.remove('hidden');
  settingsClose.focus();
}

function closeSettings(): void {
  settingsPanel.classList.add('hidden');
  editor.focus();
}

setTheme.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  const value = target?.dataset['theme'];
  if (isTheme(value)) applyTheme(value);
});

setLang.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  const value = target?.dataset['lang'];
  if (value === 'zh' || value === 'en') applyLanguage(value);
});

editorUp.addEventListener('click', () => stepEditorSize(1));
editorDown.addEventListener('click', () => stepEditorSize(-1));
leadingUp.addEventListener('click', () => applyLeading(settings.leading + 0.05));
leadingDown.addEventListener('click', () => applyLeading(settings.leading - 0.05));
paraGapUp.addEventListener('click', () => applyParaGap(settings.paraGap + 0.05));
paraGapDown.addEventListener('click', () => applyParaGap(settings.paraGap - 0.05));
pageMarginUp.addEventListener('click', () => applyPageMargin(settings.pageMargin + 4));
pageMarginDown.addEventListener('click', () => applyPageMargin(settings.pageMargin - 4));
for (const button of [catEditor, catLook, catKeys]) {
  button.addEventListener('click', () => {
    const category = button.dataset['cat'];
    for (const other of [catEditor, catLook, catKeys]) {
      other.classList.toggle('active', other === button);
    }
    for (const section of settingsPanel.querySelectorAll<HTMLElement>('section[data-cat]')) {
      section.classList.toggle('hidden', section.dataset['cat'] !== category);
    }
  });
}

function renderShortcuts(): void {
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['⌘S', t().save],
    ['⌘W', t().shortcutCloseTab],
    ['⌘N', t().shortcutNewWindow],
    ['⌘O', t().openFolder],
    ['⌘1 / ⌘2', `${t().livePreview} / ${t().splitView}`],
    ['⌘+ / ⌘−', `${t().editorSize} + −`],
    ['⌘⌥C', `${t().codeTitle}`],
  ];
  shortcutList.replaceChildren();
  for (const [keys, label] of rows) {
    if (!label) continue;
    const dt = document.createElement('dt');
    dt.textContent = keys;
    const dd = document.createElement('dd');
    dd.textContent = label;
    shortcutList.append(dt, dd);
  }
}

fontUp.addEventListener('click', () => applyUiScale(settings.uiScale + 0.05));
fontDown.addEventListener('click', () => applyUiScale(settings.uiScale - 0.05));
settingsClose.addEventListener('click', closeSettings);

applyLeading(settings.leading);
applyParaGap(settings.paraGap);
applyPageMargin(settings.pageMargin);
applySidebarWidth(settings.sidebarWidth, false);
applyUiScale(settings.uiScale);
applyEditorSize(settings.editorSize);
applyTheme(settings.theme);
applyChromeLanguage();
themeToggle.addEventListener('click', () => {
  applyTheme(settings.theme === 'dark' ? 'light' : 'dark');
});

// ---------------------------------------------------------------- editors

const imageCache = new Map<string, string | null>();

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** Collapses `.`/`..` so an image next to the note resolves predictably. */
function joinPath(base: string, relative: string): string {
  const parts = `${base ? `${base}/` : ''}${relative}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

/**
 * Images are resolved to data URIs (desktop) so no asset protocol or CSP scope is
 * involved. Stable identity matters: widgets compare it to avoid reloading.
 */
async function resolveImage(src: string): Promise<string | null> {
  if (/^(data:|https?:|blob:)/i.test(src)) return src;
  const active = activeDoc();
  if (!state.root || !active) return null;

  const rel = joinPath(dirname(active.rel), src);
  const cached = imageCache.get(rel);
  if (cached !== undefined) return cached;

  try {
    const uri = await ws.readImage(state.root, rel);
    imageCache.set(rel, uri);
    return uri;
  } catch {
    imageCache.set(rel, null);
    return null;
  }
}

const editor = createEditor(editorHost, '', {
  renderMath,
  resolveImage,
  mode: 'live',
  onChange: onEditorChange,
});

/**
 * The comparison pane is the *same* live-preview renderer in read-only mode.
 * Using one renderer is what makes the two modes agree; `renderHTML` stays the
 * export path.
 */
let previewView: ReturnType<typeof createEditor> | null = null;

/**
 * Scroll sync between the two panes, proportional to scrollable height.
 *
 * The two renderings have different heights, so exact line mapping is not
 * possible; a ratio keeps the viewport roughly on the same part of the document.
 * Suppression keys prevent the two scroll handlers from feeding each other.
 */
const scrollSuppressedUntil = new Map<'editor' | 'preview', number>();

function syncScroll(source: 'editor' | 'preview'): void {
  if (state.mode !== 'split' || !previewView) return;
  const now = performance.now();
  if ((scrollSuppressedUntil.get(source) ?? 0) > now) return;

  const from = source === 'editor' ? editor.scrollDOM : previewView.scrollDOM;
  const to = source === 'editor' ? previewView.scrollDOM : editor.scrollDOM;
  const fromMax = Math.max(1, from.scrollHeight - from.clientHeight);
  const toMax = Math.max(0, to.scrollHeight - to.clientHeight);

  scrollSuppressedUntil.set(source === 'editor' ? 'preview' : 'editor', now + 150);
  to.scrollTop = (from.scrollTop / fromMax) * toMax;
}

editor.scrollDOM.addEventListener('scroll', () => syncScroll('editor'), { passive: true });

function ensurePreviewView(): ReturnType<typeof createEditor> {
  if (previewView) return previewView;
  previewView = createEditor(previewHost, editor.state.doc.toString(), previewOptions());
  previewView.scrollDOM.addEventListener('scroll', () => syncScroll('preview'), { passive: true });
  return previewView;
}

function syncPreview(): void {
  if (!previewView) return;
  const text = editor.state.doc.toString();
  if (previewView.state.doc.toString() === text) return;
  previewView.dispatch({ changes: { from: 0, to: previewView.state.doc.length, insert: text } });
}

function activeDoc(): OpenDoc | undefined {
  return state.open.find((doc) => doc.rel === state.active);
}

function hasDocument(): boolean {
  return Boolean(activeDoc());
}

const MARKDOWN_FILE = /\.(md|markdown|mdown)$/i;

/** Formats the webview can draw itself. */
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const PDF_FILE = /\.pdf$/i;
type MediaKind = 'image' | 'pdf';

function mediaKind(path: string): MediaKind | null {
  if (IMAGE_FILE.test(path)) return 'image';
  if (PDF_FILE.test(path)) return 'pdf';
  return null;
}

/** Extensions we open as editable plain text. */
const TEXT_FILE =
  /\.(txt|text|json|jsonc|ya?ml|toml|ini|conf|csv|tsv|log|sh|bash|zsh|py|rb|js|mjs|cjs|ts|tsx|jsx|css|scss|html|htm|xml|sql|tex|bib|r|jl|go|rs|c|h|cpp|hpp|java|kt|swift|php|lua|makefile|gitignore)$/i;

function isMarkdown(path: string): boolean {
  return MARKDOWN_FILE.test(path);
}

function isTextFile(path: string): boolean {
  return TEXT_FILE.test(path) || TEXT_FILE.test(`.${path.split('.').pop() ?? ''}`);
}

function documentKind(path: string): 'markdown' | 'text' | null {
  if (isMarkdown(path)) return 'markdown';
  if (isTextFile(path)) return 'text';
  return null;
}

/**
 * Files that are not Markdown are listed, but opening one explains why not.
 * The current document is kept behind the panel so "返回" returns to it.
 */
function showUnsupported(rel: string): void {
  state.unsupported = rel;
  state.media = null;
  refreshChrome();
  renderTree();
}

/** An image or a PDF replaces the editor area; the open tabs stay as they are. */
async function showMedia(rel: string, kind: MediaKind): Promise<void> {
  state.media = { rel, kind };
  state.unsupported = null;
  refreshChrome();
  renderTree();
}

/**
 * Draws the file the tree says is selected. Images come back from Rust as a data
 * URI (the same path inline images use); PDFs are left to the webview's own
 * viewer through the asset protocol.
 */
async function renderMedia(): Promise<void> {
  const media = state.media;
  if (!media || !state.root) return;
  const isImage = media.kind === 'image';
  mediaImage.classList.toggle('hidden', !isImage);
  mediaPdf.classList.toggle('hidden', isImage);
  mediaNote.classList.add('hidden');

  if (isImage) {
    const src = await ws.readImage(state.root, media.rel).catch(() => null);
    if (!src) {
      mediaImage.classList.add('hidden');
      mediaNote.textContent = t().imageUnavailable;
      mediaNote.classList.remove('hidden');
      return;
    }
    mediaImage.src = src;
    mediaImage.alt = media.rel;
    return;
  }

  const absolute = `${state.root.replace(/[\\/]$/, '')}/${media.rel}`;
  mediaPdf.src = ws.fileUrl(absolute);
}

/** Plain-text documents are always edited as source, whatever the mode is. */
function effectiveMode(): 'live' | 'source' {
  if (activeDoc()?.kind === 'text') return 'source';
  return state.mode === 'live' ? 'live' : 'source';
}

function editorOptions(): Parameters<typeof createEditor>[2] {
  return {
    renderMath,
    resolveImage,
    highlightCode,
    mode: effectiveMode(),
    onChange: onEditorChange,
    onLink: followLink,
  };
}

// ---------------------------------------------------------------- editing

let parseTimer: number | undefined;

function onEditorChange(text: string): void {
  const doc = activeDoc();
  if (doc && !doc.readonly) {
    doc.content = text;
    doc.dirty = true;
    doc.conflict = false;
    setSaveState(t().unsaved, 'editing');
    void syncUnsavedFlag();
  }
  scheduleParse();
}

function scheduleParse(): void {
  window.clearTimeout(parseTimer);
  parseTimer = window.setTimeout(refreshChrome, 120);
}

/** Tells the shell whether closing the window needs confirmation. */
async function syncUnsavedFlag(): Promise<void> {
  if (!ws.isDesktopShell) return;
  const dirty = state.open.some((doc) => doc.dirty);
  // A silent failure here means the close prompt never appears, so say something.
  await invoke('set_unsaved', { dirty }).catch((error: unknown) => {
    console.warn('无法同步未保存状态', error);
  });
}

/** Saves every dirty document; returns false if one hit a conflict. */
async function saveAll(): Promise<boolean> {
  for (const doc of state.open) {
    if (!doc.dirty || doc.conflict || !state.root) continue;
    const result = await ws.writeFile(state.root, doc.rel, doc.content, doc.hash);
    if (result.conflict) {
      state.active = doc.rel;
      await activate(doc.rel);
      showConflict(doc);
      return false;
    }
    doc.hash = result.hash;
    doc.dirty = false;
  }
  await syncUnsavedFlag();
  renderTabs();
  refreshChrome();
  return true;
}

async function saveActive(): Promise<void> {
  const doc = activeDoc();
  if (!doc || doc.readonly || !state.root || !doc.dirty || doc.conflict) return;

  setSaveState(t().saving, 'saving');
  const result = await ws.writeFile(state.root, doc.rel, doc.content, doc.hash);
  if (result.conflict) {
    doc.conflict = true;
    setSaveState(t().diskChanged, 'conflict');
    showConflict(doc);
    return;
  }
  doc.hash = result.hash;
  doc.dirty = false;
  doc.conflict = false;
  setSaveState(
    `${t().saved} ${new Date().toLocaleTimeString(settings.language === 'en' ? 'en-GB' : 'zh-CN', { hour12: false })}`,
    'saved'
  );
  renderTabs();
  await syncUnsavedFlag();
}

function setSaveState(text: string, kind: 'saved' | 'saving' | 'editing' | 'conflict' | 'idle'): void {
  saveEl.textContent = text;
  saveEl.dataset['kind'] = kind;
}

// ---------------------------------------------------------------- chrome

let appliedMacros = '';

/** The TeX engine keeps its own macro table; push the document's before rendering. */
function syncMacros(parsed: ParsedDocument): void {
  const fingerprint = JSON.stringify(parsed.macros);
  if (fingerprint === appliedMacros) return;
  math.setMacros(parsed.macros);
  appliedMacros = fingerprint;
  bumpMathGeneration();
  refreshDecorations(editor);
  if (previewView) refreshDecorations(previewView);
}

function refreshChrome(): void {
  const text = editor.state.doc.toString();
  const started = performance.now();
  const parsed = parseDocument(text);
  const elapsed = performance.now() - started;
  syncMacros(parsed);

  modeLabel.textContent = state.mode === 'split' ? t().splitView : t().livePreview;
  renderOutline(parsed);
  renderDiagnostics(parsed);
  renderTabs();
  updateEmptyState();
  if (state.mode === 'split') syncPreview();

  const active = activeDoc();
  // The bar shows only what changes at a glance; size, timing and the label
  // counts are one hover away instead of six numbers competing for attention.
  statusEl.textContent = state.media
    ? state.media.rel
    : active
      ? active.readonly
        ? active.name
        : active.rel
      : t().noFile;
  statusEl.title = [
    t().charCount(text.length),
    t().parseTime(elapsed.toFixed(1)),
    ...countParts(parsed),
  ].join(' · ');
  setSaveStateForIdle(active);
}

function setSaveStateForIdle(active: OpenDoc | undefined): void {
  if (!hasDocument()) {
    setSaveState('', 'idle');
    return;
  }
  if (!active) {
    setSaveState('', 'idle');
    return;
  }
  if (active.readonly) {
    setSaveState(t().readonly, 'idle');
    return;
  }
  if (active.conflict) return;
  if (active.dirty) return; // "编辑中…" already shown
  saveEl.textContent = t().saved;
  saveEl.dataset['kind'] = 'saved';
}

function updateEmptyState(): void {
  const unsupported = state.unsupported;
  unsupportedState.classList.toggle('hidden', unsupported === null);
  if (unsupported) {
    emptyState.classList.add('hidden');
    mediaState.classList.add('hidden');
    return;
  }

  const media = state.media;
  mediaState.classList.toggle('hidden', media === null);
  if (media) {
    emptyState.classList.add('hidden');
    void renderMedia();
    return;
  }

  const empty = !hasDocument();
  emptyState.classList.toggle('hidden', !empty);
  // With a workspace open but no document, a large ghost mark stands in for the
  // "nothing selected" state instead of wording.
  emptyState.classList.toggle('watermark', empty && Boolean(state.root));
}

/** Headings of the current document, as a click-to-jump outline. */
function renderOutline(parsed: ParsedDocument): void {
  outlineEl.replaceChildren();
  if (parsed.headings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = t().outlineEmpty;
    outlineEl.append(empty);
    return;
  }
  for (const heading of parsed.headings) {
    const button = document.createElement('button');
    button.className = 'outline-item';
    button.dataset['level'] = String(Math.min(heading.level, 4));
    button.textContent = heading.text;
    button.title = heading.text;
    button.addEventListener('click', () => {
      editor.dispatch({ selection: { anchor: heading.from }, scrollIntoView: true });
      editor.focus();
    });
    outlineEl.append(button);
  }
}

function setPanel(panel: 'files' | 'outline'): void {
  state.panel = panel;
  treeEl.classList.toggle('hidden', panel !== 'files');
  outlineEl.classList.toggle('hidden', panel !== 'outline');
  panelFiles.classList.toggle('active', panel === 'files');
  panelOutline.classList.toggle('active', panel === 'outline');
}

/** Document statistics; surfaced through the status bar's hover title. */
function countParts(parsed: ParsedDocument): string[] {
  return [
    t().headingCount(parsed.headings.length),
    t().macroCount(parsed.macros ? Object.keys(parsed.macros).length : 0),
  ];
}

function renderDiagnostics(parsed: ParsedDocument): void {
  diagsEl.replaceChildren();
  if (parsed.diagnostics.length === 0) {
    const ok = document.createElement('span');
    ok.className = 'diag-ok';
    ok.textContent = t().noDiagnostics;
    diagsEl.append(ok);
    return;
  }
  for (const item of parsed.diagnostics.slice(0, 3)) {
    const line = parsed.src.slice(0, item.from).split('\n').length;
    const element = document.createElement('span');
    element.className = `diag diag-${item.severity}`;
    // The message comes from the parser in one language; the table translates the
    // codes we know and leaves anything else as it came.
    const message = t().diagMessages[item.code] ?? item.message;
    element.textContent = `${item.code} · ${t().diagnosticRow(line, message)}`;
    element.title = item.message;
    diagsEl.append(element);
  }
  if (parsed.diagnostics.length > 3) {
    const more = document.createElement('span');
    more.className = 'diag-more';
    more.textContent = `+${parsed.diagnostics.length - 3}`;
    diagsEl.append(more);
  }
}

/** A short, quiet confirmation at the top of the window. */
let toastTimer: number | undefined;

function showToast(message: string, tone: 'quiet' | 'error' = 'quiet'): void {
  toastEl.textContent = message;
  toastEl.dataset['tone'] = tone;
  toastEl.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), tone === 'error' ? 4000 : 2200);
}

type SaveChoice = 'save' | 'discard' | 'cancel';

interface DialogAction<T> {
  readonly label: string;
  readonly value: T;
  readonly primary?: boolean;
}

/**
 * One centred dialog for every decision. It interrupts on purpose, so unlike the
 * toast it stays until answered; Esc takes the cancel value.
 */
function showDialog<T>(options: {
  readonly title: string;
  readonly body?: string;
  readonly actions: ReadonlyArray<DialogAction<T>>;
  readonly cancel: T;
}): Promise<T> {
  modalTitle.textContent = options.title;
  modalBody.textContent = options.body ?? '';
  modalActions.replaceChildren();
  modalEl.classList.remove('hidden');

  return new Promise<T>((resolve) => {
    const finish = (value: T): void => {
      modalEl.classList.add('hidden');
      modalActions.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(options.cancel);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const primary = options.actions.find((action) => action.primary) ?? options.actions[0];
        if (primary) finish(primary.value);
      }
    };

    for (const action of options.actions) {
      const button = document.createElement('button');
      button.className = action.primary ? 'btn primary' : 'btn';
      button.textContent = action.label;
      button.addEventListener('click', () => finish(action.value));
      modalActions.append(button);
    }
    (modalActions.querySelector('button.btn.primary') as HTMLButtonElement | null)?.focus();
    document.addEventListener('keydown', onKey, true);
  });
}

/** The unsaved-changes question asked when closing a tab or quitting. */
function confirmUnsaved(names: readonly string[]): Promise<SaveChoice> {
  const label = names.length === 1 ? (names[0] ?? '') : String(names.length);
  return showDialog<SaveChoice>({
    title: t().saveQuestion(label),
    body: t().loseWarning,
    actions: [
      { label: t().save, value: 'save', primary: true },
      { label: t().discard, value: 'discard' },
      { label: t().cancel, value: 'cancel' },
    ],
    cancel: 'cancel',
  });
}

/**
 * The file changed on disk while we edited it: ask before overwriting, and offer
 * the disk version as the alternative.
 */
function showConflict(doc: OpenDoc): void {
  void showDialog<'overwrite' | 'reload' | 'later'>({
    title: t().conflictTitle(doc.name),
    body: t().conflictBody,
    actions: [
      { label: t().overwrite, value: 'overwrite', primary: true },
      { label: t().reload, value: 'reload' },
      { label: t().later, value: 'later' },
    ],
    cancel: 'later',
  }).then(async (choice) => {
    if (choice === 'later' || !state.root) return;
    if (choice === 'overwrite') {
      const result = await ws.writeFile(state.root, doc.rel, doc.content, null);
      doc.hash = result.hash;
      doc.dirty = false;
      doc.conflict = false;
      setSaveState(t().saved, 'saved');
      renderTabs();
      await syncUnsavedFlag();
      return;
    }
    const snapshot = await ws.readFile(state.root, doc.rel);
    doc.content = snapshot.content;
    doc.hash = snapshot.hash;
    doc.dirty = false;
    doc.conflict = false;
    if (state.active === doc.rel) {
      replaceDocument(editor, doc.content, editorOptions());
      if (previewView) replaceDocument(previewView, doc.content, previewOptions());
    }
    setSaveState(t().saved, 'saved');
    refreshChrome();
    await syncUnsavedFlag();
  });
}
let noticeTimer: number | undefined;

/** One-off message for the user (browser without file access, etc.). */
function showNotice(text: string): void {
  noticeEl.textContent = text;
  noticeEl.classList.remove('hidden');
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => noticeEl.classList.add('hidden'), 15000);
}

noticeEl.addEventListener('click', () => noticeEl.classList.add('hidden'));

// ---------------------------------------------------------------- tabs

function renderTabs(): void {
  // The toggle lives in the tab bar, which is rebuilt on every change, so it is
  // re-appended first instead of being wiped with the rest.
  tabsEl.replaceChildren(
    sidebarToggle,
    ...state.open.map((doc) => {
      const tab = document.createElement('div');
      tab.className = 'tab';
      if (doc.rel === state.active) tab.classList.add('active');
      if (doc.dirty) tab.classList.add('dirty');

      const name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = doc.name;
      name.title = doc.rel;

      const close = document.createElement('button');
      close.className = 'tab-close';
      close.textContent = '×';
      close.title = t().closeTabLabel;
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        closeDoc(doc.rel);
      });

      tab.append(name, close);
      tab.addEventListener('click', () => void activate(doc.rel));
      return tab;
    })
  );
}

function showEmptyDocument(): void {
  state.active = null;
  state.unsupported = null;
  state.media = null;
  replaceDocument(editor, '', editorOptions());
  if (previewView) replaceDocument(previewView, '', previewOptions());
  refreshChrome();
  editor.focus();
}

function closeDoc(rel: string, options: { force?: boolean } = {}): void {
  const doc = state.open.find((entry) => entry.rel === rel);
  if (!doc) return;

  // Cmd+W on a modified document must ask, exactly like quitting does.
  if (doc.dirty && !options.force) {
    if (state.active !== rel) void activate(rel);
    void confirmUnsaved([doc.name]).then(async (choice) => {
      if (choice === 'cancel') return;
      if (choice === 'save') {
        await saveActive();
        // A conflict leaves the document dirty; its banner explains why.
        if (doc.dirty) return;
      }
      closeDoc(rel, { force: true });
    });
    return;
  }

  const index = state.open.findIndex((entry) => entry.rel === rel);
  if (index < 0) return;
  state.open.splice(index, 1);
  void syncUnsavedFlag();

  if (state.active !== rel) {
    renderTabs();
    return;
  }
  const next = state.open[Math.min(index, state.open.length - 1)];
  if (next) void activate(next.rel);
  else showEmptyDocument();
}

// ---------------------------------------------------------------- files

async function activate(rel: string): Promise<void> {
  const doc = state.open.find((item) => item.rel === rel);
  if (!doc) return;
  state.active = rel;
  state.unsupported = null;
  state.media = null;
  replaceDocument(editor, doc.content, { ...editorOptions(), readOnly: doc.readonly ?? false });
  if (previewView) replaceDocument(previewView, doc.content, previewOptions());
  refreshChrome();
  renderTree();
  editor.focus();
}

async function openFile(rel: string): Promise<void> {
  const media = mediaKind(rel);
  if (media) {
    await showMedia(rel, media);
    return;
  }
  if (documentKind(rel) === null) {
    showUnsupported(rel);
    return;
  }
  if (state.open.some((doc) => doc.rel === rel)) {
    await activate(rel);
    return;
  }
  if (!state.root) return;
  try {
    const snapshot = await ws.readFile(state.root, rel);
    state.open.push({
      rel,
      name: rel.split('/').pop() ?? rel,
      kind: documentKind(rel) ?? 'text',
      content: snapshot.content,
      hash: snapshot.hash,
      dirty: false,
      conflict: false,
    });
    await activate(rel);
  } catch (error) {
    showNotice(t().openFileFailed((error as Error).message));
  }
}

/** Folders default to collapsed, and remember what the user opened. */
const expandedDirs = new Set<string>();

interface TreeNode {
  readonly name: string;
  readonly path: string;
  readonly isDir: boolean;
  readonly children: TreeNode[];
}

function buildTree(entries: readonly ws.Entry[]): TreeNode[] {
  const byPath = new Map<string, TreeNode>();
  for (const entry of entries) {
    byPath.set(entry.path, { name: entry.name, path: entry.path, isDir: entry.isDir, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const entry of entries) {
    const node = byPath.get(entry.path);
    if (!node) continue;
    const slash = entry.path.lastIndexOf('/');
    if (slash < 0) {
      roots.push(node);
      continue;
    }
    const parent = byPath.get(entry.path.slice(0, slash));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function renderTree(): void {
  // Re-rendering must not move the tree: clicking a file used to rebuild it and
  // jump back to the top, which made long folders unusable.
  const scrollTop = treeEl.scrollTop;
  const nodes = buildTree(state.entries);
  treeEl.replaceChildren(...nodes.map((node) => renderNode(node, 0)));
  // Without a workspace the sidebar header already says so; only report an
  // empty folder.
  if (nodes.length === 0 && state.root) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = t().treeEmpty;
    treeEl.append(empty);
  }
  treeEl.scrollTop = scrollTop;
}

function renderNode(node: TreeNode, depth: number): HTMLElement {
  if (node.isDir) {
    const details = document.createElement('details');
    details.className = 'tree-dir';
    details.open = expandedDirs.has(node.path);
    details.addEventListener('toggle', () => {
      if (details.open) expandedDirs.add(node.path);
      else expandedDirs.delete(node.path);
    });
    const summary = document.createElement('summary');
    summary.textContent = node.name;
    summary.dataset['path'] = node.path;
    if (state.selectedDir === node.path) summary.classList.add('selected');
    summary.style.paddingLeft = `${depth * 10 + 6}px`;
    // Clicking a folder both toggles it (the summary's own behaviour) and makes
    // it the paste target; the highlight is what tells the two apart.
    summary.addEventListener('click', () => selectDir(node.path));
    summary.addEventListener('contextmenu', (event) =>
      openContextMenu(event, { rel: node.path, name: node.name, isDir: true })
    );
    details.append(summary);
    for (const child of node.children) details.append(renderNode(child, depth + 1));
    return details;
  }

  const button = document.createElement('button');
  button.className = 'tree-file';
  if (documentKind(node.path) === null) button.classList.add('muted');
  if (documentKind(node.path) === 'markdown') button.dataset['markdown'] = 'true';
  button.textContent = node.name;
  button.title =
    documentKind(node.path) === null && mediaKind(node.path) === null
      ? t().cannotPreview(node.path)
      : node.path;
  button.style.paddingLeft = `${depth * 10 + 18}px`;
  button.addEventListener('contextmenu', (event) =>
    openContextMenu(event, { rel: node.path, name: node.name, isDir: false })
  );
  if (node.path === state.active) button.classList.add('active');
  button.addEventListener('click', () => {
    selectDir(parentOf(node.path));
    void openFile(node.path);
  });
  return button;
}

/** Highlights a folder ('' is the workspace root) as the paste target. */
function selectDir(path: string): void {
  state.selectedDir = path;
  for (const summary of treeEl.querySelectorAll<HTMLElement>('.tree-dir > summary')) {
    summary.classList.toggle('selected', summary.dataset['path'] === path);
  }
}

/** Where a paste lands: the highlighted folder, else the open file's folder. */
function currentFolder(): string {
  const wanted = state.selectedDir ?? (state.active ? parentOf(state.active) : '');
  if (wanted === '') return '';
  const known = state.entries.some((entry) => entry.isDir && entry.path === wanted);
  return known ? wanted : '';
}

/**
 * Makes `root` the workspace, optionally opening `file` inside it.
 *
 * Shared by the folder picker, a path dropped on the window and a file opened
 * from Finder, so all three land in exactly the same state.
 */
async function useWorkspace(root: string, file?: string): Promise<boolean> {
  // Switching folders drops every open tab, so unsaved work has to be settled
  // first — a stray drop must not be able to throw edits away.
  const dirty = state.open.filter((doc) => doc.dirty);
  if (dirty.length > 0) {
    const choice = await confirmUnsaved(dirty.map((doc) => doc.name));
    if (choice === 'cancel') return false;
    if (choice === 'save' && !(await saveAll())) return false;
  }
  state.root = root;
  state.entries = await ws.listFiles(root);
  state.open = [];
  state.active = null;
  state.selectedDir = '';
  state.unsupported = null;
  state.media = null;
  expandedDirs.clear();
  workspaceName.textContent = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  replaceDocument(editor, '', editorOptions());
  if (previewView) replaceDocument(previewView, '', previewOptions());
  renderTree();
  refreshChrome();
  const wanted = file ? state.entries.find((entry) => !entry.isDir && entry.name === file) : undefined;
  if (wanted) {
    try {
      await openFile(wanted.path);
    } catch (error) {
      showNotice(t().openFileFailed((error as Error).message));
    }
  }
  editor.focus();
  return true;
}

async function chooseFolder(): Promise<void> {
  if (!ws.isDesktopShell && !ws.isDemoWorkspace()) {
    showNotice(
      t().noFileAccess
    );
    return;
  }
  try {
    const root = await ws.pickFolder();
    if (!root) return;
    await useWorkspace(root);
  } catch (error) {
    showNotice(t().openFolderFailed((error as Error).message));
  }
}

/**
 * Handles paths handed to us by the system: a folder dropped on the window, or a
 * file opened through Finder's "Open With". A folder becomes the workspace; a
 * file makes its own folder the workspace and opens it.
 */
/** Paths handled in the last couple of seconds, to survive the startup race. */
const recentOpens = new Map<string, number>();

async function handleSystemPaths(paths: readonly string[]): Promise<void> {
  const path = paths[0];
  if (!path) return;
  // A path opened while the window was starting up is both emitted and queued,
  // so the same file can arrive twice within milliseconds. Once is enough.
  const now = Date.now();
  const seen = recentOpens.get(path);
  recentOpens.set(path, now);
  for (const [key, at] of recentOpens) if (now - at > 5000) recentOpens.delete(key);
  if (seen !== undefined && now - seen < 2000) return;
  try {
    const target = await ws.resolveOpenTarget(path);
    if (!(await useWorkspace(target.root, target.file ?? undefined))) return;
    const name = target.root.split(/[\\/]/).filter(Boolean).pop() ?? target.root;
    showNotice(t().switchedTo(name));
  } catch (error) {
    showNotice(t().openPathFailed((error as Error).message));
  }
}

// ---------------------------------------------------------------- modes

function previewOptions(): Parameters<typeof createEditor>[2] {
  const text = activeDoc()?.kind === 'text';
  return {
    renderMath,
    resolveImage,
    highlightCode,
    mode: text ? 'source' : 'live',
    readOnly: true,
    revealSelection: false,
    onLink: followLink,
  };
}

function setMode(mode: Mode): void {
  state.mode = mode;
  setEditorMode(editor, mode === 'live' ? 'live' : 'source', {
    renderMath,
    resolveImage,
    highlightCode,
    revealSelection: true,
    onLink: followLink,
  });
  previewPane.classList.toggle('hidden', mode !== 'split');
  modeLabel.textContent = mode === 'split' ? t().splitView : t().livePreview;
  if (mode === 'split') {
    ensurePreviewView();
    syncPreview();
    // Align the preview with wherever the editor already is.
    syncScroll('editor');
  }
  refreshChrome();
}

// ---------------------------------------------------------------- links

/**
 * Follows a link clicked in the rendered document.
 *
 * `[text](https://…)` opens the browser, `[text](note.md)` opens a workspace
 * file (relative to the file that holds the link), and `[text](anchor)` jumps to
 * `<id:anchor>` in the same document. A target that resolves to none of those
 * does nothing — a dead link should not turn into an error dialog.
 */
function followLink(target: string): void {
  const doc = activeDoc();
  if (!doc) return;
  const resolved = resolveLink(target, {
    docText: editor.state.doc.toString(),
    fromRel: doc.rel,
    files: state.entries.filter((entry) => !entry.isDir).map((entry) => entry.path),
    root: state.root ?? '',
  });
  switch (resolved.kind) {
    case 'anchor':
      jumpToAnchor(resolved.id);
      return;
    case 'url':
      void ws.openExternal(resolved.href).catch(() => undefined);
      return;
    case 'file':
      if (resolved.rel !== doc.rel) void openFile(resolved.rel).catch(() => undefined);
      return;
    default:
      return;
  }
}

/** Scrolls the editor to `<id:…>`; the caret lands after the marker so it stays hidden. */
function jumpToAnchor(id: string): void {
  const marker = `<id:${id}>`;
  const at = editor.state.doc.toString().indexOf(marker);
  if (at < 0) return;
  jumpToPosition(editor, at + marker.length, { focus: true });
}

// ---------------------------------------------------------------- PDF export

async function exportPdf(): Promise<void> {
  const doc = activeDoc();
  if (!doc || !state.root) {
    showToast(t().noDocToExport);
    return;
  }
  if (doc.kind === 'text') {
    showToast(t().textNoPdf);
    return;
  }

  setSaveState(t().exportPreparing, 'saving');
  const parsed = parseDocument(doc.content);

  // Images must be inlined: the exported HTML is a single file with no paths.
  const images = new Map<string, string>();
  for (const target of imageTargets(parsed)) {
    const resolved = await resolveImage(target).catch(() => null);
    if (resolved) images.set(target, resolved);
  }

  const body = renderHTML(parsed, {
    renderMath,
    highlight: highlightCode,
    resolveImage: (target) => images.get(target) ?? null,
  });

  const target = await save({
    title: t().exportDialogTitle,
    defaultPath: `${doc.name.replace(/\.(md|markdown|mdown)$/i, '')}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!target) {
    setSaveState(t().exportCancelled, 'saved');
    return;
  }

  try {
    await invoke<string>('export_pdf', {
      html: printDocument(doc.name, body),
      path: target,
    });
    setSaveState(t().saved, 'saved');
    showToast(t().exportDone);
  } catch (error) {
    setSaveState(t().diskChanged, 'conflict');
    showToast(t().exportFailed(String(error)), 'error');
  }
}

// ---------------------------------------------------------------- new files

let newKind: 'file' | 'dir' = 'file';

function syncNewDialog(): void {
  newTitle.textContent = t().newEntryTitle;
  newKindLabel.textContent = t().newEntryKind;
  newNameLabel.textContent = t().newEntryName;
  newFileButton.textContent = t().newEntryFile;
  newDirButton.textContent = t().newEntryDir;
  newCreate.textContent = t().create;
  newCancel.textContent = t().cancel;
  newFileButton.classList.toggle('active', newKind === 'file');
  newDirButton.classList.toggle('active', newKind === 'dir');
  newName.placeholder =
    newKind === 'file' ? `${t().untitledFileName}.md` : t().newFolderName;
}

function openNewEntry(): void {
  if (!state.root) {
    showToast(t().noWorkspaceForNew);
    return;
  }
  newKind = 'file';
  newName.value = '';
  syncNewDialog();
  newPanel.classList.remove('hidden');
  newName.focus();
}

function closeNewEntry(): void {
  newPanel.classList.add('hidden');
  editor.focus();
}

/** Files default to `.md` when the user does not type an extension. */
function normaliseName(raw: string): string {
  const name = raw.trim().replace(/[\\/]/g, '-');
  if (newKind === 'dir') return name;
  return /\.[A-Za-z0-9]+$/.test(name) ? name : `${name}.md`;
}

async function createEntry(): Promise<void> {
  if (!state.root) return;
  const name = normaliseName(newName.value || (newKind === 'file' ? t().untitled : t().newEntryDir));
  // New entries land next to the file being edited. `dirname` returns '' at the
  // workspace root; a bare `replace(/\/[^/]*$/, '')` left a root-level file name
  // in place, so the new path became `notes.txt/未命名.md` and the write failed
  // with EEXIST because `notes.txt` is a file, not a folder.
  const active = activeDoc();
  const base = active && !active.readonly ? dirname(active.rel) : '';
  const rel = base ? `${base}/${name}` : name;

  try {
    await ws.createEntry(state.root, rel, newKind);
  } catch (error) {
    showToast(t().createFailed(String(error)), 'error');
    return;
  }
  closeNewEntry();
  state.entries = await ws.listFiles(state.root);
  renderTree();
  refreshChrome();
  if (newKind === 'file') await openFile(rel);
}

newEntryButton.addEventListener('click', openNewEntry);
newFileButton.addEventListener('click', () => {
  newKind = 'file';
  syncNewDialog();
  newName.focus();
});
newDirButton.addEventListener('click', () => {
  newKind = 'dir';
  syncNewDialog();
  newName.focus();
});
newCreate.addEventListener('click', () => void createEntry());
newCancel.addEventListener('click', closeNewEntry);
newName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void createEntry();
  }
  if (event.key === 'Escape') closeNewEntry();
});

// ---------------------------------------------------------------- tree context menu

/** The entry the context menu was opened on. */
let menuTarget: { rel: string; name: string; isDir: boolean } | null = null;

function hideContextMenu(): void {
  contextMenu.classList.add('hidden');
  contextMenu.replaceChildren();
}

function parentOf(rel: string): string {
  const slash = rel.lastIndexOf('/');
  return slash < 0 ? '' : rel.slice(0, slash);
}

/** "note.md" → "note 副本.md", counting up when that name is taken. */
function copyNameOf(name: string, isDir: boolean): string {
  const dot = isDir ? -1 : name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  return t().copyName(base, extension);
}

async function refreshAfterFileOp(): Promise<void> {
  if (!state.root) return;
  state.entries = await ws.listFiles(state.root);
  renderTree();
  refreshChrome();
  await syncUnsavedFlag();
}

function openRename(target: { rel: string; name: string }): void {
  menuTarget = { ...menuTarget, rel: target.rel, name: target.name } as typeof menuTarget;
  renameTitle.textContent = t().rename;
  renameConfirm.textContent = t().confirm;
  renameCancel.textContent = t().cancel;
  renameInput.value = target.name;
  renamePanel.classList.remove('hidden');
  renameInput.focus();
  renameInput.select();
}

function closeRename(): void {
  renamePanel.classList.add('hidden');
  editor.focus();
}

async function confirmRename(): Promise<void> {
  const target = menuTarget;
  if (!target || !state.root) return;
  const name = renameInput.value.trim().replace(/[\\/]/g, '-');
  if (!name || name === target.name) {
    closeRename();
    return;
  }
  const parent = parentOf(target.rel);
  const to = parent ? `${parent}/${name}` : name;
  try {
    await ws.renameEntry(state.root, target.rel, to);
  } catch (error) {
    showToast(t().fileOpFailed(String(error)), 'error');
    return;
  }
  closeRename();
  const index = state.open.findIndex((doc) => doc.rel === target.rel);
  const open = state.open[index];
  if (open) state.open[index] = { ...open, rel: to };
  if (state.active === target.rel) state.active = to;
  await refreshAfterFileOp();
  renderTabs();
}

async function deleteTarget(): Promise<void> {
  const target = menuTarget;
  if (!target || !state.root) return;
  const choice = await showDialog<'delete' | 'cancel'>({
    title: t().deleteConfirm(target.name),
    body: t().deleteWarning,
    actions: [
      { label: t().deleteAction, value: 'delete', primary: true },
      { label: t().cancel, value: 'cancel' },
    ],
    cancel: 'cancel',
  });
  if (choice !== 'delete' || !state.root) return;
  try {
    await ws.deleteEntry(state.root, target.rel);
  } catch (error) {
    showToast(t().fileOpFailed(String(error)), 'error');
    return;
  }
  state.open = state.open.filter((doc) => doc.rel !== target.rel);
  if (state.active === target.rel) {
    state.active = null;
    const next = state.open[0];
    if (next) await activate(next.rel);
    else showEmptyDocument();
  }
  await refreshAfterFileOp();
  renderTabs();
}

async function duplicateTarget(): Promise<void> {
  const target = menuTarget;
  if (!target || !state.root) return;
  const parent = parentOf(target.rel);
  const name = copyNameOf(target.name, target.isDir);
  const to = parent ? `${parent}/${name}` : name;
  try {
    await ws.copyEntry(state.root, target.rel, to);
  } catch (error) {
    showToast(t().fileOpFailed(String(error)), 'error');
    return;
  }
  await refreshAfterFileOp();
  showToast(t().duplicated);
}

/** Puts the real file on the system clipboard, so Finder and VS Code can paste it. */
async function copyTargetToSystem(): Promise<void> {
  const target = menuTarget;
  if (!target || !state.root) return;
  const absolute = `${state.root.replace(/[\\/]$/, '')}/${target.rel}`;
  try {
    await ws.copyToClipboard([absolute]);
  } catch (error) {
    showToast(t().fileOpFailed(String(error)), 'error');
    return;
  }
  showToast(t().copied);
}

async function copyTargetPath(): Promise<void> {
  const target = menuTarget;
  if (!target || !state.root) return;
  const full = `${state.root.replace(/\/$/, '')}/${target.rel}`;
  try {
    await navigator.clipboard.writeText(full);
    showToast(t().pathCopied);
  } catch {
    showToast(full);
  }
}

/**
 * Copies files picked up in Finder (or any other app that copies files) into the
 * highlighted folder. The clipboard is only read after the user pastes, so the
 * app never touches the pasteboard on its own.
 */
async function pasteFromSystem(): Promise<void> {
  if (!state.root) {
    showToast(t().noWorkspaceForNew);
    return;
  }
  let paths: string[];
  try {
    paths = await ws.clipboardFiles();
  } catch (error) {
    showToast(t().fileOpFailed(String(error)), 'error');
    return;
  }
  if (paths.length === 0) {
    showToast(t().nothingToPaste);
    return;
  }
  const dir = currentFolder();
  const names = paths.map((path) => path.split(/[\\/]/).filter(Boolean).pop() ?? path);
  const where = dir || (state.root.split(/[\\/]/).filter(Boolean).pop() ?? state.root);
  const choice = await showDialog<'paste' | 'cancel'>({
    title: t().pasteTitle,
    body: t().pasteBody(names, where),
    actions: [
      { label: t().pasteConfirm, value: 'paste', primary: true },
      { label: t().cancel, value: 'cancel' },
    ],
    cancel: 'cancel',
  });
  if (choice !== 'paste' || !state.root) return;
  let created: string[];
  try {
    created = await ws.pastePaths(state.root, dir, paths, t().copySuffix);
  } catch (error) {
    showToast(t().fileOpFailed(String(error)), 'error');
    return;
  }
  // Show the result even when it landed in a collapsed folder.
  if (dir) expandedDirs.add(dir);
  await refreshAfterFileOp();
  showToast(t().pasted(created.length));
}

function openContextMenu(event: MouseEvent, entry: { rel: string; name: string; isDir: boolean }): void {
  event.preventDefault();
  menuTarget = entry;
  const items: ReadonlyArray<readonly [string, string, (() => void | Promise<void>) | null, boolean]> = [
    [t().rename, 'rename', () => openRename(entry), false],
    [t().duplicate, 'duplicate', duplicateTarget, false],
    [t().copy, 'copy', copyTargetToSystem, false],
    [t().copyPath, 'copy-path', copyTargetPath, false],
    ['sep', '', null, false],
    [t().deleteAction, 'delete', deleteTarget, true],
  ];
  contextMenu.replaceChildren();
  for (const [label, id, run, danger] of items) {
    if (label === 'sep') {
      contextMenu.append(document.createElement('hr'));
      continue;
    }
    const button = document.createElement('button');
    button.dataset['action'] = id;
    button.textContent = label;
    if (danger) button.classList.add('danger');
    button.addEventListener('click', () => {
      hideContextMenu();
      void run?.();
    });
    contextMenu.append(button);
  }
  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;
  contextMenu.classList.remove('hidden');
}

document.addEventListener('click', (event) => {
  if (!contextMenu.classList.contains('hidden') && !contextMenu.contains(event.target as Node)) {
    hideContextMenu();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideContextMenu();
    if (!renamePanel.classList.contains('hidden')) closeRename();
  }
});

renameConfirm.addEventListener('click', () => void confirmRename());
renameCancel.addEventListener('click', closeRename);
renameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void confirmRename();
  }
});

// ---------------------------------------------------------------- table insert

const tableSize = { rows: 3, columns: 3 };

function syncTableDialog(): void {
  tableRowsEl.textContent = String(tableSize.rows);
  tableColsEl.textContent = String(tableSize.columns);
  tableTitle.textContent = t().tableTitle;
  tableRowsLabel.textContent = t().tableRows;
  tableColsLabel.textContent = t().tableColumns;
  tableInsert.textContent = t().insert;
  tableCancel.textContent = t().cancel;
}

// ---------------------------------------------------------------- code blocks

/**
 * The language list is built from the highlighter's registered grammars, so the
 * picker can never offer a tag that renders without colours.
 */
function syncCodeDialog(): void {
  codeTitle.textContent = t().codeTitle;
  codeLangLabel.textContent = t().codeLanguage;
  codeInsert.textContent = t().insert;
  codeCancel.textContent = t().cancel;
  const previous = codeLangSelect.value;
  codeLangSelect.replaceChildren(
    new Option(t().codePlain, ''),
    ...CODE_LANGUAGES.map((language) => new Option(language.label, language.tag))
  );
  codeLangSelect.value = CODE_LANGUAGES.some((language) => language.tag === previous)
    ? previous
    : '';
}

function openCodeDialog(): void {
  syncCodeDialog();
  codePanel.classList.remove('hidden');
  codeLangSelect.focus();
}

function closeCodeDialog(): void {
  codePanel.classList.add('hidden');
  editor.focus();
}

codeInsert.addEventListener('click', () => {
  const language = codeLangSelect.value;
  closeCodeDialog();
  apply(wrapInFence(editor.state, language));
});
codeCancel.addEventListener('click', closeCodeDialog);
codeLangSelect.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    codeInsert.click();
  }
  if (event.key === 'Escape') closeCodeDialog();
});

function openTableDialog(): void {
  syncTableDialog();
  tablePanel.classList.remove('hidden');
  tableInsert.focus();
}

function closeTableDialog(): void {
  tablePanel.classList.add('hidden');
  editor.focus();
}

tableRowsUp.addEventListener('click', () => {
  tableSize.rows = Math.min(30, tableSize.rows + 1);
  syncTableDialog();
});
tableRowsDown.addEventListener('click', () => {
  tableSize.rows = Math.max(1, tableSize.rows - 1);
  syncTableDialog();
});
tableColsUp.addEventListener('click', () => {
  tableSize.columns = Math.min(12, tableSize.columns + 1);
  syncTableDialog();
});
tableColsDown.addEventListener('click', () => {
  tableSize.columns = Math.max(1, tableSize.columns - 1);
  syncTableDialog();
});
tableInsert.addEventListener('click', () => {
  closeTableDialog();
  insertAtCursor(buildTable(tableSize.rows, tableSize.columns));
});
tableCancel.addEventListener('click', closeTableDialog);

// ---------------------------------------------------------------- editing commands

function apply(spec: Parameters<typeof editor.dispatch>[0]): void {
  editor.dispatch(spec);
  editor.focus();
}

const insertAtCursor = (text: string) => apply(insertTextSpec(editor.state, text));
const wrap = (before: string, after: string = before) => apply(wrapSelection(editor.state, before, after));
const prefix = (value: string) => apply(toggleLinePrefix(editor.state, value));

const MENU_ACTIONS: Readonly<Record<string, () => void>> = {
  'view:live': () => setMode('live'),
  'view:split': () => setMode('split'),
  'view:theme': () => applyTheme(settings.theme === 'dark' ? 'light' : 'dark'),
  'theme:light': () => applyTheme('light'),
  'theme:sepia': () => applyTheme('sepia'),
  'theme:slate': () => applyTheme('slate'),
  'theme:dark': () => applyTheme('dark'),
  'app:settings': openSettings,
  'file:new-entry': openNewEntry,
  'window:new': () => {
    void invoke('new_window').catch(() => showToast(t().newWindowNeedsApp));
  },
  'file:open-folder': () => void chooseFolder(),
  'file:guide': showGuide,
  'file:save': () => void saveActive(),
  'file:export-pdf': () => void exportPdf(),
  'file:close-tab': () => {
    if (state.active) closeDoc(state.active);
  },
  'para:h1': () => prefix('# '),
  'para:h2': () => prefix('## '),
  'para:h3': () => prefix('### '),
  'para:h4': () => prefix('#### '),
  'para:h5': () => prefix('##### '),
  'para:h6': () => prefix('###### '),
  'para:ul': () => prefix('- '),
  'para:ol': () => prefix('1. '),
  'para:task': () => prefix('- [ ] '),
  'para:quote': () => prefix('> '),
  'para:code': openCodeDialog,
  'para:table': openTableDialog,
  'para:hr': () => insertAtCursor('\n\n---\n\n'),
  'format:bold': () => wrap('**'),
  'format:italic': () => wrap('*'),
  'format:underline': () => wrap('++'),
  'format:strike': () => wrap('~~'),
  'format:code': () => wrap('`'),
  'format:bigger': () => stepEditorSize(1),
  'format:smaller': () => stepEditorSize(-1),
};

async function wireShell(): Promise<void> {
  if (!ws.isDesktopShell) return;

  await listen<string>('menu', (event) => {
    MENU_ACTIONS[event.payload]?.();
  });

  await listen('request-close', () => {
    const dirty = state.open.filter((doc) => doc.dirty);
    void confirmUnsaved(dirty.map((doc) => doc.name)).then(async (choice) => {
      if (choice === 'cancel') return;
      if (choice === 'save') {
        const saved = await saveAll();
        if (!saved) return;
      }
      await invoke('quit_app').catch(() => undefined);
    });
  });

  await syncUnsavedFlag();

  // Files opened through Finder's "Open With" (an Apple Event on macOS).
  await listen<string[]>('open-path', (event) => {
    void handleSystemPaths(event.payload ?? []);
  });
  // Anything that arrived before this listener existed (a cold launch).
  const pending = await ws.takePendingOpen().catch(() => [] as string[]);
  if (pending.length > 0) void handleSystemPaths(pending);

  // Dropping a folder or a Markdown file onto the window. Tauri reports native
  // paths here (the webview never sees HTML5 drops), which is what lets a drop
  // work outside the workspace.
  const webview = getCurrentWebview();
  await webview.onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type === 'enter' || payload.type === 'over') {
      dropHintEl.classList.remove('hidden');
      return;
    }
    dropHintEl.classList.add('hidden');
    if (payload.type === 'drop') void handleSystemPaths(payload.paths ?? []);
  });

  // Finder's Copy puts file URLs on the pasteboard; pasting them is a workspace
  // import, not a text paste. A normal text paste never carries the "Files"
  // type, so it keeps the native behaviour untouched.
  document.addEventListener(
    'paste',
    (event) => {
      const data = event.clipboardData;
      if (!data || !Array.from(data.types).includes('Files')) return;
      if (terminal?.isOpen() && terminalPanel.contains(document.activeElement)) return;
      event.preventDefault();
      if (document.querySelector('.modal-backdrop:not(.hidden)')) return;
      void pasteFromSystem();
    },
    { capture: true }
  );
}

// ---------------------------------------------------------------- wiring

const GUIDE_DOC: OpenDoc = {
  // The tab's label is fixed to the interface language it was opened in; `rel`
  // is the key, so re-opening reuses the same tab.
  rel: GUIDE_REL,
  name: t().guideTitle,
  kind: 'markdown',
  content: GUIDE,
  hash: null,
  dirty: false,
  conflict: false,
  readonly: true,
};

/** Opens the built-in guide; read-only, never written to disk. */
function showGuide(): void {
  const existing = state.open.find((doc) => doc.rel === GUIDE_REL);
  if (!existing) state.open.push({ ...GUIDE_DOC });
  state.unsupported = null;
  state.media = null;
  void activate(GUIDE_DOC.rel);
}

openFolderButton.addEventListener('click', () => void chooseFolder());

// ---------------------------------------------------------------- terminal

/** Hides the pane but keeps the shell's process alive. */
function collapseTerminal(): void {
  terminal?.collapse();
  terminalResizer.classList.add('hidden');
  editor.focus();
}

/** Kills the shell, clears the buffer and hides the pane. */
async function closeTerminal(): Promise<void> {
  await terminal?.close();
  terminalResizer.classList.add('hidden');
  editor.focus();
}

async function toggleTerminal(): Promise<void> {
  if (!terminal) return;
  if (terminal.isOpen()) {
    collapseTerminal();
    return;
  }
  if (!state.root) {
    showToast(t().noWorkspaceForNew);
    return;
  }
  // "Current directory": the highlighted folder, else the workspace root.
  const dir = currentFolder();
  const cwd = dir ? `${state.root}/${dir}` : state.root;
  try {
    await terminal.open(cwd);
    terminalResizer.classList.remove('hidden');
  } catch (error) {
    terminal.collapse();
    terminalResizer.classList.add('hidden');
    showToast(t().terminalFailed(String(error)), 'error');
  }
}

terminalToggle.addEventListener('click', () => void toggleTerminal());
terminalCollapse.addEventListener('click', collapseTerminal);
terminalKill.addEventListener('click', () => void closeTerminal());
// A browser tab has no shell to talk to, so the button is not offered there.
if (!ws.isDesktopShell) terminalToggle.classList.add('hidden');

let terminalDrag: { y: number; height: number } | null = null;
terminalResizer.addEventListener('pointerdown', (event) => {
  if (terminalPanel.classList.contains('hidden')) return;
  event.preventDefault();
  terminalResizer.setPointerCapture(event.pointerId);
  terminalDrag = { y: event.clientY, height: terminalPanel.getBoundingClientRect().height };
});
terminalResizer.addEventListener('pointermove', (event) => {
  if (!terminalDrag) return;
  const height = Math.min(
    Math.max(120, terminalDrag.height + (terminalDrag.y - event.clientY)),
    window.innerHeight * 0.7
  );
  terminalPanel.style.height = `${height}px`;
});
const endTerminalDrag = (): void => {
  if (!terminalDrag) return;
  terminalDrag = null;
  terminal?.refresh();
};
terminalResizer.addEventListener('pointerup', endTerminalDrag);
terminalResizer.addEventListener('pointercancel', endTerminalDrag);
emptyOpen.addEventListener('click', () => void chooseFolder());
panelFiles.addEventListener('click', () => setPanel('files'));
panelOutline.addEventListener('click', () => setPanel('outline'));

/**
 * Claims a shortcut for the app.
 *
 * Capture phase plus stopPropagation is deliberate: CodeMirror binds ⌘/ to
 * "toggle comment" on the editor element itself, so in the bubble phase the
 * comment marker appeared *and* the shortcut fired — every press inserted a
 * `<!-- -->` into the file.
 */
const claim = (event: KeyboardEvent): void => {
  event.preventDefault();
  event.stopPropagation();
};

document.addEventListener(
  'keydown',
  (event) => {
    // Cmd+1 / Cmd+2 mirror the 视图 menu, so the modes stay reachable in the
    // browser preview where there is no native menu.
    if ((event.metaKey || event.ctrlKey) && (event.key === '1' || event.key === '2')) {
      claim(event);
      setMode(event.key === '1' ? 'live' : 'split');
      return;
    }
    if ((event.metaKey || event.ctrlKey) && (event.key === '+' || event.key === '=')) {
      claim(event);
      stepEditorSize(1);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === '-') {
      claim(event);
      stepEditorSize(-1);
      return;
    }
    // Mirrors 格式 → 代码块, which lives in the native menu and is therefore
    // unreachable in the browser preview.
    if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === 'c') {
      claim(event);
      openCodeDialog();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === ',') {
      claim(event);
      openSettings();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      claim(event);
      void saveActive();
    }
  },
  { capture: true }
);

window.addEventListener('beforeunload', (event) => {
  if (state.open.some((doc) => doc.dirty)) {
    event.preventDefault();
    event.returnValue = '';
  }
});

if (!ws.isDesktopShell) {
  const tagline = document.querySelector('.app-tagline');
  if (tagline) tagline.textContent = t().browserTagline;
}

void wireShell();
renderTree();
refreshChrome();
editor.focus();

// Dev aid: `pnpm dev` runs the app in a browser with a mock workspace.
// `#demo` loads it, `#split` starts in comparison mode. The desktop shell never
// sets these hashes.
const hash = window.location.hash;
if (hash.includes('dark')) applyTheme('dark');
if (hash.includes('split')) setMode('split');
if (hash.includes('demo') && !ws.isDesktopShell) {
  ws.enableDemoWorkspace();
  void chooseFolder().then(() => {
    const first = state.entries.find((entry) => !entry.isDir);
    if (first) void openFile(first.path);
  });
}

// The shell is hidden until here (see index.html): everything above ran
// synchronously, so the first visible frame is already themed and laid out.
requestAnimationFrame(() => document.body.classList.add('ready'));
