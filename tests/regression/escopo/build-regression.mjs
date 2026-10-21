import { resolve } from 'node:path';
import { build } from 'vite';

const root=process.cwd();
await build({
  configFile:false,
  root,
  build:{
    outDir:resolve(root,'tests/regression/browser/dist'),
    emptyOutDir:true,
    minify:true,
    sourcemap:false,
    lib:{
      entry:resolve(root,'tests/regression/browser/entry.ts'),
      formats:['iife'],
      name:'TrailRegression',
      fileName:()=> 'regression.js',
    },
  },
});
