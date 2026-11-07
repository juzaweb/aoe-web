import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { accountSessions } from './rooms/AccountSessions.js';

const listNeighbors = vi.fn();
const startRaid = vi.fn();
const retreatRaid = vi.fn();

vi.mock('./services/RaidService.js', () => {
  class RaidError extends Error {
    constructor(message: string, readonly status = 400) {
      super(message);
    }
  }
  return {
    RaidError,
    RaidService: {
      listNeighbors: (...args: unknown[]) => listNeighbors(...args),
      startRaid: (...args: unknown[]) => startRaid(...args),
      retreatRaid: (...args: unknown[]) => retreatRaid(...args),
      reconcileStaleRaids: vi.fn().mockResolvedValue(0)
    }
  };
});

vi.mock('./services/AuthService.js', () => {
  class AuthError extends Error {
    constructor(message: string, readonly status = 400) {
      super(message);
    }
  }
  return {
    AuthError,
    AuthService: {
      verifyToken: (token: string | undefined) =>
        token === 'good-token' ? { id: 'attacker', username: 'attacker' } : null,
      findById: async (id: string) =>
        id === 'attacker' ? { id: 'attacker', username: 'attacker', displayName: 'Attacker' } : null,
      register: vi.fn(),
      login: vi.fn(),
      assertConfigured: vi.fn()
    }
  };
});

// Prisma is imported transitively; it must not touch a real database here.
vi.mock('./services/DatabaseService.js', () => ({
  DatabaseService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    loadZoneEntities: vi.fn().mockResolvedValue([]),
    loadPlayerProfile: vi.fn().mockResolvedValue(null),
    loadForeignBaseline: vi.fn().mockResolvedValue({ unitCount: 0, buildings: [] }),
    consumeTravelTransfers: vi.fn().mockResolvedValue([]),
    commitTravel: vi.fn().mockResolvedValue(undefined),
    loadRoads: vi.fn().mockResolvedValue([]),
    savePlayerEmpire: vi.fn().mockResolvedValue(undefined),
    saveZonePlayerEntities: vi.fn().mockResolvedValue(undefined),
    saveFullWorldState: vi.fn().mockResolvedValue(undefined)
  }
}));

let app: import('express').Express;
let server: Server;
let baseUrl: string;

const auth = { Authorization: 'Bearer good-token', 'Content-Type': 'application/json' };

beforeAll(async () => {
  ({ app } = await import('./index.js'));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  listNeighbors.mockReset();
  startRaid.mockReset();
  retreatRaid.mockReset();
  accountSessions.reset();
});

describe('GET /world-map', () => {
  it('rejects an anonymous caller', async () => {
    const res = await fetch(`${baseUrl}/world-map`);
    expect(res.status).toBe(401);
  });

  it('returns the neighbour list for the signed-in account', async () => {
    listNeighbors.mockResolvedValue({
      self: { userId: 'attacker', townCenterLevel: 3 },
      neighbors: []
    });

    const res = await fetch(`${baseUrl}/world-map`, { headers: auth });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      self: { userId: 'attacker', townCenterLevel: 3 },
      neighbors: []
    });
    expect(listNeighbors).toHaveBeenCalledWith('attacker');
  });
});

describe('POST /raid/start', () => {
  it('rejects a malformed body', async () => {
    const res = await fetch(`${baseUrl}/raid/start`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ defenderId: 42 })
    });

    expect(res.status).toBe(400);
    expect(startRaid).not.toHaveBeenCalled();
  });

  it('maps a rule violation to its status and Vietnamese message', async () => {
    const { RaidError } = await import('./services/RaidService.js');
    startRaid.mockRejectedValue(new RaidError('Nước này đang bị tấn công.'));

    const res = await fetch(`${baseUrl}/raid/start`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ defenderId: 'defender', unitIds: ['u1'] })
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Nước này đang bị tấn công.' });
  });

  it('returns the raid id and the room to join', async () => {
    startRaid.mockResolvedValue({ raidId: 'raid-1', defenderId: 'defender' });

    const res = await fetch(`${baseUrl}/raid/start`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ defenderId: 'defender', unitIds: ['u1', 7, 'u2'] })
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      raidId: 'raid-1',
      defenderId: 'defender',
      roomName: 'kingdom_room'
    });
    // Non-string ids are dropped before they reach the service.
    expect(startRaid).toHaveBeenCalledWith({
      attackerId: 'attacker',
      defenderId: 'defender',
      unitIds: ['u1', 'u2']
    });
  });
});

describe('POST /raid/retreat', () => {
  it('is idempotent from the client point of view', async () => {
    retreatRaid.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/raid/retreat`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ raidId: 'raid-1' })
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(retreatRaid).toHaveBeenCalledWith('raid-1', 'attacker');
  });

  it('rejects an anonymous caller', async () => {
    const res = await fetch(`${baseUrl}/raid/retreat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raidId: 'raid-1' })
    });

    expect(res.status).toBe(401);
  });

  it('refuses to skip the march while the attacker has a live room', async () => {
    accountSessions.activate('attacker', 's-attacker', 'kingdom:defender');

    const res = await fetch(`${baseUrl}/raid/retreat`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ raidId: 'raid-1' })
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Hãy rút quân trong trận đánh.' });
    expect(retreatRaid).not.toHaveBeenCalled();
  });

  it('falls back to the HTTP retreat when the socket is gone', async () => {
    accountSessions.activate('attacker', 's-dead', 'kingdom:defender', () => undefined, () => false);
    retreatRaid.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/raid/retreat`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ raidId: 'raid-1' })
    });

    expect(res.status).toBe(200);
    expect(retreatRaid).toHaveBeenCalledWith('raid-1', 'attacker');
  });
});
