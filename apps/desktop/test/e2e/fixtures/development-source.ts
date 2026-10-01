import { resolveConfig } from 'electron-vite';
import { build, createServer, type ViteDevServer } from 'vite';

/** Use the project's serve configuration for all three processes; never reuse a packaged renderer. */
export async function startDevelopmentSource(): Promise<{ server: ViteDevServer; url: string }> {
  process.env.NODE_ENV_ELECTRON_VITE = 'development';
  const { config } = await resolveConfig({}, 'serve', 'development');
  if (!config?.main || !config.preload || !config.renderer)
    throw new Error('Missing desktop development configuration');
  await build({ ...config.main, build: { ...config.main.build, watch: null } });
  await build({ ...config.preload, build: { ...config.preload.build, watch: null } });
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
  return { server, url: 'http://127.0.0.1:' + address.port };
}
