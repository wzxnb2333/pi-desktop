import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { pdfAssets } from './pdf-assets-plugin.ts';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), 'agent-worker': resolve('src/worker/agent-worker.ts'), 'voice-worker': resolve('src/voice/voice-worker.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['zod'] })],
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: { root: 'src/renderer', plugins: [pdfAssets()], build: { rollupOptions: { input: resolve('src/renderer/index.html') } } },
});
