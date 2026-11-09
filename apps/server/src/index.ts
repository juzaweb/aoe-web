import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { Encoder } from '@colyseus/schema';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { KingdomRoom } from './rooms/KingdomRoom.js';
import { accountSessions } from './rooms/AccountSessions.js';
import { DatabaseService } from './services/DatabaseService.js';
import { AuthError, AuthService } from './services/AuthService.js';
import { RaidError, RaidService } from './services/RaidService.js';
import { createRateLimit } from './services/RateLimiter.js';
import { localeFromHeader, translate, translateError } from './i18n/index.js';
import {
  findFreePort,
  isAddressInUse,
  resolveServerPort,
  writePortFile
} from './utils/serverPort.js';

// The battlefield (220x220) holds ~1.2k resource nodes, so a full world snapshot
// is far larger than the 16 KB default. Raising it up front avoids the per-room
// "buffer overflow" warning and the re-encode that follows it. Must be set
// before any room (and therefore any Encoder) is constructed.
Encoder.BUFFER_SIZE = 256 * 1024;

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
 * Error text is localized with the request's `Accept-Language` when it is a
 * known message; unknown English internals stay untouched.
 */
function sendAuthError(res: express.Response, err: unknown) {
  const locale = localeFromHeader(res.req?.headers?.['accept-language']);
  if (err instanceof AuthError) {
    res.status(err.status).json({ error: translateError(locale, err) });
    return;
  }
  console.error('[Auth Error]', err);
  res.status(500).json({ error: translate(locale, 'System error. Please try again.') });
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
    res
      .status(401)
      .json({ error: translate(localeFromHeader(req.headers['accept-language']), 'Session invalid or expired.') });
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
    res
      .status(401)
      .json({ error: translate(localeFromHeader(req.headers['accept-language']), 'Session invalid or expired.') });
    return null;
  }
  return { id: user.id, displayName: user.displayName };
}

app.get('/world-map', async (req, res) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;
    const neighborhood = await RaidService.listNeighbors(account.id);
    // I18N: shield/lock rationales ride inside the payload; localize them here
    // where the request's language is known.
    const locale = localeFromHeader(req.headers['accept-language']);
    const localized = {
      ...neighborhood,
      neighbors: neighborhood.neighbors.map((tile) => ({
        ...tile,
        blockReason: tile.blockReason ? translate(locale, tile.blockReason) : tile.blockReason
      }))
    };
    res.json(localized);
  } catch (err) {
    console.error('[WorldMap] Failed to build the neighbour list:', err);
    res.status(500).json({
      error: translate(
        localeFromHeader(req.headers['accept-language']),
        'Could not load the world map. Please try again.'
      )
    });
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
      res
        .status(400)
        .json({ error: translate(localeFromHeader(req.headers['accept-language']), 'Invalid raid request.') });
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
      res.status(err.status).json({ error: translateError(localeFromHeader(req.headers['accept-language']), err) });
      return;
    }
    console.error('[Raid] Start failed:', err);
    res.status(500).json({
      error: translate(
        localeFromHeader(req.headers['accept-language']),
        'Could not start the raid. Please try again.'
      )
    });
  }
});

// Rate limit retreat requests to prevent spamming transactions and database lookups
app.post('/raid/retreat', raidRateLimit, async (req, res) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;

    const { raidId } = (req.body ?? {}) as { raidId?: unknown };
    if (typeof raidId !== 'string') {
      res
        .status(400)
        .json({ error: translate(localeFromHeader(req.headers['accept-language']), 'Invalid retreat request.') });
      return;
    }

    // With a live room socket the army must physically march to the gate; this
    // endpoint exists only for a client that can no longer send messages, and
    // letting a connected client call it would skip the march entirely.
    if (accountSessions.hasLiveSession(account.id)) {
      res
        .status(409)
        .json({ error: translate(localeFromHeader(req.headers['accept-language']), 'Retreat from inside the raid.') });
      return;
    }

    await RaidService.retreatRaid(raidId, account.id);
    // Idempotent by design: a raid already settled is still an "ok" for the
    // caller, who only needs to know they are free to go home.
    res.json({ ok: true });
  } catch (err) {
    console.error('[Raid] Retreat failed:', err);
    res.status(500).json({
      error: translate(
        localeFromHeader(req.headers['accept-language']),
        'Could not retreat. Please try again.'
      )
    });
  }
});

export async function start() {
  // Resolve and publish the port first: the client reads the shared file at
  // startup, so it must exist before the slow DB/auth steps below.
  let port = await resolveServerPort();

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

  // The port may already be taken (another checkout, a stray dev server, or a
  // race after the free-port probe). Shift to the next free one and record it.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await gameServer.listen(port);
      break;
    } catch (err) {
      if (!isAddressInUse(err) || attempt >= 10) throw err;
      console.warn(`⚠️  [Server] Port ${port} was taken during startup, trying the next one.`);
      port = await findFreePort(port + 1);
      writePortFile(port);
    }
  }
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
