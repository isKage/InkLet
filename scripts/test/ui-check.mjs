#!/usr/bin/env node
/**
 * Interactive UI check driven through the Chrome DevTools Protocol.
 *
 * Plain `--screenshot` can only capture the initial paint. This script really
 * clicks things (tree entries, rendered formulas) and captures the result, which
 * is the only way to verify interactions such as "click a formula to reveal its
 * source" without a human at the keyboard.
 *
 * Usage: node scripts/test/ui-check.mjs <baseUrl> <outDir>
 * Requires Google Chrome; writes PNGs into <outDir>.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// A fixed port collides with a zombie browser from an earlier run; the profile
// is unique per run anyway.
const PORT = 9400 + (process.pid % 400);
const PROFILE = `/tmp/inklet-ui-check-profile-${process.pid}`;
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8796';
const outDir = process.argv[3] ?? '.cache/ui';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--disable-crash-reporter',
    '--disable-breakpad',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--window-size=1400,900',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

async function firstPage() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('Chrome DevTools endpoint did not appear');
}

const page = await firstPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
  // A dirty document asks before unload; the harness has nothing to save.
  if (message.method === 'Page.javascriptDialogOpening') {
    socket.send(
      JSON.stringify({ id: ++nextId, method: 'Page.handleJavaScriptDialog', params: { accept: true } })
    );
  }
});
await new Promise((resolve) => socket.addEventListener('open', resolve));

// Chrome occasionally advertises its target before the browser process answers
// commands; a couple of retries keeps a whole run from dying at the handshake.
for (let attempt = 0; attempt < 6; attempt += 1) {
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('handshake timeout')), 5000);
      const probe = (message) => {
        if (message.id === 0) {
          clearTimeout(timer);
          resolve();
        }
      };
      socket.addEventListener('message', probe, { once: true });
      socket.send(JSON.stringify({ id: 0, method: 'Browser.getVersion' }));
    });
    break;
  } catch {
    await sleep(1000);
  }
}

// Every call gets a deadline: a hung renderer used to stall the whole run with
// no indication of which command was waiting.
const CALL_TIMEOUT_MS = 20000;

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout after ${CALL_TIMEOUT_MS}ms: ${method} ${JSON.stringify(params).slice(0, 120)}`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.text ?? 'evaluation failed');
  }
  return result.result?.result?.value;
};

const shoot = async (name) => {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
  console.log(`  → ${join(outDir, `${name}.png`)}`);
};

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `${baseUrl}/#demo` });
  await sleep(5000);

  // --- the tree lists non-Markdown files too
  const treeNames = await evaluate(
    `[...document.querySelectorAll('.tree-file')].map((el) => el.textContent)`
  );
  // The brand mark is one SVG symbol shared with the app icon, not styled text.
  const mark = await evaluate(`(() => {
    const el = document.querySelector('.mark');
    return {
      tag: el?.tagName.toLowerCase() ?? '',
      uses: document.querySelectorAll('use[href="#inklet-mark"]').length,
      symbols: document.querySelectorAll('symbol#inklet-mark').length,
      box: el ? Math.round(el.getBoundingClientRect().width) : 0,
    };
  })()`);
  check(
    'the brand mark is the shared symbol',
    mark.tag === 'svg' && mark.uses === 2 && mark.symbols === 1 && mark.box > 16,
    JSON.stringify(mark)
  );

  check('tree lists markdown', treeNames.includes('elliptic.md'), JSON.stringify(treeNames));
  check('tree lists non-markdown', treeNames.includes('figure.png'));

  // --- sidebar switches between the file tree and the document outline
  await evaluate(`document.querySelector('#panelOutline')?.click()`);
  await sleep(400);
  const outline = await evaluate(`({
    items: [...document.querySelectorAll('.outline-item')].map((el) => el.textContent),
    treeHidden: document.querySelector('#tree').classList.contains('hidden'),
  })`);
  check(
    'outline lists the document headings',
    outline.items.length >= 3 && outline.treeHidden,
    JSON.stringify(outline.items.slice(0, 4))
  );
  const scrolledBefore = await evaluate(`document.querySelector('.cm-scroller')?.scrollTop ?? 0`);
  await evaluate(`[...document.querySelectorAll('.outline-item')].pop()?.click()`);
  await sleep(600);
  const scrolledAfter = await evaluate(`document.querySelector('.cm-scroller')?.scrollTop ?? 0`);
  check(
    'clicking an outline entry jumps in the document',
    scrolledAfter > scrolledBefore,
    `${scrolledBefore} → ${scrolledAfter}`
  );
  await evaluate(`document.querySelector('#panelFiles')?.click()`);
  await sleep(300);
  await evaluate(`document.querySelector('.cm-scroller').scrollTop = 0`);
  await sleep(200);

  // --- the view mode lives in the menu now; the status bar reports it
  check(
    'status bar reports the current view',
    (await evaluate(`document.querySelector('#modeLabel')?.textContent ?? ''`)) === '实时渲染'
  );
  check(
    'document statistics live in a hover title',
    /标题 · .* 宏/.test((await evaluate(`document.querySelector('#status')?.title ?? ''`)))
  );
  check(
    'status bar shows only the path',
    /^(papers\/)?[\w.-]+\.md$/.test((await evaluate(`document.querySelector('#status')?.textContent ?? ''`)).trim())
  );

  // The workspace folder name is always on screen, truncated when tight.
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 400 });
  await sleep(300);
  const folderName = await evaluate(`(() => {
    const el = document.querySelector('.side-name');
    const style = getComputedStyle(el);
    return {
      text: el.textContent,
      visible: style.opacity !== '0' && style.display !== 'none',
      ellipsis: style.textOverflow,
      clipped: el.scrollWidth > el.clientWidth,
    };
  })()`);
  check(
    'the sidebar shows the workspace folder name',
    folderName.visible && folderName.text.length > 0,
    JSON.stringify(folderName)
  );
  check('a long folder name is truncated, not wrapped', folderName.ellipsis === 'ellipsis');

  // --- VS Code-like tree: collapsed by default, keeps its position
  check(
    'folders start collapsed',
    (await evaluate(`document.querySelectorAll('.tree-dir[open]').length`)) === 0
  );
  await evaluate(
    `[...document.querySelectorAll('.tree-dir summary')].find((el) => el.textContent === 'archive')?.click()`
  );
  await sleep(400);
  check(
    'clicking a folder expands it',
    (await evaluate(`document.querySelectorAll('.tree-dir[open]').length`)) === 1
  );

  const scrolled = await evaluate(
    `(() => { const t = document.querySelector('.tree'); t.scrollTop = 60; return t.scrollTop; })()`
  );
  await evaluate(
    `[...document.querySelectorAll('.tree-file')].find((el) => el.textContent === 'old-06.md')?.click()`
  );
  await sleep(1200);
  const stillScrolled = await evaluate(`document.querySelector('.tree').scrollTop`);
  check(
    'tree keeps its scroll position when a file opens',
    scrolled > 0 && Math.abs(stillScrolled - scrolled) <= 1,
    `${scrolled} → ${stillScrolled}`
  );
  check(
    'expanded folder stays open',
    (await evaluate(`document.querySelectorAll('.tree-dir[open]').length`)) === 1
  );

  // Back to the article for the remaining layout checks.
  await evaluate(
    `[...document.querySelectorAll('.tree-file')].find((el) => el.textContent === 'elliptic.md')?.click()`
  );
  await sleep(1200);

  // CodeMirror only materialises widgets and lines inside the viewport, so the
  // end of the document has to be scrolled into view before checking either.
  await evaluate(`(() => {
    const scroller = document.querySelector('.cm-scroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  })()`);
  await sleep(900);

  const boldCount = await evaluate(`document.querySelectorAll('.ink-strong').length`);
  check('bold text is styled', boldCount > 0, `${boldCount} strong runs`);

  const tableCount = await evaluate(`document.querySelectorAll('.ink-table-editable table').length`);
  check('table rendered as a table', tableCount === 1, `${tableCount} tables`);

  const cellPoint = await evaluate(`(() => {
    const cell = document.querySelector('.ink-table-editable td');
    if (!cell) return null;
    const rect = cell.getBoundingClientRect();
    return { x: Math.round(rect.left + 8), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  if (cellPoint) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type,
        x: cellPoint.x,
        y: cellPoint.y,
        button: 'left',
        clickCount: 1,
      });
    }
    await sleep(500);
  }
  check(
    'clicking a cell opens an inline editor',
    cellPoint !== null && (await evaluate(`document.querySelectorAll('.ink-cell-editor').length`)) === 1,
    JSON.stringify(cellPoint)
  );
  check(
    'the table never falls back to source',
    (await evaluate(`document.querySelector('.cm-content')?.textContent?.includes('| --- |')`)) === false
  );

  await send('Input.insertText', { text: '42' });
  await sleep(700);
  check(
    'typing in a cell updates the document',
    (await evaluate(`document.querySelector('.ink-table-editable td')?.textContent ?? ''`)).startsWith('42')
  );

  const rowsBefore = await evaluate(`document.querySelectorAll('.ink-table-editable tr').length`);
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      modifiers: 4,
    });
  }
  await sleep(800);
  check(
    '⌘↵ adds a table row',
    (await evaluate(`document.querySelectorAll('.ink-table-editable tr').length`)) === rowsBefore + 1,
    `${rowsBefore} → ${await evaluate(`document.querySelectorAll('.ink-table-editable tr').length`)}`
  );
  await shoot('16-editable-table');
  await evaluate(`document.querySelector('.ink-table-block')?.scrollIntoView({block: 'center'})`);
  await sleep(600);
  await shoot('03-table-and-bold');

  // --- lists, code blocks and images (scan the document in viewport slices)
  const seen = { list: 0, code: 0, image: 0, display: 0, tagged: 0, errors: 0 };
  // Dense slices: a construct is only materialised while it is in the viewport,
  // so sparse samples can miss one and make the check flaky in the wrong way.
  for (const fraction of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.98]) {
    await evaluate(
      `(() => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = s.scrollHeight * ${fraction}; })()`
    );
    await sleep(450);
    const counts = await evaluate(`({
      list: document.querySelectorAll('.ink-list-mark').length,
      code: document.querySelectorAll('.ink-code-block pre').length,
      image: [...document.querySelectorAll('.ink-image img')].filter(
        (img) => (img.getAttribute('src') || '').startsWith('data:')
      ).length,
      display: document.querySelectorAll('.ink-math-block').length,
      tagged: [...document.querySelectorAll('.ink-math-block')].filter((el) =>
        (el.querySelector('mjx-container')?.getAttribute('ctxt') ?? el.innerHTML).includes('2.7')
      ).length,
      errors: document.querySelectorAll('.ink-math-error').length,
    })`);
    seen.list = Math.max(seen.list, counts.list);
    seen.code = Math.max(seen.code, counts.code);
    seen.image = Math.max(seen.image, counts.image);
    seen.display = Math.max(seen.display, counts.display);
    seen.tagged = Math.max(seen.tagged, counts.tagged);
    seen.errors = Math.max(seen.errors, counts.errors);
  }
  check('list bullets render', seen.list > 0, `${seen.list} bullets`);

  // Measure, don't guess: the continuation line's first character must sit at the
  // same x as the item's text (i.e. after the bullet), not at the bullet column.
  // Geometry of the requested layout: bullet two characters past the paragraph
  // margin, item text about one space after the bullet.
  const geometry = await evaluate(`(() => {
    const lines = [...document.querySelectorAll('.cm-line')];
    const paragraph = lines.find((el) => el.textContent.startsWith('注意'));
    const item = lines.find((el) => el.textContent.includes('列表项里的公式'));
    if (!paragraph || !item) return null;
    const x = (node) => {
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      return range.getBoundingClientRect().left;
    };
    const firstTextNode = (line, skipMarker) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          skipMarker && n.parentElement?.closest('.ink-list-mark')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      return walker.nextNode();
    };
    const paragraphNode = firstTextNode(paragraph, false);
    const bullet = item.querySelector('.ink-list-mark');
    const itemNode = firstTextNode(item, true);
    if (!paragraphNode || !bullet || !itemNode) return null;
    const bulletRect = bullet.getBoundingClientRect();
    return {
      paragraph: Math.round(x(paragraphNode)),
      bullet: Math.round(bulletRect.left),
      text: Math.round(x(itemNode)),
      ch: Number.parseFloat(getComputedStyle(item).fontSize) * 0.5,
    };
  })()`);
  check(
    'bullet sits about two characters past the text margin',
    geometry !== null && Math.abs(geometry.bullet - geometry.paragraph - geometry.ch * 2) <= 4,
    JSON.stringify(geometry)
  );
  check(
    'item text follows the bullet with a small gap',
    geometry !== null && geometry.text - geometry.bullet >= 10 && geometry.text - geometry.bullet <= 26,
    JSON.stringify(geometry)
  );

  const alignment = await evaluate(`(() => {
    const lines = [...document.querySelectorAll('.cm-line')];
    const first = lines.find((el) => el.textContent.includes('这一个条目'));
    const second = lines.find((el) => el.textContent.includes('第二行'));
    if (!first || !second) return null;
    const textX = (line) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.parentElement?.closest('.ink-list-mark,.ink-list-number')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      const node = walker.nextNode();
      if (!node) return null;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      return range.getBoundingClientRect().left;
    };
    const a = textX(first);
    const b = textX(second);
    return a === null || b === null ? null : { first: Math.round(a), second: Math.round(b) };
  })()`);
  check(
    'continuation line aligns with the item text',
    alignment !== null && Math.abs(alignment.first - alignment.second) <= 2,
    JSON.stringify(alignment)
  );

  await evaluate(
    `[...document.querySelectorAll('.cm-line')].find((el) => el.textContent.includes('这一个条目'))?.scrollIntoView({ block: 'center' })`
  );
  await sleep(500);
  await shoot('09-list-indent');
  check('fenced code block renders', seen.code > 0, `${seen.code} blocks`);
  check('image resolves to a data URI', seen.image > 0, `${seen.image} images`);
  check('display maths renders', seen.display > 0, `${seen.display} blocks`);
  check(
    'an explicit \\tag renders inside the formula, not beside it',
    seen.tagged > 0,
    `${seen.tagged} tagged blocks`
  );
  check('no formula fails to typeset', seen.errors === 0, `${seen.errors} errors`);

  await evaluate(`document.querySelector('.ink-code-block')?.scrollIntoView({block: 'center'})`);
  await sleep(600);
  await shoot('06-code-block');

  await evaluate(`document.querySelector('.ink-image')?.scrollIntoView({block: 'center'})`);
  await sleep(600);
  await shoot('07-figure-caption');

  // --- clicking a *visible* formula reveals its source
  // Only viewport elements exist, and the assertion must be able to fail:
  // `.ink-src` is emitted exclusively for constructs revealed by the caret.
  const clicked = await evaluate(`(() => {
    const visible = [...document.querySelectorAll('.ink-math')].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.top > 0 && rect.bottom < window.innerHeight;
    });
    if (visible.length === 0) return 'no visible inline maths';
    const el = visible[0];
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
    return 'clicked';
  })()`);
  check('inline formula is clickable', clicked === 'clicked', String(clicked));

  await sleep(700);
  const sourceSpans = await evaluate(`document.querySelectorAll('.ink-src').length`);
  check('clicking a formula reveals its source', sourceSpans > 0, `${sourceSpans} revealed spans`);
  await shoot('04-formula-revealed');

  // --- ArrowDown from the line above a display block enters it and shows the
  // live preview underneath, inside the document.
  // Bring the block into view from the top: CodeMirror only materialises widgets
  // inside the viewport, so the element may not exist at the current scroll.
  await evaluate(`(() => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = 0; })()`);
  await sleep(600);
  await evaluate(`(() => {
    const block = document.querySelector('.ink-math-block');
    const scroller = document.querySelector('.cm-scroller');
    if (!block || !scroller) return;
    const top = block.getBoundingClientRect().top;
    scroller.scrollTop += top - 240;
  })()`);
  await sleep(600);
  const entryPoint = await evaluate(`(() => {
    const block = document.querySelector('.ink-math-block');
    if (!block) return null;
    const top = block.getBoundingClientRect().top;
    const line = [...document.querySelectorAll('.cm-line')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom <= top + 1 && r.top > 0 && el.textContent.trim().length > 0;
      })
      .pop();
    if (!line) return null;
    const r = line.getBoundingClientRect();
    // Click near the start of the line and press End below: the column now
    // fills the pane, so a point near its right edge can land on the scrollbar.
    return { x: Math.round(r.left + 4), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (entryPoint) {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: entryPoint.x,
      y: entryPoint.y,
      button: 'left',
      clickCount: 1,
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: entryPoint.x,
      y: entryPoint.y,
      button: 'left',
      clickCount: 1,
    });
    await sleep(300);
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type,
        key: 'End',
        code: 'End',
        windowsVirtualKeyCode: 35,
      });
    }
    await sleep(200);
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type,
        key: 'ArrowDown',
        code: 'ArrowDown',
        windowsVirtualKeyCode: 40,
      });
    }
    await sleep(700);
  }
  check(
    'ArrowDown enters the display block',
    entryPoint !== null &&
      (await evaluate(`document.querySelectorAll('.ink-math-preview').length`)) === 1,
    JSON.stringify(entryPoint)
  );
  await shoot('11-math-editing-preview');

  // --- clicking a non-Markdown file explains itself
  await evaluate(`(() => {
    const target = [...document.querySelectorAll('.tree-file')].find((el) => el.textContent === 'data.bin');
    target?.click();
  })()`);
  await sleep(700);
  const unsupported = await evaluate(
    `!document.querySelector('#unsupportedState').classList.contains('hidden')`
  );
  check('non-markdown file shows the unsupported panel', Boolean(unsupported));

  // --- images preview inside the app instead of being rejected ------------
  await evaluate(`(() => {
    const target = [...document.querySelectorAll('.tree-file')].find((el) => el.textContent === 'figure.png');
    target?.click();
  })()`);
  await sleep(900);
  const media = await evaluate(`(() => {
    const panel = document.querySelector('#mediaState');
    const img = document.querySelector('#mediaImage');
    return {
      panel: panel && !panel.classList.contains('hidden'),
      src: img ? img.getAttribute('src') ?? '' : '',
      width: img ? Math.round(img.getBoundingClientRect().width) : 0,
      unsupported: !document.querySelector('#unsupportedState').classList.contains('hidden'),
    };
  })()`);
  check(
    'an image file previews in place',
    media.panel === true && media.src.startsWith('data:image/') && media.width > 40,
    JSON.stringify({ panel: media.panel, width: media.width })
  );
  check('the image preview replaces the "cannot preview" panel', media.unsupported === false);
  await shoot('31-image-preview');

  await evaluate(
    `[...document.querySelectorAll('.tree-file')].find((el) => el.textContent === 'elliptic.md')?.click()`
  );
  await sleep(1000);
  check(
    'opening a document hides the preview again',
    (await evaluate(`document.querySelector('#mediaState').classList.contains('hidden')`)) === true &&
      (await evaluate(`document.querySelectorAll('.cm-line').length`)) > 0
  );
  const panelText = await evaluate(
    `(document.querySelector('#unsupportedState')?.textContent ?? '').replace(/\\s+/g, '')`
  );
  check(
    'unsupported panel says only that it cannot preview',
    panelText === '⌀无法预览此文件',
    panelText
  );
  await shoot('05-unsupported-file');
  // --- plain text files open as editable text, manual save clears the dirty dot
  await send('Page.navigate', { url: `${baseUrl}/?case=text#demo` });
  await sleep(5000);
  await evaluate(`(() => {
    [...document.querySelectorAll('.tree-file')].find((el) => el.textContent === 'notes.txt')?.click();
  })()`);
  await sleep(1200);

  const textDoc = await evaluate(`document.querySelector('.cm-content')?.textContent ?? ''`);
  check('text file opens literally', textDoc.includes('# 纯文本文件'), textDoc.slice(0, 40));
  check(
    'text file is not rendered as markdown',
    (await evaluate(`document.querySelectorAll('.ink-h1').length`)) === 0
  );

  await evaluate(`document.querySelector('.cm-content')?.focus()`);
  await send('Input.insertText', { text: 'X' });
  await sleep(600);
  check('typing marks the tab dirty', (await evaluate(`document.querySelectorAll('.tab.dirty').length`)) === 1);
  check(
    'status shows an unsaved state',
    (await evaluate(`document.querySelector('#saveState')?.textContent ?? ''`)) === '未保存'
  );
  await shoot('10-unsaved-dot');

  // Cmd+S (Meta modifier = 4)
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: 's',
      code: 'KeyS',
      windowsVirtualKeyCode: 83,
      modifiers: 4,
    });
  }
  await sleep(800);
  check('saving clears the dirty marker', (await evaluate(`document.querySelectorAll('.tab.dirty').length`)) === 0);

  // --- Cmd+W on a modified file asks first, exactly like quitting
  await evaluate(`document.querySelector('.cm-content')?.focus()`);
  await send('Input.insertText', { text: 'Y' });
  await sleep(500);
  await evaluate(`document.querySelector('.tab.active .tab-close')?.click()`);
  await sleep(400);
  const prompt = await evaluate(`(() => {
    const modal = document.querySelector('#modal');
    if (!modal || modal.classList.contains('hidden')) return null;
    return {
      title: document.querySelector('#modalTitle')?.textContent ?? '',
      body: document.querySelector('.modal-body')?.textContent ?? '',
      buttons: [...modal.querySelectorAll('button')].map((el) => el.textContent),
      centred: Math.abs(
        modal.querySelector('.modal').getBoundingClientRect().top +
          modal.querySelector('.modal').getBoundingClientRect().height / 2 -
          window.innerHeight / 2
      ) < 60,
    };
  })()`);
  check(
    'closing a modified tab opens a centred dialog',
    prompt !== null && prompt.centred && prompt.title.includes('notes.txt'),
    JSON.stringify(prompt)
  );
  check(
    'the dialog offers save / discard / cancel',
    prompt !== null && prompt.buttons.join('/') === '保存/不保存/取消',
    JSON.stringify(prompt?.buttons)
  );
  check(
    'the dialog explains the consequence',
    prompt !== null && prompt.body.includes('将会丢失'),
    JSON.stringify(prompt?.body)
  );
  await shoot('12-close-tab-prompt');

  // Export feedback is a small pill at the top, not a strip at the bottom.
  const toastStyle = await evaluate(`(() => {
    const toast = document.querySelector('#toast');
    if (!toast) return null;
    const style = getComputedStyle(toast);
    return { position: style.position, top: Number.parseFloat(style.top), radius: style.borderRadius };
  })()`);
  check(
    'confirmation toast sits at the top',
    toastStyle !== null && toastStyle.position === 'fixed' && toastStyle.top < 120,
    JSON.stringify(toastStyle)
  );

  await evaluate(
    `[...document.querySelectorAll('#modalActions button')].find((el) => el.textContent === '取消')?.click()`
  );
  await sleep(300);
  check('cancelling keeps the tab open', (await evaluate(`document.querySelectorAll('.tab').length`)) === 2);

  await evaluate(`document.querySelector('.tab.active .tab-close')?.click()`);
  await sleep(300);
  await evaluate(
    `[...document.querySelectorAll('#modalActions button')].find((el) => el.textContent === '不保存')?.click()`
  );
  await sleep(600);
  check('discarding closes the tab', (await evaluate(`document.querySelectorAll('.tab').length`)) === 1);
  check(
    'closing the last modified tab clears the quit prompt',
    (await evaluate(`document.querySelectorAll('.tab.dirty').length`)) === 0
  );

  // --- the empty state says nothing at all
  await send('Page.navigate', { url: `${baseUrl}/?case=empty` });
  await sleep(4000);
  const emptyCopy = await evaluate(`(() => {
    const state = document.querySelector('#emptyState');
    if (!state || state.classList.contains('hidden')) return null;
    return {
      text: (state.textContent ?? '').trim(),
      buttons: state.querySelectorAll('button').length,
      labels: [...state.querySelectorAll('button')].map((el) => el.textContent),
    };
  })()`);
  check(
    'empty state offers the two entry points',
    emptyCopy !== null && emptyCopy.buttons === 2 && emptyCopy.text.includes('选择文件夹'),
    JSON.stringify(emptyCopy)
  );
  await shoot('13-empty-state');

  // --- settings dialog: theme, font size, document language
  await send('Page.navigate', { url: `${baseUrl}/?case=settings#demo` });
  await sleep(5000);
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: ',',
      code: 'Comma',
      windowsVirtualKeyCode: 188,
      modifiers: 4,
    });
  }
  await sleep(500);
  const settingsOpen = await evaluate(
    `!document.querySelector('#settingsPanel')?.classList.contains('hidden')`
  );
  check('⌘, opens the settings dialog', settingsOpen === true);

  await evaluate(`document.querySelector('#themeDark')?.click()`);
  await sleep(400);
  check(
    'settings switch the theme',
    (await evaluate(`document.documentElement.dataset.theme`)) === 'dark'
  );

  // Four palettes, each a full set of tokens rather than a filter.
  const paperOf = `getComputedStyle(document.documentElement).getPropertyValue('--ink-paper').trim()`;
  const palette = {};
  for (const id of ['sepia', 'slate', 'dark']) {
    await evaluate(`document.querySelector('#setTheme [data-theme="${id}"]')?.click()`);
    await sleep(250);
    palette[id] = await evaluate(paperOf);
  }
  check(
    'each theme paints its own paper colour',
    palette.sepia === '#faf3e4' && palette.slate === '#f6f8fa' && palette.dark === '#1e1e23',
    JSON.stringify(palette)
  );
  await evaluate(`document.querySelector('#themeSepia')?.click()`);
  await sleep(300);
  check(
    'the choice survives a reload',
    (await evaluate(`JSON.parse(localStorage.getItem('inklet.settings')).theme`)) === 'sepia',
    await evaluate(`JSON.parse(localStorage.getItem('inklet.settings')).theme`)
  );
  await evaluate(`document.querySelector('#themeLight')?.click()`);
  await sleep(300);

  const sizeBefore = await evaluate(`document.querySelector('#fontValue')?.textContent`);
  await evaluate(`document.querySelector('#fontUp')?.click()`);
  await sleep(300);
  const sizeAfter = await evaluate(`document.querySelector('#fontValue')?.textContent`);
  check(
    'settings scale the application chrome',
    sizeBefore === '100%' &&
      sizeAfter === '105%' &&
      (await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--ink-ui-scale')`)).trim() ===
        '1.05',
    `${sizeBefore} → ${sizeAfter}`
  );

  // ⌘+ / ⌘- resize the document body instead.
  const editorBefore = await evaluate(
    `getComputedStyle(document.documentElement).getPropertyValue('--ink-editor-size').trim()`
  );
  await evaluate(`document.querySelector('#settingsClose')?.click()`);
  await sleep(200);
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: '=',
      code: 'Equal',
      windowsVirtualKeyCode: 187,
      modifiers: 4,
    });
  }
  await sleep(400);
  const editorAfter = await evaluate(
    `getComputedStyle(document.documentElement).getPropertyValue('--ink-editor-size').trim()`
  );
  check(
    '⌘+ enlarges the document text',
    Number.parseFloat(editorAfter) === Number.parseFloat(editorBefore) + 1,
    `${editorBefore} → ${editorAfter}`
  );
  await evaluate(
    `[...document.querySelectorAll('#setTheme button')] // keep the DOM untouched`
  );
  await evaluate(`document.querySelector('#settingsPanel')?.classList.remove('hidden')`);

  await evaluate(`document.querySelector('#langEn')?.click()`);
  await sleep(600);
  const english = await evaluate(`({
    toolbar: document.querySelector('#openFolder')?.textContent ?? '',
    mode: document.querySelector('#modeLabel')?.textContent ?? '',
    save: document.querySelector('#saveState')?.textContent ?? '',
    diagnostics: document.querySelector('#diagnostics')?.textContent ?? '',
    brand: document.querySelector('#brand')?.title ?? '',
  })`);
  check(
    'settings switch the interface language',
    /choose|folder/i.test(english.toolbar),
    JSON.stringify(english.toolbar)
  );
  // Everything the window draws comes from the string table, so switching the
  // language has to reach the status bar and the diagnostic line too.
  check(
    'the status bar follows the language',
    english.mode === 'Live preview' && /Saved|Unsaved/.test(english.save),
    JSON.stringify({ mode: english.mode, save: english.save })
  );
  check(
    'diagnostics follow the language',
    english.diagnostics.includes('No problems'),
    String(english.diagnostics)
  );
  check(
    'chrome details follow the language',
    english.brand.includes('academic'),
    String(english.brand)
  );
  await shoot('15-settings');

  // Leave the defaults behind: later steps should not inherit dark/English.
  // Labels are translated now, so reset through the ids rather than the text.
  await evaluate(`document.querySelector('#themeLight')?.click()`);
  await evaluate(`document.querySelector('#langZh')?.click()`);
  await sleep(500);
  await evaluate(`document.querySelector('#settingsClose')?.click()`);
  await sleep(300);
  check(
    'settings reset back to the defaults',
    (await evaluate(`document.documentElement.dataset.theme`)) === 'light'
  );

  // --- the built-in guide is read-only
  await send('Page.navigate', { url: `${baseUrl}/?case=guide#demo` });
  await sleep(5000);
  await evaluate(`document.querySelector('#guideButton')?.click()`);
  await sleep(1200);
  const guideTab = await evaluate(`({
    tabs: [...document.querySelectorAll('.tab')].map((el) => el.textContent),
    hasContent: (document.querySelector('.cm-content')?.textContent ?? '').includes('使用指南'),
  })`);
  check(
    'the guide opens in its own tab',
    guideTab.tabs.some((name) => name.includes('使用指南')) && guideTab.hasContent,
    JSON.stringify(guideTab.tabs)
  );

  const beforeType = await evaluate(`document.querySelector('.cm-content')?.textContent ?? ''`);
  await evaluate(`document.querySelector('.cm-content')?.focus()`);
  await send('Input.insertText', { text: 'ZZZ' });
  await sleep(400);
  const afterType = await evaluate(`document.querySelector('.cm-content')?.textContent ?? ''`);
  check(
    'the guide cannot be edited',
    beforeType === afterType &&
      beforeType.length > 0 &&
      (await evaluate(`document.querySelectorAll('.tab.dirty').length`)) === 0
  );
  await shoot('14-guide');

  // --- split mode keeps both panes in step.
  // A fragment-only change does not reload a document, so add a query string to
  // force a real navigation into split mode.
  await send('Page.navigate', { url: `${baseUrl}/?case=split#demo&split` });
  await sleep(5000);
  await evaluate(`(() => {
    const scrollers = [...document.querySelectorAll('.cm-scroller')];
    scrollers[0].scrollTop = scrollers[0].scrollHeight * 0.6;
  })()`);
  await sleep(600);
  const previewScroll = await evaluate(
    `(() => { const s = [...document.querySelectorAll('.cm-scroller')]; return s[1]?.scrollTop ?? -1; })()`
  );
  check('scrolling the source moves the preview', previewScroll > 0, `preview scrollTop ${previewScroll}`);
  await shoot('08-split-scroll-sync');

  // --- typing blocks: Enter is a paragraph, ``` closes itself --------------
  //
  // The checks below rewrite the scratch note, so they run last and start from a
  // fresh navigation: every earlier step left the app in some other state.
  await send('Page.navigate', { url: `${baseUrl}/?case=typing#demo` });
  await sleep(5000);
  await evaluate(
    `[...document.querySelectorAll('.tree-file')].find((el) => el.textContent === 'notes.md')?.click()`
  );
  await sleep(1500);
  await evaluate(`document.querySelector('.cm-content')?.focus()`);

  const key = async (keyName, code, vk, modifiers = 0, text) => {
    const common = {
      key: keyName,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
    };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...common, ...(text ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
    await sleep(280);
  };
  const typeInto = async (text) => {
    await send('Input.insertText', { text });
    await sleep(420);
  };
  const measure = `(() => [...document.querySelectorAll('.cm-line')].map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      text: el.textContent,
      framed: el.classList.contains('ink-block-editing'),
      paraStart: el.classList.contains('ink-para-start'),
      bg: getComputedStyle(el).backgroundColor,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
    };
  }))()`;
  const caretLine = `(() => {
    const cursor = document.querySelector('.cm-cursor');
    if (!cursor) return null;
    const top = cursor.getBoundingClientRect().top;
    let best = null;
    for (const line of document.querySelectorAll('.cm-line')) {
      const rect = line.getBoundingClientRect();
      if (top >= rect.top - 2 && top <= rect.bottom) best = line.textContent;
    }
    return best;
  })()`;

  await key('a', 'KeyA', 65, 4, undefined); // ⌘A
  await typeInto('甲段文本');
  await key('Enter', 'Enter', 13, 0, '\r');
  await typeInto('乙段文本');
  const oneBreak = await evaluate(measure);
  check(
    'one Enter is one newline, exactly as in the file',
    oneBreak.length === 2 && oneBreak[1].text === '乙段文本',
    JSON.stringify(oneBreak.map((line) => line.text))
  );
  await key('Enter', 'Enter', 13, 0, '\r');
  await key('Enter', 'Enter', 13, 0, '\r');
  await typeInto('丙段文本');
  const twoBreaks = await evaluate(measure);
  check(
    'a blank line is what makes a new paragraph',
    twoBreaks.length === 4 && twoBreaks[2].text === '' && twoBreaks[3].text === '丙段文本',
    JSON.stringify(twoBreaks.map((line) => line.text))
  );
  check(
    'the paragraph gap is visibly wider than the leading',
    twoBreaks.length === 4 && twoBreaks[3].top - twoBreaks[1].bottom > 24,
    `${twoBreaks[1]?.bottom} → ${twoBreaks[3]?.top}`
  );
  await shoot('17-typing-paragraphs');

  // --- a list item's marker stays put, and Enter does not repeat it ---------
  await key('a', 'KeyA', 65, 4, undefined);
  await key('Backspace', 'Backspace', 8);
  await typeInto('- 第一项');
  await key('Enter', 'Enter', 13, 0, '\r');
  await typeInto('第二项');
  const listEnter = await evaluate(`({
    lines: [...document.querySelectorAll('.cm-line')].map((el) => el.textContent),
    padding: (() => {
      const line = document.querySelectorAll('.cm-line')[1];
      return line ? getComputedStyle(line).paddingLeft : null;
    })(),
  })`);
  check(
    'Enter never writes the list marker for you',
    listEnter.lines.some((line) => line.includes('第二项')) &&
      listEnter.lines.every((line) => !/^[-*+]\s/.test(line)),
    JSON.stringify(listEnter.lines)
  );

  // Enter ends the item and leaves the list: a blank line, as Typora does.
  await key('a', 'KeyA', 65, 4, undefined);
  await key('Backspace', 'Backspace', 8);
  await typeInto('- 甲项');
  await key('Enter', 'Enter', 13, 0, '\r');
  const exited = await evaluate(`[...document.querySelectorAll('.cm-line')].map((el) => el.textContent)`);
  check(
    'Enter after a bullet ends the list',
    exited.length === 3 && exited[1] === '' && exited[2] === '',
    JSON.stringify(exited)
  );

  // List lines sit closer together than prose.
  await key('a', 'KeyA', 65, 4, undefined);
  await key('Backspace', 'Backspace', 8);
  await typeInto('- 甲项');
  await key('Enter', 'Enter', 13, 0, '\r');
  await typeInto('正文段落');
  await sleep(300);
  const spacing = await evaluate(`(() => {
    const lines = [...document.querySelectorAll('.cm-line')];
    const list = lines.find((el) => el.textContent.includes('甲项'));
    const paragraph = lines.find((el) => el.textContent.includes('正文段落'));
    return {
      list: list ? Number.parseFloat(getComputedStyle(list).lineHeight) : null,
      paragraph: paragraph ? Number.parseFloat(getComputedStyle(paragraph).lineHeight) : null,
    };
  })()`);
  check(
    'list entries are spaced tighter than prose',
    spacing.list !== null && spacing.paragraph !== null && spacing.list < spacing.paragraph - 2,
    JSON.stringify(spacing)
  );

  await key('a', 'KeyA', 65, 4, undefined);
  await key('Backspace', 'Backspace', 8);
  await typeInto('- 列表项');
  const markerGeometry = await evaluate(`(() => {
    const line = document.querySelector('.cm-line');
    const mark = line?.querySelector('.ink-mark');
    if (!line || !mark) return null;
    const range = document.createRange();
    range.selectNodeContents(mark);
    return {
      markLeft: Math.round(range.getBoundingClientRect().left),
      padLeft: getComputedStyle(line).paddingLeft,
      textIndent: getComputedStyle(line).textIndent,
    };
  })()`);
  check(
    'the marker is not pushed out of the margin while editing',
    markerGeometry !== null &&
      markerGeometry.padLeft === '28px' &&
      markerGeometry.textIndent === '0px',
    JSON.stringify(markerGeometry)
  );
  await shoot('29-list-marker-editing');

  // --- the h2 rule is as wide as its text ----------------------------------
  await key('a', 'KeyA', 65, 4, undefined);
  await key('Backspace', 'Backspace', 8);
  await typeInto('## 短标题');
  await key('Enter', 'Enter', 13, 0, '\r');
  await typeInto('正文');
  await sleep(400);
  const ruleGeometry = await evaluate(`(() => {
    const rule = document.querySelector('.ink-h2-rule');
    if (!rule) return null;
    const line = rule.closest('.cm-line');
    return {
      rule: Math.round(rule.getBoundingClientRect().width),
      column: Math.round(line.getBoundingClientRect().width - 56),
    };
  })()`);
  check(
    'the h2 rule follows the text instead of the column',
    ruleGeometry !== null && ruleGeometry.rule < ruleGeometry.column - 40,
    JSON.stringify(ruleGeometry)
  );
  await shoot('30-h2-rule');

  // --- line-start markers stay editable until the caret leaves the line -----
  const markerState = `({
    lines: [...document.querySelectorAll('.cm-line')].map((el) => el.textContent),
    marks: [...document.querySelectorAll('.ink-mark')].map((el) => ({
      text: el.textContent,
      color: getComputedStyle(el).color,
    })),
    bullets: document.querySelectorAll('.ink-list-mark').length,
    size: getComputedStyle(document.querySelector('.cm-line')).fontSize,
  })`;

  await key('a', 'KeyA', 65, 4, undefined);
  await key('Backspace', 'Backspace', 8);
  await typeInto('## ');
  await typeInto('标题');
  const headingEdit = await evaluate(markerState);
  check(
    'the # of a heading stays visible while the line is edited',
    headingEdit.lines.join('|').includes('## 标题'),
    JSON.stringify(headingEdit.lines)
  );
  check(
    'the marker is drawn in the markup colour',
    headingEdit.marks.some((mark) => mark.text === '##' && mark.color === 'rgb(127, 150, 184)'),
    JSON.stringify(headingEdit.marks)
  );
  check(
    'the heading already renders at heading size',
    parseFloat(headingEdit.size) > 24,
    headingEdit.size
  );
  await shoot('22-heading-marker');
  await key('Enter', 'Enter', 13, 0, '\r');
  const headingDone = await evaluate(markerState);
  check(
    'Enter hides the heading marker',
    !headingDone.lines.join('|').includes('##'),
    JSON.stringify(headingDone.lines)
  );

  await typeInto('- ');
  await typeInto('条目');
  const listEdit = await evaluate(markerState);
  check(
    'the - of a list item stays visible while the line is edited',
    listEdit.marks.some((mark) => mark.text === '-') && listEdit.bullets === 0,
    JSON.stringify(listEdit)
  );
  await key('Enter', 'Enter', 13, 0, '\r');
  const listDone = await evaluate(markerState);
  check('Enter turns the - into a bullet', listDone.bullets === 1, JSON.stringify(listDone));
  await shoot('23-list-marker');

  // ``` + Enter creates a closed fence whose interior can be typed into.
  await key('a', 'KeyA', 65, 4, undefined);
  await typeInto('前段');
  await key('Enter', 'Enter', 13, 0, '\r');
  await typeInto('```');
  await key('Enter', 'Enter', 13, 0, '\r');
  const fenced = await evaluate(measure);
  check(
    '``` + Enter closes the fence and frames it',
    fenced.filter((line) => line.framed).map((line) => line.text).join('|') === '```||```',
    JSON.stringify(fenced.map((line) => line.text))
  );
  check('the caret starts inside the fence', (await evaluate(caretLine)) === '');
  await typeInto('let x = 1;');
  check(
    'typing goes into the code box',
    (await evaluate(measure)).some((line) => line.framed && line.text === 'let x = 1;')
  );
  await shoot('18-typing-fence');

  // The rendered code box is a block widget, so it does not inherit the line's
  // side padding; it has to line up with the prose by itself.
  const columnRect = `(() => {
    const style = (el) => getComputedStyle(el);
    const line = [...document.querySelectorAll('.cm-line')].find(
      (el) => el.textContent.trim().length > 0 && !el.classList.contains('ink-block-editing')
    );
    if (!line) return null;
    const r = line.getBoundingClientRect();
    return {
      left: Math.round(r.left + parseFloat(style(line).paddingLeft)),
      right: Math.round(r.right - parseFloat(style(line).paddingRight)),
    };
  })()`;
  const proseColumn = await evaluate(columnRect);
  const firstLinePoint = await evaluate(`(() => {
    const line = document.querySelector('.cm-line');
    const r = line.getBoundingClientRect();
    return { x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2) };
  })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x: firstLinePoint.x,
      y: firstLinePoint.y,
      button: 'left',
      clickCount: 1,
    });
  }
  await sleep(600);
  const codeBox = await evaluate(`(() => {
    const pre = document.querySelector('.ink-code-block pre');
    if (!pre) return null;
    const r = pre.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right) };
  })()`);
  check(
    'the code box sits on the text column',
    codeBox !== null &&
      proseColumn !== null &&
      Math.abs(codeBox.left - proseColumn.left) <= 2 &&
      Math.abs(codeBox.right - proseColumn.right) <= 2,
    JSON.stringify({ codeBox, proseColumn })
  );

  // Page margin drives the same variable, so the box follows.
  const linePad = `getComputedStyle(document.documentElement).getPropertyValue('--ink-line-pad').trim()`;
  const padBefore = await evaluate(linePad);
  await key(',', 'Comma', 188, 4);
  await sleep(500);
  check(
    'the settings dialog exposes the page margin',
    (await evaluate(`document.querySelector('#settingPageMargin')?.textContent`)) === '页边距' &&
      (await evaluate(`document.querySelector('#pageMarginValue')?.textContent`)) === '28px',
    await evaluate(`document.querySelector('#settingPageMargin')?.textContent`)
  );
  for (let step = 0; step < 3; step += 1) {
    await evaluate(`document.querySelector('#pageMarginUp')?.click()`);
  }
  await sleep(400);
  const padAfter = await evaluate(linePad);
  const columnAfter = await evaluate(columnRect);
  const codeAfter = await evaluate(`(() => {
    const pre = document.querySelector('.ink-code-block pre');
    if (!pre) return null;
    const r = pre.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right) };
  })()`);
  check(
    'the page margin setting widens the page margin',
    padBefore === '28px' && padAfter === '40px',
    `${padBefore} → ${padAfter}`
  );
  check(
    'the code box keeps following the text column',
    codeAfter !== null &&
      columnAfter !== null &&
      Math.abs(codeAfter.left - columnAfter.left) <= 2 &&
      columnAfter.left > (proseColumn?.left ?? 0),
    JSON.stringify({ codeAfter, columnAfter })
  );
  await shoot('20-page-margin');
  for (let step = 0; step < 3; step += 1) {
    await evaluate(`document.querySelector('#pageMarginDown')?.click()`);
  }
  await evaluate(`document.querySelector('#settingsClose')?.click()`);
  await sleep(400);
  check('the page margin goes back', (await evaluate(linePad)) === '28px', await evaluate(linePad));

  // A display formula frames its own lines only, and the caret may rest on the
  // closing `$$` without the block flipping back to a rendered widget.
  await key('a', 'KeyA', 65, 4, undefined);
  await typeInto(
    ['# 标题', '', '第一段正文。', '', '第二段正文。', '', '$$', 'a^2 + b^2 = c^2', '$$', '', '公式后的段落。'].join('\n')
  );
  const formulaPoint = await evaluate(`(() => {
    const math = document.querySelector('.ink-math-block, .ink-math');
    if (!math) return null;
    const rect = math.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  if (formulaPoint) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type,
        x: formulaPoint.x,
        y: formulaPoint.y,
        button: 'left',
        clickCount: 1,
      });
    }
    await sleep(700);
  }
  const editing = await evaluate(measure);
  const framedMath = editing.filter((line) => line.framed);
  const strayShade = editing.filter((line) => !line.framed && line.bg !== 'rgba(0, 0, 0, 0)');
  check(
    'editing a formula frames the formula lines only',
    framedMath.map((line) => line.text).join('|') === '$$|a^2 + b^2 = c^2|$$',
    JSON.stringify(editing.map((line) => line.text))
  );
  check('no prose line is shaded while editing maths', strayShade.length === 0, JSON.stringify(strayShade.map((line) => line.text)));

  await key('End', 'End', 35);
  await key('ArrowDown', 'ArrowDown', 40);
  await key('End', 'End', 35);
  check('the caret can rest after the closing $$', (await evaluate(caretLine)) === '$$', String(await evaluate(caretLine)));
  await key('Enter', 'Enter', 13, 0, '\r');
  const afterEnter = await evaluate(measure);
  check(
    'Enter on the closer does not open a second formula',
    afterEnter.filter((line) => line.text.includes('$$')).length === 0,
    JSON.stringify(afterEnter.filter((line) => line.text.includes('$$')).map((line) => line.text))
  );
  await shoot('19-typing-maths');

  // --- ⌘⌥C inserts a highlighted fenced block ------------------------------
  await key('a', 'KeyA', 65, 4, undefined);
  await key('Backspace', 'Backspace', 8);
  await typeInto('说明');
  await key('Enter', 'Enter', 13, 0, '\r');
  await key('Enter', 'Enter', 13, 0, '\r');
  await key('c', 'KeyC', 67, 5); // ⌘⌥C
  const languageCount = await evaluate(`document.querySelectorAll('#codeLangSelect option').length`);
  check(
    '⌘⌥C opens the code-block dialog',
    (await evaluate(`!document.querySelector('#codePanel').classList.contains('hidden')`)) === true,
    `${languageCount} entries`
  );
  check('the picker offers the common languages', languageCount > 10, String(languageCount));
  await shoot('27-code-dialog');

  await evaluate(`document.querySelector('#codeLangSelect').value = 'python'`);
  await evaluate(`document.querySelector('#codeInsert').click()`);
  await sleep(400);
  await typeInto('def f(x):');
  await key('Enter', 'Enter', 13, 0, '\r');
  await typeInto('    return x + 1');

  // Click back onto the paragraph so the block renders instead of being edited.
  const prosePoint = await evaluate(`(() => {
    const line = document.querySelector('.cm-line');
    const r = line.getBoundingClientRect();
    return { x: Math.round(r.left + 50), y: Math.round(r.top + r.height / 2) };
  })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x: prosePoint.x,
      y: prosePoint.y,
      button: 'left',
      clickCount: 1,
    });
  }
  await sleep(700);
  check(
    'the fence remembers its language',
    (await evaluate(`document.querySelector('.ink-code-block code')?.className ?? ''`)) === 'language-python',
    await evaluate(`document.querySelector('.ink-code-block code')?.className ?? ''`)
  );
  check(
    'the block renders highlighted tokens',
    (await evaluate(`document.querySelectorAll('.ink-code-block .hljs-keyword').length`)) >= 2,
    String(await evaluate(`document.querySelectorAll('.ink-code-block .hljs-keyword').length`))
  );
  check(
    'highlighted tokens are coloured',
    (await evaluate(`getComputedStyle(document.querySelector('.ink-code-block .hljs-keyword')).color`)) ===
      'rgb(138, 63, 168)',
    await evaluate(`getComputedStyle(document.querySelector('.ink-code-block .hljs-keyword')).color`)
  );
  await shoot('28-code-highlighted');

  // --- ⌘/ flips between the two view modes, one press at a time ------------
  const modeLabel = `document.querySelector('#modeLabel')?.textContent ?? ''`;
  const editorText = `document.querySelector('.cm-content')?.textContent ?? ''`;
  check('the view starts in live preview', (await evaluate(modeLabel)) === '实时渲染');
  await evaluate(`document.querySelector('.cm-content')?.focus()`);
  const textBefore = await evaluate(editorText);
  await key('/', 'Slash', 191, 4);
  const textAfter = await evaluate(editorText);
  // CodeMirror binds ⌘/ to "toggle comment", which wrapped text in `<!-- -->`
  // and left it in the draft. The binding is gone, so the key is inert.
  check(
    '⌘/ is inert and leaves no comment behind',
    textBefore === textAfter &&
      !textAfter.includes('<!--') &&
      (await evaluate(modeLabel)) === '实时渲染',
    JSON.stringify({ before: textBefore.length, after: textAfter.length, mode: await evaluate(modeLabel) })
  );

  // --- side-by-side keeps the native Markdown Enter -------------------------
  // The source is on screen there, so one Enter is one newline: people who
  // write Markdown by hand expect that, and the preview shows them the result.
  await key('2', 'Digit2', 50, 4);
  await sleep(900);
  check('⌘2 opens the side-by-side view', (await evaluate(modeLabel)) === '左右对照', await evaluate(modeLabel));
  await evaluate(`document.querySelectorAll('.cm-content')[0]?.focus()`);
  await key('a', 'KeyA', 65, 4, undefined);
  await typeInto('丙');
  await key('Enter', 'Enter', 13, 0, '\r');
  await typeInto('丁');
  const splitLines = await evaluate(
    `[...document.querySelectorAll('.cm-content')[0].querySelectorAll('.cm-line')].map((el) => el.textContent)`
  );
  check('side-by-side: one Enter is one newline', splitLines.join('|') === '丙|丁', JSON.stringify(splitLines));
  await shoot('21-split-enter');
  await key('1', 'Digit1', 49, 4);
  await sleep(700);
  check('⌘1 returns to live preview', (await evaluate(modeLabel)) === '实时渲染', await evaluate(modeLabel));

  // --- the sidebar can be dragged narrower, or out of the way entirely ------
  const sidebarWidth = `Math.round(document.querySelector('#sidebar').getBoundingClientRect().width)`;
  const handleAt = () =>
    evaluate(`(() => {
      const r = document.querySelector('#sidebarResizer').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 200) };
    })()`);
  const dragHandleTo = async (toX) => {
    const spot = await handleAt();
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: toX, y: spot.y, button: 'left', buttons: 1 });
    await sleep(120);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: spot.y, button: 'left', clickCount: 1 });
    await sleep(320);
  };

  const sidebarBefore = await evaluate(sidebarWidth);
  await dragHandleTo(330);
  const sidebarWide = await evaluate(sidebarWidth);
  check('dragging the divider widens the sidebar', sidebarWide > sidebarBefore + 40, `${sidebarBefore} → ${sidebarWide}`);
  await shoot('25-sidebar-dragged');

  const handleOnBorder = await evaluate(`(() => {
    const side = document.querySelector('#sidebar').getBoundingClientRect();
    const handle = document.querySelector('#sidebarResizer').getBoundingClientRect();
    return { side: Math.round(side.right), handle: Math.round(handle.left + handle.width / 2) };
  })()`);
  check(
    'the drag handle sits on the sidebar border',
    Math.abs(handleOnBorder.side - handleOnBorder.handle) <= 2,
    JSON.stringify(handleOnBorder)
  );

  // The folder name gives way first; the two tabs keep their width.
  await dragHandleTo(150);
  const squeezed = await evaluate(`(() => {
    const name = document.querySelector('.side-name');
    const tabs = [...document.querySelectorAll('.side-tab')].map((el) =>
      Math.round(el.getBoundingClientRect().width)
    );
    return {
      width: Math.round(document.querySelector('#sidebar').getBoundingClientRect().width),
      clipped: name.scrollWidth > name.clientWidth,
      tabs,
      collapsed: document.querySelector('#sidebar').classList.contains('collapsed'),
    };
  })()`);
  check(
    'the folder name is squeezed before the tabs are',
    squeezed.collapsed === false && squeezed.clipped === true && squeezed.tabs.every((w) => w >= 38),
    JSON.stringify(squeezed)
  );

  // Narrower than the 文件|大纲 tabs: hide the column rather than clip it.
  await dragHandleTo(110);
  const sidebarHidden = await evaluate(`({
    width: ${sidebarWidth},
    collapsed: document.querySelector('#sidebar').classList.contains('collapsed'),
    handle: Math.round(document.querySelector('#sidebarResizer').getBoundingClientRect().left),
    toggle: !document.querySelector('#sidebarToggle').classList.contains('hidden'),
    toggleX: Math.round(document.querySelector('#sidebarToggle').getBoundingClientRect().left),
  })`);
  check(
    'a too-narrow drag hides the sidebar instead of clipping it',
    sidebarHidden.collapsed === true && sidebarHidden.width === 0,
    JSON.stringify(sidebarHidden)
  );
  check(
    'the divider stays reachable while hidden',
    sidebarHidden.handle <= 4,
    String(sidebarHidden.handle)
  );
  check(
    'a toggle appears at the left of the tab bar',
    sidebarHidden.toggle === true && sidebarHidden.toggleX < 12,
    JSON.stringify(sidebarHidden)
  );
  await shoot('26-sidebar-hidden');

  await evaluate(`document.querySelector('#sidebarToggle').click()`);
  await sleep(400);
  check(
    'the toggle brings the sidebar back',
    (await evaluate(sidebarWidth)) > 150 &&
      (await evaluate(`document.querySelector('#sidebarToggle').classList.contains('hidden')`)) === true,
    String(await evaluate(sidebarWidth))
  );

  // --- a new file lands next to the open one, also at the workspace root ----
  // The path used to keep the root-level file name as its "folder", so the write
  // failed with EEXIST because that name is a file.
  await evaluate(
    `[...document.querySelectorAll('.tree-file')].find((el) => el.textContent === 'README.md')?.click()`
  );
  await sleep(1200);
  await evaluate(`document.querySelector('#newEntry')?.click()`);
  await sleep(400);
  await evaluate(`document.querySelector('#newName').value = '新建文件'`);
  await evaluate(`document.querySelector('#newCreate')?.click()`);
  await sleep(1400);
  const statusPath = (await evaluate(`document.querySelector('#status')?.textContent ?? ''`)).trim();
  const treeAfterCreate = await evaluate(
    `[...document.querySelectorAll('.tree-file')].map((el) => el.textContent)`
  );
  check(
    'a new file from a root-level document lands at the root',
    statusPath === '新建文件.md' && treeAfterCreate.includes('新建文件.md'),
    JSON.stringify({ statusPath, treeNames: treeAfterCreate.slice(0, 6) })
  );
  await shoot('24-new-file-at-root');
} finally {
  const failed = checks.filter((entry) => !entry.ok);
  socket.close();
  chrome.kill();
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}
