import { defineConfig } from 'vite';

// Separate IIFE build so the smoke script can execute the *bundled* browser path
// under jsdom (an ES-module app entry cannot be evaluated there).
export default defineConfig({
  build: {
    lib: {
      entry: 'smoke/entry.ts',
      formats: ['iife'],
      name: 'InkletSmoke',
      fileName: () => 'smoke.js',
    },
    outDir: 'dist-smoke',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
  },
});
