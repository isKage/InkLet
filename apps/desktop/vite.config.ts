import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same build works from tauri://localhost.
  base: './',
  server: { port: 5174, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'safari15',
    chunkSizeWarningLimit: 5000,
  },
});
