import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { findFreePort, isAddressInUse, resolveServerPort } from './serverPort.js';

const openServers: net.Server[] = [];
const tempDirs: string[] = [];

async function listen(port = 0): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer();
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve());
  });
  return { server, port: (server.address() as net.AddressInfo).port };
}

async function freePort(): Promise<number> {
  const { server, port } = await listen();
  await close(server);
  return port;
}

async function close(server: net.Server): Promise<void> {
  const index = openServers.indexOf(server);
  if (index >= 0) openServers.splice(index, 1);
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function tempPortFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-port-'));
  tempDirs.push(dir);
  return path.join(dir, 'port');
}

function readFilePort(file: string): string {
  return fs.readFileSync(file, 'utf8').trim();
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('serverPort', () => {
  it('skips a busy port and returns the next free one', async () => {
    const { port } = await listen();

    const chosen = await findFreePort(port);

    expect(chosen).toBeGreaterThan(port);
  });

  it('shifts past a busy requested port and records the chosen one', async () => {
    const { port } = await listen();
    const file = tempPortFile();

    const chosen = await resolveServerPort({ portFile: file, requestedPort: port });

    expect(chosen).toBeGreaterThan(port);
    expect(readFilePort(file)).toBe(String(chosen));
  });

  it('reuses the recorded port when PORT is not set', async () => {
    const file = tempPortFile();
    const recorded = await freePort();
    fs.writeFileSync(file, `${recorded}\n`, 'utf8');
    const previousPort = process.env.PORT;
    delete process.env.PORT;

    try {
      const chosen = await resolveServerPort({ portFile: file });
      expect(chosen).toBe(recorded);
    } finally {
      if (previousPort !== undefined) process.env.PORT = previousPort;
    }
  });

  it('honours an explicit requested port when it is free', async () => {
    const file = tempPortFile();
    const requested = await freePort();

    const chosen = await resolveServerPort({ portFile: file, requestedPort: requested });

    expect(chosen).toBe(requested);
    expect(readFilePort(file)).toBe(String(requested));
  });

  it('detects EADDRINUSE errors', () => {
    expect(isAddressInUse(Object.assign(new Error('busy'), { code: 'EADDRINUSE' }))).toBe(true);
    expect(isAddressInUse(Object.assign(new Error('other'), { code: 'EPERM' }))).toBe(false);
    expect(isAddressInUse(new Error('plain'))).toBe(false);
    expect(isAddressInUse(null)).toBe(false);
  });
});
