// InkLet desktop shell.
//
// The frontend is a static bundle rendered in the system WebView; the shell's
// only job is file access. Everything the editor knows about the document comes
// from the text itself, so these commands deliberately stay tiny and dumb.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, MenuItemBuilder, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Wry};

mod terminal;

/// FNV-1a: a fast change detector, not a security primitive.
pub fn fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Resolves a workspace-relative path and refuses anything that escapes the root.
pub fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    if Path::new(rel).components().any(|part| matches!(part, Component::ParentDir)) {
        return Err("path escapes the workspace".into());
    }
    let root_path = fs::canonicalize(root).map_err(|error| format!("workspace: {error}"))?;
    let candidate = root_path.join(rel);
    let resolved = if candidate.exists() {
        fs::canonicalize(&candidate).map_err(|error| error.to_string())?
    } else {
        candidate
    };
    if !resolved.starts_with(&root_path) {
        return Err("path escapes the workspace".into());
    }
    Ok(resolved)
}

fn should_skip(name: &str) -> bool {
    matches!(name, "node_modules" | ".git" | ".obsidian" | "target" | ".pnpm-store" | "dist")
}

#[derive(serde::Serialize)]
pub struct Entry {
    path: String,
    name: String,
    is_dir: bool,
}

#[derive(serde::Serialize)]
pub struct FileSnapshot {
    content: String,
    hash: String,
}

#[derive(serde::Serialize)]
pub struct WriteResult {
    hash: String,
    conflict: bool,
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<Entry>, depth: usize) -> Result<(), String> {
    if depth > 12 || out.len() > 5000 {
        return Ok(());
    }
    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || should_skip(&name) {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map(|value| value.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        if path.is_dir() {
            out.push(Entry { path: rel, name, is_dir: true });
            walk(root, &path, out, depth + 1)?;
        } else {
            // Every file is listed: the tree is a file browser. The editor
            // decides what it can actually open.
            out.push(Entry { path: rel, name, is_dir: false });
        }
    }
    Ok(())
}

#[tauri::command]
fn list_files(root: String) -> Result<Vec<Entry>, String> {
    let root_path = fs::canonicalize(&root).map_err(|error| format!("workspace: {error}"))?;
    let mut out = Vec::new();
    walk(&root_path, &root_path, &mut out, 0)?;
    Ok(out)
}

/// Standard base64 (RFC 4648). Implemented here to avoid a dependency for one
/// small, well-specified function.
fn base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        let bits = (u32::from(first) << 16) | (u32::from(second) << 8) | u32::from(third);
        out.push(TABLE[(bits >> 18) as usize & 63] as char);
        out.push(TABLE[(bits >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(bits >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[bits as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn image_mime(path: &Path) -> Result<&'static str, String> {
    match path.extension().and_then(|ext| ext.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("png") => Ok("image/png"),
        Some("jpg") | Some("jpeg") => Ok("image/jpeg"),
        Some("gif") => Ok("image/gif"),
        Some("webp") => Ok("image/webp"),
        Some("svg") => Ok("image/svg+xml"),
        Some("bmp") => Ok("image/bmp"),
        Some("avif") => Ok("image/avif"),
        _ => Err("unsupported image type".into()),
    }
}

const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

/// Returns an image as a `data:` URI.
///
/// A data URI keeps the renderer free of Tauri's asset protocol and CSP scope
/// rules; the size cap keeps a stray 200 MB file from locking up the WebView.
#[tauri::command]
fn read_image(root: String, rel: String) -> Result<String, String> {
    let path = resolve(&root, &rel)?;
    let mime = image_mime(&path)?;
    let size = fs::metadata(&path).map_err(|error| error.to_string())?.len();
    if size > MAX_IMAGE_BYTES {
        return Err(format!("image larger than {} MB", MAX_IMAGE_BYTES / 1024 / 1024));
    }
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    Ok(format!("data:{mime};base64,{}", base64(&bytes)))
}

/// Refuses to load something a note editor has no business holding in memory.
const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;

#[tauri::command]
fn read_file(root: String, rel: String) -> Result<FileSnapshot, String> {
    let path = resolve(&root, &rel)?;
    let size = fs::metadata(&path).map_err(|error| error.to_string())?.len();
    if size > MAX_TEXT_BYTES {
        return Err(format!(
            "file is larger than {} MB",
            MAX_TEXT_BYTES / 1024 / 1024
        ));
    }
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let content = String::from_utf8(bytes).map_err(|_| "file is not valid UTF-8".to_string())?;
    Ok(FileSnapshot { hash: fingerprint(content.as_bytes()), content })
}

/// Creates an empty file or a directory inside the workspace.
#[tauri::command]
fn create_entry(root: String, rel: String, kind: String) -> Result<String, String> {
    let path = resolve(&root, &rel)?;
    if path.exists() {
        return Err("同名文件或文件夹已存在".to_string());
    }
    if let Some(parent) = path.parent() {
        // A path like `notes.txt/新文件.md` passes `exists()` yet cannot be
        // created: the "folder" is a file. Say so instead of surfacing
        // "file exists (os error 17)".
        if !parent.is_dir() {
            return Err("上级路径不是文件夹".to_string());
        }
    }
    if kind == "dir" {
        fs::create_dir(&path).map_err(|error| error.to_string())?;
    } else {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&path, "").map_err(|error| error.to_string())?;
    }
    Ok(rel)
}

/// A workspace to open, and the file inside it that was asked for.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct OpenTarget {
    /// Absolute path of the folder that becomes the workspace.
    pub root: String,
    /// Path relative to `root`, when a file was dropped rather than a folder.
    pub file: Option<String>,
}

/// Turns a path the user dropped or opened into a workspace root.
///
/// A folder is the workspace; a file means "its folder is the workspace, and
/// this is the file to open". Keeping this in Rust means one place decides, and
/// it can be unit-tested without a window.
pub fn open_target_for(path: &Path) -> Result<OpenTarget, String> {
    let canonical = fs::canonicalize(path).map_err(|error| format!("路径无法打开：{error}"))?;
    if canonical.is_dir() {
        return Ok(OpenTarget {
            root: canonical.to_string_lossy().to_string(),
            file: None,
        });
    }
    if !canonical.is_file() {
        return Err("这个路径既不是文件也不是文件夹".to_string());
    }
    let parent = canonical
        .parent()
        .ok_or_else(|| "文件没有上级文件夹".to_string())?;
    let name = canonical
        .file_name()
        .ok_or_else(|| "文件名无效".to_string())?
        .to_string_lossy()
        .to_string();
    Ok(OpenTarget {
        root: parent.to_string_lossy().to_string(),
        file: Some(name),
    })
}

/// Resolves a path dropped onto the window (or opened from Finder) into a workspace.
#[tauri::command]
fn resolve_open_target(path: String) -> Result<OpenTarget, String> {
    open_target_for(Path::new(&path))
}

/// Paths that arrived before the window could listen, e.g. a cold launch from Finder.
struct PendingOpen(Mutex<Vec<String>>);

/// Hands over paths collected during startup and clears them.
#[tauri::command]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Vec<String> {
    let mut pending = state.0.lock().expect("pending open lock");
    std::mem::take(&mut *pending)
}

/// Deletes a file, or a directory and everything inside it.
#[tauri::command]
fn delete_entry(root: String, rel: String) -> Result<String, String> {
    let path = resolve(&root, &rel)?;
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
    } else {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    Ok(rel)
}

/// Copies a file, or a directory tree, to a new name in the same parent.
#[tauri::command]
fn copy_entry(root: String, rel: String, to: String) -> Result<String, String> {
    let source = resolve(&root, &rel)?;
    let target = resolve(&root, &to)?;
    if target.exists() {
        return Err("同名文件或文件夹已存在".to_string());
    }
    if source.is_dir() {
        copy_dir(&source, &target).map_err(|error| error.to_string())?;
    } else {
        fs::copy(&source, &target).map_err(|error| error.to_string())?;
    }
    Ok(to)
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Files and folders sitting on the system clipboard.
///
/// Only `public.file-url` items are read: that is the shape Finder's Copy puts
/// on the pasteboard, and the same shape the tree's 复制 command writes, so the
/// two directions see each other. Other platforms have no implementation yet;
/// the paste is refused instead of pasting something unexpected.
fn clipboard_file_paths() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let pasteboard = objc2_app_kit::NSPasteboard::generalPasteboard();
        Ok(read_file_urls(&pasteboard))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("当前平台暂不支持读取系统文件剪贴板".to_string())
    }
}

/// Reads the file URLs from one pasteboard (general, or a private one in tests).
#[cfg(target_os = "macos")]
fn read_file_urls(pasteboard: &objc2_app_kit::NSPasteboard) -> Vec<String> {
    use objc2_app_kit::NSPasteboardTypeFileURL;
    use objc2_foundation::{NSString, NSURL};

    let file_url_type = unsafe { NSPasteboardTypeFileURL };
    let mut paths = Vec::new();
    if let Some(items) = pasteboard.pasteboardItems() {
        for item in items.iter() {
            let Some(url_string) = item.stringForType(file_url_type) else {
                continue;
            };
            let Some(url) = NSURL::URLWithString(&NSString::from_str(&url_string.to_string())) else {
                continue;
            };
            let Some(path) = url.path() else {
                continue;
            };
            let path = path.to_string();
            if !path.is_empty() {
                paths.push(path);
            }
        }
    }
    paths
}

/// Puts file URLs on the system clipboard, the way Finder's Copy does, so the
/// files can be pasted in Finder, VS Code and anything else that accepts files.
fn set_clipboard_file_paths(paths: &[String]) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let pasteboard = objc2_app_kit::NSPasteboard::generalPasteboard();
        write_file_urls(&pasteboard, paths)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = paths;
        Err("当前平台暂不支持写入系统文件剪贴板".to_string())
    }
}

