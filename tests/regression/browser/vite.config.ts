import { resolve } from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'dist'), emptyOutDir: true, minify: false, sourcemap: false,
    lib: { entry: resolve(__dirname, 'entry.ts'), formats: ['iife'], name: 'TrailRegression', fileName: () => 'regression.js' },
  },
});
