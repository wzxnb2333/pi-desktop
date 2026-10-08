import { resolveConfig } from 'electron-vite';
import { resolve } from 'node:path';
import { build, createServer, type ViteDevServer } from 'vite';

/** Use the project's serve configuration for all three processes; never reuse a packaged renderer. */
export async function startDevelopmentSource(options: { providerOAuthMain?: boolean } = {}): Promise<{ server: ViteDevServer; url: string; mainFile?: string }> {
  process.env.NODE_ENV_ELECTRON_VITE = 'development';
  const { config } = await resolveConfig({}, 'serve', 'development');
  if (!config?.main || !config.preload || !config.renderer)
    throw new Error('Missing desktop development configuration');
  await build({ ...config.main, build: { ...config.main.build, watch: null } });
  await build({ ...config.preload, build: { ...config.preload.build, watch: null } });
  const mainFile = options.providerOAuthMain ? resolve('out/main/provider-oauth-test-main.js') : undefined;
  if (mainFile) {
    const rollup = config.main.build?.rollupOptions;
    await build({ ...config.main, build: { ...config.main.build, watch: null, emptyOutDir: false,
      rollupOptions: { ...rollup, input: { 'provider-oauth-test-main': resolve('test/e2e/fixtures/provider-oauth-main.ts') },
        output: { ...rollup?.output, entryFileNames: 'provider-oauth-test-main.js' } } } });
  }
  const server = await createServer({
    ...config.renderer,
    server: { ...config.renderer.server, host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('Missing renderer development URL');
  }
  return { server, url: 'http://127.0.0.1:' + address.port, ...(mainFile ? { mainFile } : {}) };
}
