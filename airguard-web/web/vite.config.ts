import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname),
  base: '/',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../dist/web'),
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    port: 5173,
    open: true
  }
});