/// Writes file URLs to one pasteboard (general, or a private one in tests).
#[cfg(target_os = "macos")]
fn write_file_urls(
    pasteboard: &objc2_app_kit::NSPasteboard,
    paths: &[String],
) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSPasteboardItem, NSPasteboardTypeFileURL, NSPasteboardWriting,
    };
    use objc2_foundation::{NSArray, NSString, NSURL};

    if paths.is_empty() {
        return Err("没有可复制的文件".to_string());
    }
    let file_url_type = unsafe { NSPasteboardTypeFileURL };
    pasteboard.clearContents();
    let mut items: Vec<Retained<NSPasteboardItem>> = Vec::new();
    for path in paths {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let Some(absolute) = url.absoluteString() else {
            continue;
        };
        let item = NSPasteboardItem::new();
        if item.setString_forType(&absolute, file_url_type) {
            items.push(item);
        }
    }
    if items.is_empty() {
        return Err("没有可复制的文件".to_string());
    }
    let objects: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> =
        items.into_iter().map(ProtocolObject::from_retained).collect();
    if pasteboard.writeObjects(&NSArray::from_retained_slice(&objects)) {
        Ok(())
    } else {
        Err("写入系统剪贴板失败".to_string())
    }
}

/// Files currently on the clipboard, for the paste handler in the frontend.
#[tauri::command]
fn clipboard_files() -> Result<Vec<String>, String> {
    clipboard_file_paths()
}

