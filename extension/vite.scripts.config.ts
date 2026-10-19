import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Scripts injetados: um IIFE por entrada, sem imports em tempo de execução. `--mode content` ou `--mode page`. */
export default defineConfig(({ mode }) => {
  const entry = mode === 'page' ? 'src/page/main.ts' : 'src/content/main.ts';
  return {
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      target: 'chrome120',
      lib: {
        entry: resolve(__dirname, entry),
        formats: ['iife'],
        name: mode === 'page' ? 'TrailPage' : 'TrailContent',
        fileName: () => `${mode}.js`,
      },
      rollupOptions: { output: { extend: true } },
    },
  };
});
