import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The game server shifts port when its preferred one is busy and records the
 * chosen port in `.game-server-port` at the repo root. Read it at config load
 * so the proxy and the injected `__GAME_SERVER_PORT__` match the server.
 * Restart Vite after the server moves to a different port.
 */
const PORT_FILE = fileURLToPath(new URL('../../.game-server-port', import.meta.url));
const DEFAULT_SERVER_PORT = 2567;

function resolveServerPort(): number {
  try {
    const port = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
  } catch {
    // The server has not started yet; fall back to the default port.
  }
  return DEFAULT_SERVER_PORT;
}

export default defineConfig(({ command }) => {
  // Only dev follows the shifting port file; a production build keeps the
  // historical default so a stale dev artifact cannot leak into it.
  const serverPort = command === 'serve' ? resolveServerPort() : DEFAULT_SERVER_PORT;

  return {
    define: {
      __GAME_SERVER_PORT__: JSON.stringify(serverPort)
    },
    plugins: [react()],
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
