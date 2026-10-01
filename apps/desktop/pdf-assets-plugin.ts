import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/** Ship the exact installed PDF.js fonts, character maps and decoders for offline use. */
export function pdfAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const files = new Map<string, string>();
  const collect = async () => {
    if (files.size) return;
    files.set('pdf.worker.mjs', join(root, 'build', 'pdf.worker.mjs'));
    for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) for (const entry of await readdir(join(root, folder), { withFileTypes: true })) if (entry.isFile()) files.set(folder + '/' + entry.name, join(root, folder, entry.name));
  };
  return {
    name: 'pi-offline-pdf-assets',
    async configureServer(server) {
      await collect();
      server.middlewares.use('/pdf-assets', async (request, response, next) => {
        const path = (request.url ?? '').split('?')[0].replace(/^\//, ''), file = files.get(path);
        if (!file) { next(); return; }
        try { response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(path) ? 'text/javascript' : 'application/octet-stream'); response.end(await readFile(file)); }
        catch { response.statusCode = 404; response.end(); }
      });
    },
    async generateBundle() { await collect(); for (const [path, file] of files) this.emitFile({ type: 'asset', fileName: 'pdf-assets/' + path, source: await readFile(file) }); },
  };
}
