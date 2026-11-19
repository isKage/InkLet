# 第三方组件与许可

InkLet 打包了以下第三方代码。这里列出**直接运行时依赖**；完整的依赖树（含 400 余个 Rust crate）
尚未生成 SBOM，可用 `cargo tree` 在 `apps/desktop/src-tauri` 下复现。

## JavaScript / TypeScript

| 组件 | 版本 | 许可 |
|---|---|---|
| MathJax | 4.1.3 | Apache-2.0 |
| @mathjax/mathjax-newcm-font | 4.1.3 | Apache-2.0（字体为 CC-BY-4.0 / OFL 组合，见上游） |
| @lezer/markdown | 1.8.1 | MIT |
| @lezer/common | 1.x | MIT |
| @xterm/xterm | 6.0.0 | MIT |
| @xterm/addon-fit | 0.11.0 | MIT |
| yaml | 2.x | ISC |

## Rust

| 组件 | 版本 | 许可 |
|---|---|---|
| tauri / tauri-build / wry / tao | 2.x | MIT 或 Apache-2.0 |
| portable-pty | 0.9 | MIT |

## 待办

- 发行前用 `cargo about`（或 `cargo deny`）生成完整的 Rust 依赖许可清单。
- 若将来引入 CodeMirror 等功能包，需在此处补齐。

完整的许可正文见各依赖包内的 `LICENSE` 文件，或上游仓库。
