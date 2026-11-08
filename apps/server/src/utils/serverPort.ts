import fs from 'fs';
import net from 'net';
import { fileURLToPath } from 'url';

/**
 * Runtime port discovery for the game server.
 *
 * The API port is not fixed. When the preferred port (PORT, the last used port
 * recorded in `.game-server-port`, or 2567) is already taken, the server picks
 * the next free one and records it. The client's Vite config reads the same
 * file so its proxy and API URL follow the server.
 */

const DEFAULT_PORT = 2567;
const MAX_PORT = 65_535;

/** Repo-root file shared with `apps/client/vite.config.ts`. */
export const PORT_FILE = fileURLToPath(
  new URL('../../../../.game-server-port', import.meta.url)
);

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

function readPortFile(): number | null {
  try {
    const value = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    return Number.isInteger(value) && value > 0 && value <= MAX_PORT ? value : null;
  } catch {
    return null;
  }
}

export function writePortFile(port: number): void {
  try {
    fs.writeFileSync(PORT_FILE, `${port}\n`, 'utf8');
  } catch (err) {
    // A read-only checkout or sandbox must not stop the server from listening.
    console.warn(`⚠️  [Server] Could not write ${PORT_FILE}:`, err);
  }
}

/** First free port at or above `start`, so a busy port shifts to the next one. */
export async function findFreePort(start: number): Promise<number> {
  for (let port = start; port <= MAX_PORT; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port available between ${start} and ${MAX_PORT}`);
}

/**
 * Resolve the port to listen on: explicit `PORT` wins, then the previously
 * recorded port (stable across `tsx watch` restarts), then the default.
 */
export async function resolveServerPort(): Promise<number> {
  const requested = Number(process.env.PORT);
  const preferred =
    Number.isInteger(requested) && requested > 0
      ? requested
      : (readPortFile() ?? DEFAULT_PORT);

  const port = await findFreePort(Math.min(Math.max(preferred, 1), MAX_PORT));
  writePortFile(port);
  return port;
}

export function isAddressInUse(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'EADDRINUSE'
  );
}
