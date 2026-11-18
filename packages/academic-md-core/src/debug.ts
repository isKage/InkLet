import type { Tree } from '@lezer/common';

/**
 * Human-readable tree dump for tests, debugging and the playground's AST panel.
 * Keeping it in core means test snapshots and the UI read the same format.
 */
export function dumpTree(src: string, tree: Tree): string {
  const lines: string[] = [];
  let depth = 0;
  tree.iterate({
    enter(node) {
      const raw = src.slice(node.from, node.to).replace(/\n/g, '⏎');
      const text = raw.length > 48 ? `${raw.slice(0, 48)}…` : raw;
      lines.push(
        `${'  '.repeat(depth)}${node.name} [${node.from}-${node.to}) ${JSON.stringify(text)}`
      );
      depth += 1;
    },
    leave() {
      depth -= 1;
    },
  });
  return lines.join('\n');
}
