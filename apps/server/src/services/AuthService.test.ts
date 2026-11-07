import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AuthService as AuthServiceType } from './AuthService.js';

const dbFile = path.join(os.tmpdir(), `cq-auth-${process.pid}-${Date.now()}.db`);

let prisma: { $disconnect: () => Promise<void> };
let AuthService: typeof AuthServiceType;
let counter = 0;

beforeAll(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbFile + suffix, { force: true });
  }
  process.env.DATABASE_FILE = dbFile;
  process.env.AUTH_SECRET = 'test-secret-at-least-16-chars';

  const database = await import('./DatabaseService.js');
  await database.DatabaseService.initialize();
  prisma = database.prisma;
  ({ AuthService } = await import('./AuthService.js'));
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbFile + suffix, { force: true });
  }
});

function uniqueUsername(): string {
  counter += 1;
  return `user_${Date.now()}_${counter}`;
}

function register(displayName: unknown, username = uniqueUsername()) {
  return AuthService.register({ username, displayName, password: 'password123' });
}

describe('AuthService display name validation', () => {
  it('accepts letters, digits and underscores', async () => {
    const { user } = await register('Lord_2026');

    expect(user.displayName).toBe('Lord_2026');
  });

  it('rejects spaces', async () => {
    await expect(register('Lord Name')).rejects.toMatchObject({ status: 422 });
  });

  it('rejects accented characters', async () => {
    await expect(register('Đại Việt')).rejects.toMatchObject({ status: 422 });
  });

  it('rejects punctuation', async () => {
    await expect(register('Lord-Name!')).rejects.toMatchObject({ status: 422 });
  });

  it('sanitizes the username fallback when no display name is given', async () => {
    const username = `lord.one-${Date.now()}`;

    const { user } = await register(undefined, username);

    expect(user.displayName).toBe(username.replace(/[^a-zA-Z0-9_]/g, '_'));
  });
});
