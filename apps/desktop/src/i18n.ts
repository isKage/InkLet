/** Interface strings. Document language (captions) is separate and lives in core. */
export type Lang = 'zh' | 'en';

export interface Strings {
  readonly openFolder: string;
  readonly guide: string;
  readonly files: string;
  readonly outline: string;
  readonly treeEmpty: string;
  readonly outlineEmpty: string;
  readonly settings: string;
  readonly appearance: string;
  readonly light: string;
  readonly sepia: string;
  readonly slate: string;
  readonly dark: string;
  readonly fontSize: string;
  readonly language: string;
  readonly done: string;
  readonly save: string;
  readonly discard: string;
  readonly cancel: string;
  readonly confirm: string;
  readonly overwrite: string;
  readonly reload: string;
  readonly later: string;
  readonly noFile: string;
  readonly untitled: string;
  readonly readonly: string;
  readonly saved: string;
  readonly unsaved: string;
  readonly saving: string;
  readonly diskChanged: string;
  readonly exportPreparing: string;
  readonly exportRunning: string;
  readonly exportDone: string;
  readonly exportCancelled: string;
  readonly saveQuestion: (name: string) => string;
  readonly loseWarning: string;
  readonly conflictTitle: (name: string) => string;
  readonly conflictBody: string;
  readonly noDocToExport: string;
  readonly textNoPdf: string;
  readonly exportFailed: (reason: string) => string;
  readonly createFailed: (reason: string) => string;
  readonly newWindowNeedsApp: string;
  readonly tableTitle: string;
  readonly tableRows: string;
  readonly tableColumns: string;
  readonly insert: string;
  readonly codeTitle: string;
  readonly codeLanguage: string;
  readonly codePlain: string;
  readonly newEntryTitle: string;
  readonly newEntryKind: string;
  readonly newEntryName: string;
  readonly newEntryFile: string;
  readonly newEntryDir: string;
  readonly create: string;
  readonly newEntry: string;
  readonly noWorkspaceForNew: string;
  readonly rename: string;
  readonly copy: string;
  readonly copyPath: string;
  readonly deleteAction: string;
  readonly copied: string;
  readonly pathCopied: string;
  readonly deleteConfirm: (name: string) => string;
  readonly deleteWarning: string;
  readonly fileOpFailed: (reason: string) => string;
  readonly editorSize: string;
  readonly leading: string;
  readonly paraGap: string;
  readonly pageMargin: string;
  readonly catEditor: string;
  readonly catLook: string;
  readonly catKeys: string;
  readonly shortcutCloseTab: string;
  readonly shortcutNewWindow: string;
  readonly livePreview: string;
  readonly splitView: string;

  // --- status bar and diagnostics
  readonly charCount: (count: number) => string;
  readonly parseTime: (ms: string) => string;
  readonly headingCount: (count: number) => string;
  readonly macroCount: (count: number) => string;
  readonly noDiagnostics: string;
  readonly diagnosticRow: (line: number, message: string) => string;
  readonly diagMessages: Readonly<Record<string, string>>;

  // --- failures and toasts
  readonly openFileFailed: (reason: string) => string;
  readonly openFolderFailed: (reason: string) => string;
  readonly openPathFailed: (reason: string) => string;
  readonly imageUnavailable: string;
  readonly switchedTo: (name: string) => string;
  readonly cannotPreview: (path: string) => string;
  readonly noFileAccess: string;

  // --- chrome details
  readonly closeTabLabel: string;
  readonly switchToLight: string;
  readonly switchToDark: string;
  readonly brandTitle: string;
  readonly appTagline: string;
  readonly resizerHint: string;
  readonly showSidebar: string;
  readonly pdfPreview: string;
  readonly cannotPreviewTitle: string;
  readonly dropTitle: string;
  readonly dropSub: string;
  readonly browserTagline: string;

  // --- file dialogs
  readonly exportDialogTitle: string;
  readonly untitledFileName: string;
  readonly newFolderName: string;
  readonly copyName: (base: string, extension: string) => string;
  readonly guideTitle: string;
}

