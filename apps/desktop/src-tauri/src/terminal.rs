//! The built-in terminal.
//!
//! A real PTY running the user's login shell, so prompts, colours and line
//! editing behave like a normal terminal. The webview owns the screen (xterm.js
//! in `src/terminal.ts`); this side only moves bytes and keeps the process
//! alive. Each session is identified by a small integer the frontend keeps.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// PTY sessions, keyed by the id handed to the frontend.
#[derive(Default)]
pub struct Terminals {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Serialize, Clone)]
struct TerminalOutput {
    id: u32,
    data: String,
}

#[derive(Serialize, Clone)]
struct TerminalExit {
    id: u32,
}

fn size_of(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(5, 200),
        cols: cols.clamp(20, 400),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn resolve_cwd(cwd: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(cwd);
    let path = std::fs::canonicalize(&path).map_err(|error| format!("目录无法打开：{error}"))?;
    if !path.is_dir() {
        return Err("目标不是文件夹".to_string());
    }
    Ok(path)
}

fn shell_command() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }
}

/// Starts a shell in `cwd` and streams its output as `terminal:data` events.
#[tauri::command]
pub fn terminal_open(
    app: AppHandle,
    terminals: tauri::State<'_, Terminals>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let cwd = resolve_cwd(&cwd)?;
    let pair = native_pty_system()
        .openpty(size_of(cols, rows))
        .map_err(|error| error.to_string())?;

    let mut command = CommandBuilder::new(shell_command());
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "InkLet");

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("终端启动失败：{error}"))?;
    // The child holds the slave side now; keeping ours would stop EOF from arriving.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair.master.take_writer().map_err(|error| error.to_string())?;
    let killer = child.clone_killer();

    let id = terminals.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    {
        let mut sessions = terminals
            .sessions
            .lock()
            .map_err(|_| "终端状态不可用".to_string())?;
        sessions.insert(
            id,
            Session {
                master: pair.master,
                writer,
                killer,
            },
        );
    }

    // Output pump. Reading until EOF is also how a shell that exits on its own
    // (typing `exit`, or a crash) is noticed.
    let output_app = app.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    let data = String::from_utf8_lossy(&buffer[..count]).to_string();
                    let _ = output_app.emit("terminal:data", TerminalOutput { id, data });
                }
            }
        }
        let _ = output_app.emit("terminal:exit", TerminalExit { id });
        if let Some(state) = output_app.try_state::<Terminals>() {
            if let Ok(mut sessions) = state.sessions.lock() {
                sessions.remove(&id);
            }
        }
    });

    // Reaps the process so a closed session does not leave a zombie behind.
    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(id)
}

#[tauri::command]
pub fn terminal_write(
    terminals: tauri::State<'_, Terminals>,
    id: u32,
    data: String,
) -> Result<(), String> {
    let mut sessions = terminals
        .sessions
        .lock()
        .map_err(|_| "终端状态不可用".to_string())?;
    let session = sessions.get_mut(&id).ok_or_else(|| "终端已关闭".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    session.writer.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_resize(
    terminals: tauri::State<'_, Terminals>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = terminals
        .sessions
        .lock()
        .map_err(|_| "终端状态不可用".to_string())?;
    if let Some(session) = sessions.get(&id) {
        session.master.resize(size_of(cols, rows)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Ends a session. Dropping the master closes the PTY, so the shell and anything
/// it started receive a hangup even if the kill signal only reaches the shell.
#[tauri::command]
pub fn terminal_close(
    terminals: tauri::State<'_, Terminals>,
    id: u32,
) -> Result<(), String> {
    let mut sessions = terminals
        .sessions
        .lock()
        .map_err(|_| "终端状态不可用".to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.killer.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_the_window_size_to_something_a_shell_can_use() {
        let tiny = size_of(1, 1);
        assert_eq!((tiny.cols, tiny.rows), (20, 5));
        let huge = size_of(4000, 4000);
        assert_eq!((huge.cols, huge.rows), (400, 200));
        let normal = size_of(100, 30);
        assert_eq!((normal.cols, normal.rows), (100, 30));
    }

    /// The same calls `terminal_open` makes, without Tauri: a real PTY, a real
    /// child, output arriving through the master side.
    #[cfg(unix)]
    #[test]
    fn a_real_shell_runs_in_the_pty() {
        // Sandboxed runs (some CI, the coding agent's shell) may forbid pty
        // allocation; that is an environment limit, not a broken terminal.
        let Ok(pair) = native_pty_system().openpty(size_of(80, 24)) else {
            eprintln!("skipping pty test: openpty is not permitted here");
            return;
        };
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg("printf inklet-pty-ok");
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut output = String::new();
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => output.push_str(&String::from_utf8_lossy(&buffer[..count])),
            }
        }
        assert!(child.wait().unwrap().success());
        assert!(output.contains("inklet-pty-ok"), "got {output:?}");
    }

    #[test]
    fn rejects_a_cwd_that_is_not_a_folder() {
        let dir = std::env::temp_dir();
        assert!(resolve_cwd(&dir.to_string_lossy()).is_ok());
        let missing = dir.join("inklet-terminal-nope");
        assert!(resolve_cwd(&missing.to_string_lossy()).is_err());
    }
}
