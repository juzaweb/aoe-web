/**
 * Auth token storage.
 *
 * Kept apart from `api.ts` so lightweight callers — the landing page only needs
 * to know whether a session exists — do not pull the Colyseus SDK and the full
 * account API into their bundle.
 */
export const TOKEN_STORAGE_KEY = 'cq_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private mode; the caller treats it as signed out.
    return null;
  }
}

export function hasStoredToken(): boolean {
  return getStoredToken() !== null;
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Private-mode storage failures are non-fatal: the session just won't persist.
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
