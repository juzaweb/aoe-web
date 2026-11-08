import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The game server shifts port when its preferred one is busy and records the
 * chosen port in `.game-server-port` at the repo root. The dev config reads it
 * at startup for the proxy and injects the current value into each page load.
 */
const PORT_FILE = fileURLToPath(new URL('../../.game-server-port', import.meta.url));
const DEFAULT_SERVER_PORT = 2567;

function readServerPort(): number | null {
  try {
    const port = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
  } catch {
    // The server has not started yet; fall back to the default port.
  }
  return null;
}

/**
 * Re-read the port on every HTML request, so a page loaded after the server
 * picked a port uses the right one even when Vite started first.
 */
function serverPortScript(): Plugin {
  return {
    name: 'chien-quoc-server-port',
    apply: 'serve',
    transformIndexHtml() {
      const port = readServerPort() ?? DEFAULT_SERVER_PORT;
      return [
        {
          tag: 'script',
          injectTo: 'head-prepend',
          children: `globalThis.__GAME_SERVER_PORT__=${port};`
        }
      ];
    }
  };
}

export default defineConfig(({ command }) => {
  // Only dev follows the shifting port file; a production build keeps the
  // historical default so a stale dev artifact cannot leak into it.
  const serverPort = command === 'serve' ? (readServerPort() ?? DEFAULT_SERVER_PORT) : DEFAULT_SERVER_PORT;

  return {
    define: {
      __GAME_SERVER_PORT__: JSON.stringify(serverPort)
    },
    plugins: [react(), serverPortScript()],
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/colyseus': {
          target: `http://localhost:${serverPort}`,
          ws: true,
          changeOrigin: true
        }
      }
    }
  };
});
