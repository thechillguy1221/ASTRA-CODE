import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repositoryRoot = resolve(import.meta.dirname, '../..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lyntar/contracts': resolve(repositoryRoot, 'packages/contracts/src/index.ts'),
    },
  },
  build: { outDir: 'dist/renderer', emptyOutDir: true },
});
