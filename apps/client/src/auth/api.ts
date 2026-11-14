/**
 * Account API client.
 *
 * The token is kept in `localStorage` so a refresh keeps the session, and it is
 * also handed to the Colyseus client (`client.auth.token`), which appends it to
 * the room connection as `_authToken` for `WorldRoom.onAuth` to verify.
 */

import { ErrorCode } from '@colyseus/sdk';
import {
  RaidStartResponse,
  SESSION_ALREADY_ACTIVE,
  SESSION_BUSY,
  WorldMapPayload
} from '@chien-quoc/shared';
import i18n from '../i18n/index.js';
import { clearStoredToken, getStoredToken, storeToken } from './token.js';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
}

const DEFAULT_SERVER_PORT = 2567;

/**
 * Port the game server is listening on. Dev gets it from the value Vite injects
 * into `index.html` (re-read per page load); builds use the build-time constant.
 */
function getServerPort(): number {
  const runtimePort = (globalThis as { __GAME_SERVER_PORT__?: unknown }).__GAME_SERVER_PORT__;
  if (typeof runtimePort === 'number' && Number.isInteger(runtimePort) && runtimePort > 0) {
    return runtimePort;
  }
  return typeof __GAME_SERVER_PORT__ === 'number' ? __GAME_SERVER_PORT__ : DEFAULT_SERVER_PORT;
}

/**
 * The connect-failure copy names the port the client actually tried, so the
 * message stays correct when the server shifts away from the default one.
 */
export function connectFailedMessage(): string {
  return i18n.t('app.connectFailed', { port: getServerPort() });
}

/** Server base URL resolved from the current page host and the server's port. */
export function getServerUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${window.location.hostname}:${getServerPort()}`;
}

/** Extracts a human-readable message from a non-2xx response. */
async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch {
    // Fall through to the generic message.
  }
  return connectFailedMessage();
}

/** Standard content headers used by every API call, plus the active language. */
function apiHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'accept-language': i18n.language
  };
}

async function postAuth(path: string, body: Record<string, string>): Promise<AuthResponse> {
  let response: Response;
  try {
    response = await fetch(`${getServerUrl()}${path}`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error(connectFailedMessage());
  }

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const data = (await response.json()) as AuthResponse;
  storeToken(data.token);
  return data;
}

export function register(input: {
  username: string;
  displayName: string;
  password: string;
}): Promise<AuthResponse> {
  return postAuth('/auth/register', input);
}

export function login(input: { username: string; password: string }): Promise<AuthResponse> {
  return postAuth('/auth/login', input);
}

/**
 * Whether a failed room join was rejected by the server's auth check, meaning
 * the stored token is dead and the player must sign in again.
 *
 * Keyed on the matchmaking error code rather than the message text, so a
 * wording change on the server cannot silently break the logout flow.
 */
export function isAuthRejection(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === ErrorCode.AUTH_FAILED
  );
}

export type SessionJoinError = 'taken' | 'busy';

/**
 * Why a failed room join was refused by the session gate, if it was.
 *
 * Keyed on the matchmaking code, never the message text: `'taken'` means another
 * tab/device owns the account (show the blocked screen), `'busy'` means a join
 * for the same account is still in flight (retry quietly), `null` means this was
 * a different failure and the caller should keep its existing handling.
 */
export function classifySessionJoinError(err: unknown): SessionJoinError | null {
  if (typeof err !== 'object' || err === null) return null;

  const code = (err as { code?: unknown }).code;
  if (code === SESSION_ALREADY_ACTIVE) return 'taken';
  if (code === SESSION_BUSY) return 'busy';
  return null;
}

/**
 * Restores the session for a stored token. Returns `null` when the token is
 * missing, expired, or the server is unreachable.
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const token = getStoredToken();
  if (!token) return null;

  try {
    const response = await fetch(`${getServerUrl()}/auth/me`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      clearStoredToken();
      return null;
    }
    const data = (await response.json()) as { user: AuthUser };
    return data.user;
  } catch {
    // Keep the token: the server may just be temporarily down.
    return null;
  }
}

// ---------------------------------------------------------------------------
// World map and raids (Phase 23)
// ---------------------------------------------------------------------------

/** `fetch` with the stored bearer token, throwing the server's message on 4xx. */
async function authedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  if (!token) throw new Error(i18n.t('app.sessionExpired'));

  let response: Response;
  try {
    response = await fetch(`${getServerUrl()}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...apiHeaders(),
        ...(init.headers ?? {})
      }
    });
  } catch {
    throw new Error(i18n.t('app.connectionLost'));
  }

  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as T;
}

/** Empires within ±5 Town Center levels, with the reason each one is blocked. */
export function fetchWorldMap(): Promise<WorldMapPayload> {
  return authedJson<WorldMapPayload>('/world-map');
}

/** Commits a raid server-side; the caller then joins `roomName` with `{ ownerId, raidId }`. */
export function startRaid(defenderId: string, unitIds: string[]): Promise<RaidStartResponse> {
  return authedJson<RaidStartResponse>('/raid/start', {
    method: 'POST',
    body: JSON.stringify({ defenderId, unitIds })
  });
}

/** Fallback retreat for a client whose room socket is already gone. */
export async function retreatRaid(raidId: string): Promise<void> {
  await authedJson<{ ok: boolean }>('/raid/retreat', {
    method: 'POST',
    body: JSON.stringify({ raidId })
  });
}