/// Copies workspace files to the system clipboard (context menu → 复制).
#[tauri::command]
fn copy_files(paths: Vec<String>) -> Result<(), String> {
    set_clipboard_file_paths(&paths)
}

/// Copies files or folders picked up elsewhere into `rel_dir` of the workspace.
///
/// Nothing is ever overwritten: a name that already exists gets the same
/// "副本" suffix the Duplicate command uses, counting up as needed.
#[tauri::command]
fn paste_paths(
    root: String,
    rel_dir: String,
    paths: Vec<String>,
    copy_suffix: String,
) -> Result<Vec<String>, String> {
    let target_dir = resolve(&root, &rel_dir)?;
    if !target_dir.is_dir() {
        return Err("目标路径不是文件夹".to_string());
    }
    let suffix = copy_suffix.trim().replace(['/', '\\'], "-");
    let suffix = if suffix.is_empty() { "副本".to_string() } else { suffix };
    let mut created = Vec::new();
    for raw in paths {
        let source = fs::canonicalize(&raw).map_err(|error| format!("{raw}：{error}"))?;
        if !source.is_file() && !source.is_dir() {
            continue;
        }
        let name = source
            .file_name()
            .ok_or_else(|| format!("{} 没有文件名", source.display()))?
            .to_string_lossy()
            .to_string();
        let rel = unique_relative(&root, &rel_dir, &name, &suffix)?;
        let target = resolve(&root, &rel)?;
        // Pasting a folder into one of its own subfolders would recurse forever.
        if target.starts_with(&source) {
            return Err("不能把文件夹复制到它自己里面".to_string());
        }
        if source.is_dir() {
            copy_dir(&source, &target).map_err(|error| format!("{}：{error}", source.display()))?;
        } else {
            fs::copy(&source, &target).map_err(|error| format!("{}：{error}", source.display()))?;
        }
        created.push(rel);
    }
    if created.is_empty() {
        return Err("没有可粘贴的文件".to_string());
    }
    Ok(created)
}

/// Picks the first free name for `name` inside `dir`: the name itself, then
/// "note 副本.md", "note 副本 2.md", …
fn unique_relative(root: &str, dir: &str, name: &str, suffix: &str) -> Result<String, String> {
    for attempt in 0..1000 {
        let candidate = if attempt == 0 {
            name.to_string()
        } else {
            numbered_copy_name(name, suffix, attempt)
        };
        let rel = if dir.is_empty() { candidate } else { format!("{dir}/{candidate}") };
        if !resolve(root, &rel)?.exists() {
            return Ok(rel);
        }
    }
    Err("同名文件太多".to_string())
}

/// "note.md" → "note 副本.md" (attempt 1) → "note 副本 2.md" (attempt 2).
fn numbered_copy_name(name: &str, suffix: &str, attempt: usize) -> String {
    let (base, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name, ""),
    };
    if attempt == 1 {
        format!("{base} {suffix}{extension}")
    } else {
        format!("{base} {suffix} {attempt}{extension}")
    }
}

#[tauri::command]
fn rename_entry(root: String, rel: String, to: String) -> Result<String, String> {
    let source = resolve(&root, &rel)?;
    let target = resolve(&root, &to)?;
    if target.exists() {
        return Err("同名文件或文件夹已存在".to_string());
    }
    fs::rename(&source, &target).map_err(|error| error.to_string())?;
    Ok(to)
}

#[tauri::command]
fn write_file(
    root: String,
    rel: String,
    content: String,
    expected_hash: Option<String>,
) -> Result<WriteResult, String> {
    let path = resolve(&root, &rel)?;

    let current = fs::read(&path).ok();
    let current_hash = current.as_ref().map(|bytes| fingerprint(bytes));

    if let (Some(expected), Some(actual)) = (&expected_hash, &current_hash) {
        if expected != actual {
            return Ok(WriteResult { hash: actual.clone(), conflict: true });
        }
    }

    // Write to a sibling file and rename, so a crash cannot truncate the note.
    let temp = path.with_extension(format!(
        "{}.tmp{}",
        path.extension().and_then(|ext| ext.to_str()).unwrap_or("md"),
        std::process::id()
    ));
    fs::write(&temp, content.as_bytes()).map_err(|error| error.to_string())?;
    fs::rename(&temp, &path).map_err(|error| error.to_string())?;

    Ok(WriteResult { hash: fingerprint(content.as_bytes()), conflict: false })
}

/// One command item; `accel` is a Tauri accelerator string such as `CmdOrCtrl+S`.
fn action(
    app: &AppHandle<Wry>,
    id: &str,
    label: &str,
    accel: Option<&str>,
) -> tauri::Result<MenuItem<Wry>> {
    let mut builder = MenuItemBuilder::with_id(id, label);
    if let Some(accel) = accel {
        builder = builder.accelerator(accel);
    }
    builder.build(app)
}

/// Typora-style menu bar. Formatting lives here so people who do not know
/// Markdown can still write it; every item sends an id to the frontend, which
/// owns the editor and therefore the actual insertion./// Menu labels follow the interface language, which the settings dialog sets.
fn l<'a>(lang: &str, zh: &'a str, en: &'a str) -> &'a str {
    if lang == "en" {
        en
    } else {
        zh
    }
}