export const STRINGS: Record<Lang, Strings> = {
  zh: {
    openFolder: '选择文件夹',
    guide: '指南',
    files: '文件',
    outline: '大纲',
    treeEmpty: '这里没有可打开的文件',
    outlineEmpty: '（无标题）',
    settings: '设置',
    appearance: '外观',
    light: '浅色',
    sepia: '暖纸',
    slate: '蓝灰',
    dark: '深色',
    fontSize: '界面字号',
    language: '界面语言',
    done: '完成',
    save: '保存',
    discard: '不保存',
    cancel: '取消',
    confirm: '确定',
    overwrite: '用我的覆盖',
    reload: '重新载入磁盘版本',
    later: '稍后处理',
    noFile: '未打开文件',
    untitled: '未命名草稿',
    readonly: '只读',
    saved: '已保存',
    unsaved: '未保存',
    saving: '保存中…',
    diskChanged: '磁盘已被修改',
    exportPreparing: '准备导出…',
    exportRunning: '导出中…',
    exportDone: '导出成功',
    exportCancelled: '已取消导出',
    saveQuestion: (name) => `是否保存对文件 ${name} 的修改？`,
    loseWarning: '若不保存，你的修改将会丢失。',
    conflictTitle: (name) => `${name} 在磁盘上被修改过`,
    conflictBody: '当前编辑内容尚未写入。',
    noDocToExport: '先打开一个文档再导出',
    textNoPdf: '纯文本文件没有排版，无法导出',
    exportFailed: (reason) => `导出失败：${reason}`,
    createFailed: (reason) => `新建失败：${reason}`,
    newWindowNeedsApp: '新窗口需要桌面应用',
    tableTitle: '插入表格',
    tableRows: '行',
    tableColumns: '列',
    insert: '插入',
    codeTitle: '插入代码块',
    codeLanguage: '语言',
    codePlain: '纯文本（无高亮）',
    newEntryTitle: '新建',
    newEntryKind: '类型',
    newEntryName: '名称',
    newEntryFile: '文件',
    newEntryDir: '文件夹',
    create: '创建',
    newEntry: '新建',
    noWorkspaceForNew: '先打开一个文件夹',
    rename: '重命名…',
    copy: '复制',
    copyPath: '复制文件路径',
    deleteAction: '删除',
    copied: '已复制',
    pathCopied: '路径已复制',
    deleteConfirm: (name) => `删除 ${name}？`,
    deleteWarning: '删除后无法恢复。',
    fileOpFailed: (reason) => `操作失败：${reason}`,
    editorSize: '正文字号',
    leading: '段内行距',
    paraGap: '段间距',
    pageMargin: '页边距',
    catEditor: '编辑器',
    catLook: '外观',
    catKeys: '快捷键',
    shortcutCloseTab: '关闭标签页',
    shortcutNewWindow: '新窗口',
    livePreview: '实时渲染',
    splitView: '左右对照',

    charCount: (count) => `${count} 字符`,
    parseTime: (ms) => `解析 ${ms}ms`,
    headingCount: (count) => `${count} 标题`,
    macroCount: (count) => `${count} 宏`,
    noDiagnostics: '✓ 无诊断',
    diagnosticRow: (line, message) => `第 ${line} 行 · ${message}`,
    diagMessages: {
      BadMath: '公式块未闭合',
      BadFrontMatter: 'front matter 解析失败',
      BadMacroDefinition: '宏定义有问题',
      UnknownMacro: '未知宏',
      UnconvertibleSyntax: '无法转换的语法',
    },

    openFileFailed: (reason) => `打开文件失败：${reason}`,
    openFolderFailed: (reason) => `打开文件夹失败：${reason}`,
    openPathFailed: (reason) => `无法打开：${reason}`,
    imageUnavailable: '无法读取这张图片',
    switchedTo: (name) => `已切换到 ${name}`,
    cannotPreview: (path) => `${path}（无法预览）`,
    noFileAccess:
      '浏览器预览模式无法访问本机文件系统。请运行 `pnpm dev:tauri` 打开桌面窗口，或使用打包后的应用，才能选择电脑上的任意文件夹。',

    closeTabLabel: '关闭',
    switchToLight: '切换到浅色',
    switchToDark: '切换到深色',
    brandTitle: 'InkLet · 学术草稿编辑器',
    appTagline: '学术草稿编辑器',
    resizerHint: '拖动调整宽度',
    showSidebar: '显示侧栏',
    pdfPreview: 'PDF 预览',
    cannotPreviewTitle: '无法预览此文件',
    dropTitle: '松开即打开',
    dropSub: '',
    browserTagline: '浏览器预览 · 无文件访问',

    exportDialogTitle: '导出为 PDF',
    untitledFileName: '未命名',
    newFolderName: '新建文件夹',
    copyName: (base, extension) => `${base} 副本${extension}`,
    guideTitle: '使用指南',
  },
  en: {
    openFolder: 'Choose Folder',
    guide: 'Guide',
    files: 'Files',
    outline: 'Outline',
    treeEmpty: 'No openable files here',
    outlineEmpty: '(no headings)',
    settings: 'Settings',
    appearance: 'Appearance',
    light: 'Light',
    sepia: 'Sepia',
    slate: 'Slate',
    dark: 'Dark',
    fontSize: 'Interface size',
    language: 'Interface language',
    done: 'Done',
    save: 'Save',
    discard: "Don't Save",
    cancel: 'Cancel',
    confirm: 'OK',
    overwrite: 'Overwrite',
    reload: 'Reload from disk',
    later: 'Later',
    noFile: 'No file open',
    untitled: 'Untitled',
    readonly: 'Read-only',
    saved: 'Saved',
    unsaved: 'Unsaved',
    saving: 'Saving…',
    diskChanged: 'Changed on disk',
    exportPreparing: 'Preparing…',
    exportRunning: 'Exporting…',
    exportDone: 'Exported',
    exportCancelled: 'Export cancelled',
    saveQuestion: (name) => `Save changes to ${name}?`,
    loseWarning: 'Your changes will be lost if you do not save them.',
    conflictTitle: (name) => `${name} changed on disk`,
    conflictBody: 'Your edits have not been written yet.',
    noDocToExport: 'Open a document before exporting',
    textNoPdf: 'Plain text has no layout to export',
    exportFailed: (reason) => `Export failed: ${reason}`,
    createFailed: (reason) => `Could not create: ${reason}`,
    newWindowNeedsApp: 'New windows need the desktop app',
    tableTitle: 'Insert Table',
    tableRows: 'Rows',
    tableColumns: 'Columns',
    insert: 'Insert',
    codeTitle: 'Insert code block',
    codeLanguage: 'Language',
    codePlain: 'Plain text (no highlighting)',
    newEntryTitle: 'New',
    newEntryKind: 'Type',
    newEntryName: 'Name',
    newEntryFile: 'File',
    newEntryDir: 'Folder',
    create: 'Create',
    newEntry: 'New',
    noWorkspaceForNew: 'Open a folder first',
    rename: 'Rename…',
    copy: 'Duplicate',
    copyPath: 'Copy Path',
    deleteAction: 'Delete',
    copied: 'Duplicated',
    pathCopied: 'Path copied',
    deleteConfirm: (name) => `Delete ${name}?`,
    deleteWarning: 'This cannot be undone.',
    fileOpFailed: (reason) => `Failed: ${reason}`,
    editorSize: 'Text size',
    leading: 'Line height',
    paraGap: 'Paragraph gap',
    pageMargin: 'Page margin',
    catEditor: 'Editor',
    catLook: 'Appearance',
    catKeys: 'Shortcuts',
    shortcutCloseTab: 'Close tab',
    shortcutNewWindow: 'New window',
    livePreview: 'Live preview',
    splitView: 'Split view',

    charCount: (count) => `${count} characters`,
    parseTime: (ms) => `parsed in ${ms}ms`,
    headingCount: (count) => `${count} headings`,
    macroCount: (count) => `${count} macros`,
    noDiagnostics: '✓ No problems',
    diagnosticRow: (line, message) => `line ${line} · ${message}`,
    diagMessages: {
      BadMath: 'Display maths is not closed',
      BadFrontMatter: 'Front matter could not be parsed',
      BadMacroDefinition: 'Malformed macro definition',
      UnknownMacro: 'Unknown macro',
      UnconvertibleSyntax: 'Syntax that cannot be converted',
    },

    openFileFailed: (reason) => `Could not open the file: ${reason}`,
    openFolderFailed: (reason) => `Could not open the folder: ${reason}`,
    openPathFailed: (reason) => `Could not open: ${reason}`,
    imageUnavailable: 'This image could not be read',
    switchedTo: (name) => `Switched to ${name}`,
    cannotPreview: (path) => `${path} (cannot preview)`,
    noFileAccess:
      'The browser preview has no filesystem access. Run `pnpm dev:tauri` for the desktop window, or use the packaged app, to open any folder on this computer.',

    closeTabLabel: 'Close',
    switchToLight: 'Switch to light',
    switchToDark: 'Switch to dark',
    brandTitle: 'InkLet · academic drafts',
    appTagline: 'academic drafts',
    resizerHint: 'Drag to resize',
    showSidebar: 'Show sidebar',
    pdfPreview: 'PDF preview',
    cannotPreviewTitle: 'This file cannot be previewed',
    dropTitle: 'Release to open',
    dropSub: '',
    browserTagline: 'Browser preview · no filesystem access',

    exportDialogTitle: 'Export as PDF',
    untitledFileName: 'Untitled',
    newFolderName: 'New folder',
    copyName: (base, extension) => `${base} copy${extension}`,
    guideTitle: 'Guide',
  },
};
