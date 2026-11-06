import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { Encoder } from '@colyseus/schema';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { KingdomRoom } from './rooms/KingdomRoom.js';
import { DatabaseService } from './services/DatabaseService.js';
import { AuthError, AuthService } from './services/AuthService.js';
import { RaidError, RaidService } from './services/RaidService.js';
import { createRateLimit } from './services/RateLimiter.js';

// The battlefield (220x220) holds ~1.2k resource nodes, so a full world snapshot
// is far larger than the 16 KB default. Raising it up front avoids the per-room
// "buffer overflow" warning and the re-encode that follows it. Must be set
// before any room (and therefore any Encoder) is constructed.
Encoder.BUFFER_SIZE = 256 * 1024;

const port = Number(process.env.PORT || 2567);
export const app: express.Express = express();

// Disable Express fingerprinting header to reduce attack surface info leakage
app.disable('x-powered-by');

// Add standard defense-in-depth security headers without external dependencies
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Auth is a bearer token in a header, never a cookie, so credentialed CORS is
// unnecessary; enabling it would only widen what a hostile origin can read.
app.use(cors());
app.use(express.json({ limit: '16kb' }));

// Brute-force and scrypt CPU-exhaustion guard for the unauthenticated routes.
const authRateLimit = createRateLimit({ limit: 10, windowMs: 60_000 });

app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'Chien Quoc RTS MMO Server', timestamp: Date.now() });
});

/**
 * Maps auth failures to their HTTP status while keeping unexpected errors opaque.
 */
function sendAuthError(res: express.Response, err: unknown) {
  if (err instanceof AuthError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[Auth Error]', err);
  res.status(500).json({ error: 'Lỗi hệ thống. Vui lòng thử lại.' });
}

app.post('/auth/register', authRateLimit, async (req, res) => {
  try {
    const result = await AuthService.register(req.body ?? {});
    res.status(201).json(result);
  } catch (err) {
    sendAuthError(res, err);
  }
});

app.post('/auth/login', authRateLimit, async (req, res) => {
  try {
    const result = await AuthService.login(req.body ?? {});
    res.json(result);
  } catch (err) {
    sendAuthError(res, err);
  }
});

app.get('/auth/me', async (req, res) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  const payload = AuthService.verifyToken(token);

  // A valid signature is not enough: after a database reset an old token still
  // verifies. Re-read the account so the client drops a dead session here
  // instead of joining the room as an empire nobody owns.
  const user = payload ? await AuthService.findById(payload.id) : null;
  if (!user) {
    res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
    return;
  }

  res.json({ user });
});

// ---------------------------------------------------------------------------
// World map and raids (Phase 23)
// ---------------------------------------------------------------------------

/** Rate limit for raid creation: a broken client must not spam transactions. */
const raidRateLimit = createRateLimit({ limit: 20, windowMs: 60_000 });

/**
 * Resolves the caller's account from the bearer token, or answers 401.
 *
 * Same rule as `/auth/me`: the signature alone is not trusted, the account is
 * re-read so a deleted empire cannot start a raid.
 */
async function requireAccount(
  req: express.Request,
  res: express.Response
): Promise<{ id: string; displayName: string } | null> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  const payload = AuthService.verifyToken(token);
  const user = payload ? await AuthService.findById(payload.id) : null;
  if (!user) {
    res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
    return null;
  }
  return { id: user.id, displayName: user.displayName };
}

app.get('/world-map', async (req, res) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;
    res.json(await RaidService.listNeighbors(account.id));
  } catch (err) {
    console.error('[WorldMap] Failed to build the neighbour list:', err);
    res.status(500).json({ error: 'Không thể tải bản đồ thế giới. Vui lòng thử lại.' });
  }
});

app.post('/raid/start', raidRateLimit, async (req, res) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;

    const { defenderId, unitIds } = (req.body ?? {}) as {
      defenderId?: unknown;
      unitIds?: unknown;
    };
    if (typeof defenderId !== 'string' || !Array.isArray(unitIds)) {
      res.status(400).json({ error: 'Dữ liệu tập kích không hợp lệ.' });
      return;
    }

    const result = await RaidService.startRaid({
      attackerId: account.id,
      defenderId,
      unitIds: unitIds.filter((id): id is string => typeof id === 'string')
    });
    res.json({ ...result, roomName: 'kingdom_room' });
  } catch (err) {
    if (err instanceof RaidError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[Raid] Start failed:', err);
    res.status(500).json({ error: 'Không thể bắt đầu trận tập kích. Vui lòng thử lại.' });
  }
});

app.post('/raid/retreat', async (req, res) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;

    const { raidId } = (req.body ?? {}) as { raidId?: unknown };
    if (typeof raidId !== 'string') {
      res.status(400).json({ error: 'Dữ liệu rút quân không hợp lệ.' });
      return;
    }

    await RaidService.retreatRaid(raidId, account.id);
    // Idempotent by design: a raid already settled is still an "ok" for the
    // caller, who only needs to know they are free to go home.
    res.json({ ok: true });
  } catch (err) {
    console.error('[Raid] Retreat failed:', err);
    res.status(500).json({ error: 'Không thể rút quân. Vui lòng thử lại.' });
  }
});

export async function start() {
  // Ensure the SQLite file, folder and tables exist before accepting traffic.
  // initialize() throws on failure, so the server never starts on a broken DB.
  await DatabaseService.initialize();

  // Fail at boot rather than on every request when the signing key is missing.
  AuthService.assertConfigured();

  const server = http.createServer(app);

  const gameServer = new Server({
    transport: new WebSocketTransport({
      server
    })
  });

  // Phase 23: the battlefield is retired here. `BattlefieldRoom` is kept as
  // source (and for its tests) but is no longer registered, so no client can
  // join it and the only PvP is a raid on a real kingdom.
  gameServer.define('kingdom_room', KingdomRoom).filterBy(['ownerId']);

  // Close raids abandoned by a crash or a restart before accepting traffic.
  await RaidService.reconcileStaleRaids().catch((err) => {
    console.error('❌ [Server] Could not reconcile stale raids:', err);
  });

  await gameServer.listen(port);
  console.log(`⚔️  Chien Quoc Game Server is running on http://localhost:${port} and ws://localhost:${port}`);
}

if (process.env.NODE_ENV !== 'test') {
  start().catch(async (err) => {
    console.error('❌ [Server] Failed to start:', err);
    // Close the SQLite connection so the process can exit without hanging handles.
    await DatabaseService.disconnect().catch(() => undefined);
    process.exit(1);
  });
}