/// Typora-style menu bar. Formatting lives here so people who do not know
/// Markdown can still write it; every item sends an id to the frontend, which
/// owns the editor and therefore the actual insertion.
fn build_menu(app: &AppHandle<Wry>, lang: &str) -> tauri::Result<Menu<Wry>> {
    let app_menu = Submenu::with_items(
        app,
        "InkLet",
        true,
        &[
            &PredefinedMenuItem::about(app, Some(l(lang, "关于 InkLet", "About InkLet")), None)?,
            &PredefinedMenuItem::separator(app)?,
            &action(app, "app:settings", l(lang, "设置…", "Settings…"), Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(l(lang, "退出 InkLet", "Quit InkLet")))?,
        ],
    )?;

    let file = Submenu::with_items(
        app,
        l(lang, "文件", "File"),
        true,
        &[
            &action(
                app,
                "file:open-folder",
                l(lang, "选择文件夹…", "Choose Folder…"),
                Some("CmdOrCtrl+O"),
            )?,
            &action(app, "file:new-entry", l(lang, "新建文件 / 文件夹…", "New File / Folder…"), Some("CmdOrCtrl+Shift+N"))?,
            &action(app, "file:guide", l(lang, "使用指南", "Guide"), Some("CmdOrCtrl+Shift+H"))?,
            &PredefinedMenuItem::separator(app)?,
            &action(app, "file:save", l(lang, "保存", "Save"), Some("CmdOrCtrl+S"))?,
            &action(
                app,
                "file:export-pdf",
                l(lang, "导出 PDF…", "Export PDF…"),
                Some("CmdOrCtrl+Shift+E"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &action(
                app,
                "file:close-tab",
                l(lang, "关闭标签页", "Close Tab"),
                Some("CmdOrCtrl+W"),
            )?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        l(lang, "编辑", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(l(lang, "撤销", "Undo")))?,
            &PredefinedMenuItem::redo(app, Some(l(lang, "重做", "Redo")))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(l(lang, "剪切", "Cut")))?,
            &PredefinedMenuItem::copy(app, Some(l(lang, "拷贝", "Copy")))?,
            &PredefinedMenuItem::paste(app, Some(l(lang, "粘贴", "Paste")))?,
            &PredefinedMenuItem::select_all(app, Some(l(lang, "全选", "Select All")))?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        l(lang, "窗口", "Window"),
        true,
        &[&action(app, "window:new", l(lang, "新窗口", "New Window"), Some("CmdOrCtrl+N"))?],
    )?;

    let view = Submenu::with_items(
        app,
        l(lang, "视图", "View"),
        true,
        &[
            &action(app, "view:live", l(lang, "实时渲染", "Live Preview"), Some("CmdOrCtrl+1"))?,
            &action(app, "view:split", l(lang, "左右对照", "Split View"), Some("CmdOrCtrl+2"))?,
            &PredefinedMenuItem::separator(app)?,
            &action(
                app,
                "view:theme",
                l(lang, "切换浅色 / 深色", "Toggle Light / Dark"),
                Some("CmdOrCtrl+Shift+L"),
            )?,
        ],
    )?;

    let paragraph = Submenu::with_items(
        app,
        l(lang, "段落", "Paragraph"),
        true,
        &[
            &action(app, "para:h1", l(lang, "标题 1", "Heading 1"), None)?,
            &action(app, "para:h2", l(lang, "标题 2", "Heading 2"), None)?,
            &action(app, "para:h3", l(lang, "标题 3", "Heading 3"), None)?,
            &action(app, "para:h4", l(lang, "标题 4", "Heading 4"), None)?,
            &action(app, "para:h5", l(lang, "标题 5", "Heading 5"), None)?,
            &action(app, "para:h6", l(lang, "标题 6", "Heading 6"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &action(app, "para:ul", l(lang, "无序列表", "Bullet List"), None)?,
            &action(app, "para:ol", l(lang, "有序列表", "Numbered List"), None)?,
            &action(app, "para:task", l(lang, "任务列表", "Task List"), None)?,
            &action(app, "para:quote", l(lang, "注释", "Comment"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &action(
                app,
                "para:code",
                l(lang, "代码块…", "Code Block…"),
                Some("CmdOrCtrl+Alt+C"),
            )?,
            &action(app, "para:table", l(lang, "表格…", "Table…"), None)?,
            &action(app, "para:hr", l(lang, "分隔线", "Divider"), None)?,
        ],
    )?;

    let format = Submenu::with_items(
        app,
        l(lang, "格式", "Format"),
        true,
        &[
            &action(app, "format:bold", l(lang, "加粗", "Bold"), Some("CmdOrCtrl+B"))?,
            &action(app, "format:italic", l(lang, "斜体", "Italic"), Some("CmdOrCtrl+I"))?,
            &action(app, "format:underline", l(lang, "下划线", "Underline"), Some("CmdOrCtrl+U"))?,
            &action(app, "format:strike", l(lang, "删除线", "Strikethrough"), None)?,
            &action(app, "format:code", l(lang, "行内代码", "Inline Code"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &action(
                app,
                "format:bigger",
                l(lang, "增大正文字号", "Bigger Text"),
                Some("CmdOrCtrl+="),
            )?,
            &action(
                app,
                "format:smaller",
                l(lang, "减小正文字号", "Smaller Text"),
                Some("CmdOrCtrl+-"),
            )?,
        ],
    )?;

    // A theme is a palette, so the menu is a plain list of names — the same four
    // the settings dialog offers.
    let theme = Submenu::with_items(
        app,
        l(lang, "主题", "Theme"),
        true,
        &[
            &action(app, "theme:light", l(lang, "浅色", "Light"), None)?,
            &action(app, "theme:sepia", l(lang, "暖纸", "Sepia"), None)?,
            &action(app, "theme:slate", l(lang, "蓝灰", "Slate"), None)?,
            &action(app, "theme:dark", l(lang, "深色", "Dark"), None)?,
        ],
    )?;

    Menu::with_items(
        app,
        &[&app_menu, &file, &edit, &window, &view, &paragraph, &format, &theme],
    )
}

/// Interface language for the native menu, set from the settings dialog.
struct UiLanguage(Mutex<String>);

/// Rebuilds the menu in the requested language.
#[tauri::command]
fn set_language(app: AppHandle, language: String) -> Result<(), String> {
    let lang = if language == "en" { "en" } else { "zh" };
    if let Some(state) = app.try_state::<UiLanguage>() {
        if let Ok(mut current) = state.0.lock() {
            *current = lang.to_string();
        }
    }
    let menu = build_menu(&app, lang).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}

/// Tracks which windows have unsaved edits, so a close prompt appears for the
/// right one and quitting asks while *any* window is dirty.
struct CloseGuard {
    dirty: Mutex<std::collections::HashMap<String, bool>>,
    allow: AtomicBool,
}

impl CloseGuard {
    fn new() -> Self {
        CloseGuard {
            dirty: Mutex::new(std::collections::HashMap::new()),
            allow: AtomicBool::new(false),
        }
    }

    fn set_dirty(&self, label: &str, dirty: bool) {
        if let Ok(mut map) = self.dirty.lock() {
            map.insert(label.to_string(), dirty);
        }
    }

    fn any_dirty(&self) -> bool {
        self.dirty
            .lock()
            .map(|map| map.values().any(|dirty| *dirty))
            .unwrap_or(false)
    }

    /// True when closing this window would lose edits and nobody answered yet.
    fn blocks_window(&self, label: &str) -> bool {
        if self.allow.load(Ordering::Relaxed) {
            return false;
        }
        self.dirty
            .lock()
            .map(|map| *map.get(label).unwrap_or(&false))
            .unwrap_or(false)
    }

    fn blocks_exit(&self) -> bool {
        !self.allow.load(Ordering::Relaxed) && self.any_dirty()
    }

    fn allow_exit(&self) {
        self.allow.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
fn set_unsaved(window: tauri::Window, dirty: bool, guard: tauri::State<'_, CloseGuard>) {
    guard.set_dirty(window.label(), dirty);
}

#[tauri::command]
fn close_window(window: tauri::Window, guard: tauri::State<'_, CloseGuard>) -> Result<(), String> {
    guard.allow_exit();
    window.close().map_err(|error| error.to_string())
}

/// Quits even if the document is dirty — only called after the user answered
/// the prompt, so the guard has to be released explicitly.
#[tauri::command]
fn quit_app(app: AppHandle, guard: tauri::State<'_, CloseGuard>) {
    guard.allow_exit();
    app.exit(0);
}

/// Opens another window with its own empty workspace. Each window is a separate
/// page, so tabs, folder and undo history do not leak between them.
#[tauri::command]
fn new_window(app: AppHandle) -> Result<(), String> {
    static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let index = COUNTER.fetch_add(1, Ordering::Relaxed) + 1;
    tauri::WebviewWindowBuilder::new(&app, format!("inklet-{index}"), tauri::WebviewUrl::App("index.html".into()))
        .title("InkLet")
        .inner_size(1240.0, 840.0)
        .min_inner_size(760.0, 480.0)
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// A browser that can print HTML to PDF. Chrome and Edge share the same CLI.
fn find_browser() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("INKLET_CHROME") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    const CANDIDATES: &[&str] = &[
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
    ];
    CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|candidate| candidate.exists())
}

/// Renders the HTML the frontend already produced into a PDF at `path`.
///
/// The webview cannot print on macOS, so a headless Chrome/Edge does the layout.
/// The HTML is self-contained (maths is inline SVG, images are data URIs), so no
/// server or extra file is needed.
/// Opens an http(s)/mailto link in the user's browser.
///
/// Only those schemes are allowed: a link inside a document must not be able to
/// run a local program, or hand the system an arbitrary `file:` path.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let target = url.trim();
    let lower = target.to_ascii_lowercase();
    if !(lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:"))
    {
        return Err("只允许 http、https 与 mailto 链接".to_string());
    }
    match shell_open(target) {
        Ok(true) => Ok(()),
        Ok(false) => Err("系统未能打开这个链接".to_string()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(target_os = "macos")]
fn shell_open(target: &str) -> std::io::Result<bool> {
    Ok(Command::new("open").arg(target).status()?.success())
}

#[cfg(target_os = "windows")]
fn shell_open(target: &str) -> std::io::Result<bool> {
    Ok(Command::new("cmd").args(["/C", "start", "", target]).status()?.success())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn shell_open(target: &str) -> std::io::Result<bool> {
    Ok(Command::new("xdg-open").arg(target).status()?.success())
}

#[tauri::command]
fn export_pdf(html: String, path: String) -> Result<String, String> {
    let browser = find_browser().ok_or_else(|| {
        "导出 PDF 需要本机安装 Chrome 或 Edge（可用环境变量 INKLET_CHROME 指定路径）".to_string()
    })?;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let temp = std::env::temp_dir().join(format!("inklet-{}-{stamp}.html", std::process::id()));
    fs::write(&temp, html.as_bytes()).map_err(|error| format!("写入临时文件失败：{error}"))?;

    // An explicit profile keeps Chrome out of the user's own one, and is required
    // when the default data directory is not writable.
    let profile = std::env::temp_dir().join(format!("inklet-profile-{}-{stamp}", std::process::id()));
    fs::create_dir_all(&profile).map_err(|error| format!("无法创建临时目录：{error}"))?;

    let source = format!("file://{}", temp.to_string_lossy());
    let output = Command::new(&browser)
        .args([
            "--headless=new",
            "--disable-gpu",
            // Chrome's own sandbox cannot always initialise (it is denied in
            // sandboxed dev shells and some managed Macs); the subprocess only
            // renders HTML this app generated.
            "--no-sandbox",
            "--no-first-run",
            "--no-default-browser-check",
            "--no-pdf-header-footer",
            "--virtual-time-budget=8000",
        ])
        .arg(format!("--user-data-dir={}", profile.to_string_lossy()))
        .arg(format!("--print-to-pdf={path}"))
        .arg(&source)
        .output()
        .map_err(|error| format!("无法启动浏览器：{error}"))?;
    let _ = fs::remove_file(&temp);
    let _ = fs::remove_dir_all(&profile);

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let meta = fs::metadata(&path).map_err(|error| format!("PDF 未生成：{error}"))?;
    if meta.len() == 0 {
        return Err("浏览器生成了空文件".to_string());
    }
    Ok(path)
}

/// Gives the running app the icon from `icons/icon.png`.
///
/// macOS reads a Dock icon from the `.app` bundle's Info.plist, and `tauri dev`
/// runs a bare binary with no bundle — so during development the Dock shows the
/// generic executable icon. Setting it at runtime from the very file the bundle
/// ships makes dev look like the packaged app.
#[cfg(target_os = "macos")]
fn apply_dock_icon() {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    const ICON: &[u8] = include_bytes!("../icons/icon.png");
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let data = NSData::with_bytes(ICON);
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
        return;
    };
    unsafe {
        NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image));
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_dock_icon() {}

fn main() {
    let app = tauri::Builder::default()
        // Without a menu macOS has no Quit item and no Edit shortcuts, so Cmd+Q
        // and Cmd+C/V would silently do nothing in the WebView.
        .menu(|handle| build_menu(handle, "zh"))
        .on_menu_event(|app, event| {
            // With several windows only the focused one may react.
            let id = event.id().as_ref().to_string();
            let focused = app
                .webview_windows()
                .into_iter()
                .map(|(_, window)| window)
                .find(|window| window.is_focused().unwrap_or(false));
            match focused {
                Some(window) => {
                    let _ = window.emit("menu", id);
                }
                None => {
                    let _ = app.emit("menu", id);
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            apply_dock_icon();
            Ok(())
        })
        .manage(CloseGuard::new())
        .manage(UiLanguage(Mutex::new("zh".to_string())))
        .manage(PendingOpen(Mutex::new(Vec::new())))
        .manage(terminal::Terminals::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<CloseGuard>().blocks_window(window.label()) {
                    api.prevent_close();
                    let _ = window.emit("request-close", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_files,
            read_file,
            write_file,
            create_entry,
            delete_entry,
            copy_entry,
            clipboard_files,
            copy_files,
            paste_paths,
            rename_entry,
            read_image,
            set_unsaved,
            close_window,
            quit_app,
            new_window,
            set_language,
            export_pdf,
            resolve_open_target,
            take_pending_open,
            open_external,
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close
        ])
        .build(tauri::generate_context!())
        .expect("failed to build InkLet");

    // Cmd+Q and the app menu quit the process without a `CloseRequested`, so the
    // same guard has to run on the exit path too.
    app.run(|handle, event| {
        // macOS delivers "open this file with InkLet" as an Apple Event, both on
        // a cold launch and while running. The path is stashed as well as emitted:
        // on a cold launch the webview is not listening yet.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().to_string())
                .collect();
            if !paths.is_empty() {
                if let Some(state) = handle.try_state::<PendingOpen>() {
                    if let Ok(mut pending) = state.0.lock() {
                        pending.extend(paths.iter().cloned());
                    }
                }
                let focused = handle
                    .webview_windows()
                    .into_iter()
                    .map(|(_, window)| window)
                    .find(|window| window.is_focused().unwrap_or(false));
                match focused {
                    Some(window) => {
                        let _ = window.emit("open-path", paths);
                    }
                    None => {
                        let _ = handle.emit("open-path", paths);
                    }
                }
            }
        }
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if handle.state::<CloseGuard>().blocks_exit() {
                api.prevent_exit();
                let _ = handle.emit("request-close", ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static SANDBOX_COUNTER: AtomicUsize = AtomicUsize::new(0);

    struct Sandbox(PathBuf);

    impl Sandbox {
        fn new() -> Self {
            // `create_dir` (not `create_dir_all`) fails when the name is taken,
            // and retrying with a new counter makes the name unique. A timestamp
            // alone was not enough: cargo runs tests in parallel threads, macOS
            // clock resolution is coarse, two sandboxes collided, and one test's
            // cleanup deleted the directory another test was still using.
            loop {
                let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
                let id = SANDBOX_COUNTER.fetch_add(1, Ordering::Relaxed);
                let path = std::env::temp_dir().join(format!(
                    "inklet-test-{}-{stamp}-{id}",
                    std::process::id()
                ));
                if fs::create_dir(&path).is_ok() {
                    return Sandbox(path);
                }
            }
        }

        fn root(&self) -> String {
            self.0.to_string_lossy().to_string()
        }

        fn write(&self, rel: &str, content: &str) {
            let path = self.0.join(rel);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, content).unwrap();
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_folder_becomes_the_workspace() {
        let sandbox = Sandbox::new();
        let target = open_target_for(&sandbox.0).unwrap();
        assert_eq!(target.root, fs::canonicalize(&sandbox.0).unwrap().to_string_lossy());
        assert_eq!(target.file, None);
    }

    #[test]
    fn a_file_opens_its_own_folder() {
        let sandbox = Sandbox::new();
        sandbox.write("notes.md", "# hi");
        let target = open_target_for(&sandbox.0.join("notes.md")).unwrap();
        assert_eq!(target.root, fs::canonicalize(&sandbox.0).unwrap().to_string_lossy());
        assert_eq!(target.file.as_deref(), Some("notes.md"));
    }

    #[test]
    fn a_missing_path_is_an_error_not_a_panic() {
        let sandbox = Sandbox::new();
        let error = open_target_for(&sandbox.0.join("nope.md")).unwrap_err();
        assert!(error.contains("路径无法打开"), "{error}");
    }

    #[test]
    fn creates_a_file_next_to_an_existing_one() {
        let sandbox = Sandbox::new();
        sandbox.write("notes.txt", "x");
        assert_eq!(
            create_entry(sandbox.root(), "新建.md".to_string(), "file".to_string()).unwrap(),
            "新建.md"
        );
        assert!(sandbox.0.join("新建.md").is_file());
    }

    #[test]
    fn rejects_a_file_used_as_a_parent() {
        let sandbox = Sandbox::new();
        sandbox.write("notes.txt", "x");
        let error = create_entry(
            sandbox.root(),
            "notes.txt/新建.md".to_string(),
            "file".to_string(),
        )
        .unwrap_err();
        assert_eq!(error, "上级路径不是文件夹");
    }

    #[test]
    fn close_guard_tracks_each_window() {
        let guard = CloseGuard::new();
        assert!(!guard.blocks_window("main"), "a clean window closes silently");

        guard.set_dirty("main", true);
        assert!(guard.blocks_window("main"), "a dirty window asks first");
        assert!(
            !guard.blocks_window("inklet-1"),
            "another window's edits must not block this one"
        );

        guard.set_dirty("main", false);
        assert!(!guard.blocks_exit(), "no dirty window: quitting is silent");

        guard.set_dirty("inklet-2", true);
        assert!(guard.blocks_exit(), "any dirty window blocks quitting");

        guard.allow_exit();
        assert!(!guard.blocks_exit(), "after the answer, quitting proceeds");
        assert!(!guard.blocks_window("inklet-2"));
    }

    #[test]
    fn exports_a_real_pdf() {
        // Skipped where no Chromium-family browser exists; on a normal machine
        // this exercises the whole path: HTML file, headless print, PDF on disk.
        if find_browser().is_none() {
            eprintln!("skipping export test: no Chrome/Edge found");
            return;
        }
        let sandbox = Sandbox::new();
        let target = sandbox.0.join("out.pdf");
        let html = "<html><body><h1>Hello</h1><p>中文测试</p></body></html>".to_string();
        let written = export_pdf(html, target.to_string_lossy().to_string()).expect("pdf export");
        assert_eq!(written, target.to_string_lossy());
        let bytes = fs::read(&target).expect("read pdf");
        assert!(bytes.starts_with(b"%PDF"), "output is not a PDF");
        assert!(bytes.len() > 500, "PDF suspiciously small: {}", bytes.len());
    }

    #[test]
    fn rejects_parent_traversal() {
        let sandbox = Sandbox::new();
        sandbox.write("note.md", "x");
        assert!(resolve(&sandbox.root(), "../outside.md").is_err());
        assert!(resolve(&sandbox.root(), "sub/../../outside.md").is_err());
    }

    #[test]
    fn resolves_files_and_new_paths_inside_the_root() {
        let sandbox = Sandbox::new();
        sandbox.write("sub/note.md", "x");
        assert!(resolve(&sandbox.root(), "sub/note.md").is_ok());
        // A path that does not exist yet is still accepted when it stays inside.
        assert!(resolve(&sandbox.root(), "sub/new.md").is_ok());
    }

    #[test]
    fn fingerprint_changes_with_content() {
        assert_eq!(fingerprint(b"abc"), fingerprint(b"abc"));
        assert_ne!(fingerprint(b"abc"), fingerprint(b"abd"));
    }

    #[test]
    fn write_then_read_round_trips() {
        let sandbox = Sandbox::new();
        let result = write_file(sandbox.root(), "a.md".into(), "hello".into(), None).unwrap();
        assert!(!result.conflict);
        let snapshot = read_file(sandbox.root(), "a.md".into()).unwrap();
        assert_eq!(snapshot.content, "hello");
        assert_eq!(snapshot.hash, result.hash);
    }

    #[test]
    fn write_leaves_no_temporary_files() {
        let sandbox = Sandbox::new();
        write_file(sandbox.root(), "a.md".into(), "one".into(), None).unwrap();
        write_file(sandbox.root(), "a.md".into(), "two".into(), None).unwrap();
        // The property that matters is "no temporary file survived", not the
        // exact directory listing: `read_dir` order is unspecified, and an
        // equality assertion on it made this test flaky.
        let leftovers: Vec<String> = fs::read_dir(&sandbox.0)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .filter(|name| name.contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temporary files left behind: {leftovers:?}");
        assert_eq!(fs::read_to_string(sandbox.0.join("a.md")).unwrap(), "two");
    }

    #[test]
    fn detects_a_concurrent_change() {
        let sandbox = Sandbox::new();
        let first = write_file(sandbox.root(), "a.md".into(), "one".into(), None).unwrap();
        // Someone else edits the file behind our back.
        sandbox.write("a.md", "changed externally");

        let conflict =
            write_file(sandbox.root(), "a.md".into(), "mine".into(), Some(first.hash)).unwrap();
        assert!(conflict.conflict);
        assert_eq!(fs::read_to_string(sandbox.0.join("a.md")).unwrap(), "changed externally");

        // An explicit overwrite (no expected hash) is allowed.
        let forced = write_file(sandbox.root(), "a.md".into(), "mine".into(), None).unwrap();
        assert!(!forced.conflict);
        assert_eq!(fs::read_to_string(sandbox.0.join("a.md")).unwrap(), "mine");
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0, 255, 16]), "AP8Q");
    }

    #[test]
    fn reads_images_as_data_uris_and_rejects_other_files() {
        let sandbox = Sandbox::new();
        // The command keys the mime off the extension, so the payload is not
        // decoded here; a real PNG header makes the fixture realistic.
        let png: &[u8] = b"\x89PNG\r\n\x1a\nfake-image-payload";
        fs::write(sandbox.0.join("dot.png"), png).unwrap();

        let uri = read_image(sandbox.root(), "dot.png".into()).unwrap();
        assert!(uri.starts_with("data:image/png;base64,"), "got {}", &uri[..20]);

        sandbox.write("note.txt", "not an image");
        assert!(read_image(sandbox.root(), "note.txt".into()).is_err());
        assert!(read_image(sandbox.root(), "../escape.png".into()).is_err());
    }

    #[test]
    fn lists_every_file_but_skips_noise_directories() {
        let sandbox = Sandbox::new();
        sandbox.write("note.md", "# a");
        sandbox.write("papers/b.md", "# b");
        sandbox.write("image.png", "binary");
        sandbox.write("node_modules/pkg/readme.md", "# no");
        sandbox.write(".hidden/x.md", "# no");

        let entries = list_files(sandbox.root()).unwrap();
        let paths: Vec<&str> = entries.iter().map(|entry| entry.path.as_str()).collect();
        assert!(paths.contains(&"note.md"));
        assert!(paths.contains(&"papers/b.md"));
        // Non-Markdown files belong in the tree too (the UI marks them unopenable).
        assert!(paths.contains(&"image.png"), "got {paths:?}");
        assert!(!paths.iter().any(|path| path.contains("node_modules")));
        assert!(!paths.iter().any(|path| path.contains(".hidden")));
    }

    #[test]
    fn pastes_files_into_the_workspace_and_never_overwrites() {
        let sandbox = Sandbox::new();
        // The clipboard holds a path from outside the folder being pasted into.
        sandbox.write("clipboard/outside.md", "from the clipboard");
        let source = sandbox.0.join("clipboard/outside.md");

        let first = paste_paths(
            sandbox.root(),
            String::new(),
            vec![source.to_string_lossy().to_string()],
            "副本".to_string(),
        )
        .unwrap();
        assert_eq!(first, vec!["outside.md".to_string()]);
        assert_eq!(fs::read_to_string(sandbox.0.join("outside.md")).unwrap(), "from the clipboard");

        let second = paste_paths(
            sandbox.root(),
            String::new(),
            vec![source.to_string_lossy().to_string()],
            "副本".to_string(),
        )
        .unwrap();
        assert_eq!(second, vec!["outside 副本.md".to_string()]);
        assert!(sandbox.0.join("outside 副本.md").is_file());
    }

    #[test]
    fn pastes_a_folder_recursively_into_the_selected_folder() {
        let sandbox = Sandbox::new();
        sandbox.write("papers/existing.md", "# keep");
        let source = sandbox.0.join("incoming");
        fs::create_dir_all(source.join("chapter")).unwrap();
        fs::write(source.join("draft.md"), "# draft").unwrap();
        fs::write(source.join("chapter/one.md"), "# one").unwrap();

        let created = paste_paths(
            sandbox.root(),
            "papers".to_string(),
            vec![source.to_string_lossy().to_string()],
            "副本".to_string(),
        )
        .unwrap();
        assert_eq!(created, vec!["papers/incoming".to_string()]);
        assert_eq!(
            fs::read_to_string(sandbox.0.join("papers/incoming/chapter/one.md")).unwrap(),
            "# one"
        );
        // A later paste of the same folder lands beside it instead of merging.
        let again = paste_paths(
            sandbox.root(),
            "papers".to_string(),
            vec![source.to_string_lossy().to_string()],
            "副本".to_string(),
        )
        .unwrap();
        assert_eq!(again, vec!["papers/incoming 副本".to_string()]);
        assert!(sandbox.0.join("papers/incoming 副本").is_dir());
    }

    #[test]
    fn refuses_to_paste_a_folder_into_itself() {
        let sandbox = Sandbox::new();
        sandbox.write("papers/a.md", "# a");
        let error = paste_paths(
            sandbox.root(),
            "papers".to_string(),
            vec![sandbox.0.to_string_lossy().to_string()],
            "副本".to_string(),
        )
        .unwrap_err();
        assert!(error.contains("自己"), "{error}");
    }

    #[test]
    fn only_http_mailto_links_are_followed() {
        assert!(open_external("javascript:alert(1)".to_string()).is_err());
        assert!(open_external("file:///etc/passwd".to_string()).is_err());
        assert!(open_external("   ".to_string()).is_err());
    }

    #[test]
    fn copy_names_count_up_and_keep_the_extension() {
        assert_eq!(numbered_copy_name("note.md", "副本", 1), "note 副本.md");
        assert_eq!(numbered_copy_name("note.md", "副本", 2), "note 副本 2.md");
        assert_eq!(numbered_copy_name("papers", "副本", 1), "papers 副本");
        assert_eq!(numbered_copy_name(".env", "副本", 1), ".env 副本");
    }

    /// Uses a private pasteboard, never the general one: the test must not
    /// overwrite whatever the person running it has on their clipboard.
    #[cfg(target_os = "macos")]
    #[test]
    fn file_urls_round_trip_on_a_private_pasteboard() {
        use objc2_app_kit::NSPasteboard;
        use objc2_foundation::NSString;

        let pasteboard = NSPasteboard::pasteboardWithName(&NSString::from_str("inklet-test"));
        let paths = vec![
            "/tmp/inklet 剪贴板 test.md".to_string(),
            "/tmp/folder with spaces".to_string(),
        ];
        write_file_urls(&pasteboard, &paths).unwrap();
        assert_eq!(read_file_urls(&pasteboard), paths);
        pasteboard.clearContents();
    }
}
