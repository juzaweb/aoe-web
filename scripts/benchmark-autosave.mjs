#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const SERVER_CWD = join(ROOT, 'apps', 'server');
const CLIENT_SDK_PATH = join(ROOT, 'apps', 'client', 'node_modules', '@colyseus', 'sdk');
const PRISMA_CLIENT_PATH = join(ROOT, 'apps', 'server', 'node_modules', '.prisma', 'client');
const DEFAULT_PASSWORD = 'password123';

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1';
}

export function parseArgs(argv) {
  const opts = {
    clients: 10,
    duration: 90,
    warmup: 5,
    interval: 30,
    host: 'localhost',
    port: 2567,
    server: 'spawn',
    battlefield: true,
    includeWarmup: false,
    output: './autosave-benchmark.json',
    cleanup: false,
    strict: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--clients':
        opts.clients = Number(next());
        break;
      case '--duration':
        opts.duration = Number(next());
        break;
      case '--warmup':
        opts.warmup = Number(next());
        break;
      case '--interval':
        opts.interval = Number(next());
        break;
      case '--host':
        opts.host = String(next());
        break;
      case '--port':
        opts.port = Number(next());
        break;
      case '--server':
        opts.server = String(next());
        break;
      case '--battlefield':
        opts.battlefield = true;
        break;
      case '--no-battlefield':
        opts.battlefield = false;
        break;
      case '--include-warmup':
        opts.includeWarmup = true;
        break;
      case '--output':
        opts.output = String(next());
        break;
      case '--cleanup':
        opts.cleanup = true;
        break;
      case '--strict':
        opts.strict = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${a}`);
    }
  }
  if (!Number.isFinite(opts.clients) || opts.clients < 1) throw new Error('--clients must be a positive number');
  if (!Number.isFinite(opts.duration) || opts.duration < 1) throw new Error('--duration must be a positive number');
  if (!Number.isFinite(opts.warmup) || opts.warmup < 0) throw new Error('--warmup must be >= 0');
  if (!Number.isFinite(opts.port)) throw new Error('--port must be a number');
  if (opts.server !== 'spawn' && opts.server !== 'external') throw new Error('--server must be spawn or external');
  return opts;
}

export function printHelp() {
  console.log(`node scripts/benchmark-autosave.mjs [options]

  --clients N          number of kingdom clients (default 10)
  --duration Sec       measurement duration after warmup (default 90)
  --warmup Sec         warmup duration (default 5)
  --interval Sec       progress interval; server autosave stays 30 s (default 30)
  --host HOST          localhost (default localhost)
  --port PORT          2567 (default 2567)
  --server MODE        spawn | external (default spawn)
  --battlefield        enable battlefield measurement (default on)
  --no-battlefield     disable battlefield measurement
  --include-warmup     include warmup samples in p95
  --output PATH        JSON output path (default ./autosave-benchmark.json)
  --cleanup            try to remove bench_ accounts after run (optional)
  --strict             exit non-zero when a zone has fewer than 5 samples
  --help               show this help
`);
}

export function classifyZone(zone) {
  if (zone === 'battlefield') return 'battlefield';
  if (typeof zone === 'string' && zone.startsWith('kingdom:')) return 'kingdom';
  return zone;
}

const AUTOSAVE_RE = /💾 \[DatabaseService\] (\S+) auto-saved \(Players: (\d+), Buildings: (\d+), Units: (\d+), (\d+) ms, (\d+) stmts\)/;

export function parseAutosaveLine(line) {
  const m = String(line).match(AUTOSAVE_RE);
  if (!m) return null;
  return {
    zone: m[1],
    players: Number(m[2]),
    buildings: Number(m[3]),
    units: Number(m[4]),
    ms: Number(m[5]),
    stmts: Number(m[6]),
  };
}

export function percentileNearestRank(sortedAsc, p) {
  if (!sortedAsc || sortedAsc.length === 0) return null;
  const rank = Math.ceil(p * sortedAsc.length);
  const idx = Math.min(sortedAsc.length, Math.max(1, rank)) - 1;
  return sortedAsc[idx];
}

export function median(values) {
  if (!values || values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

export function computeStats(samples) {
  if (!samples || samples.length === 0) return null;
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const stmts = samples.map((s) => s.stmts);
  const mean = samples.reduce((acc, s) => acc + s.ms, 0) / samples.length;
  const stmtsAvg = stmts.reduce((acc, s) => acc + s, 0) / stmts.length;
  return {
    n: samples.length,
    min: ms[0],
    p50: median(ms),
    p95: percentileNearestRank(ms, 0.95),
    max: ms[ms.length - 1],
    mean: Math.round(mean * 10) / 10,
    stmtsAvg: Math.round(stmtsAvg * 10) / 10,
  };
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

async function fetchJson(url, options = {}, retries = 8) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429 || attempt === retries) return res;
    const retryAfter = Number(res.headers.get('retry-after') || '2');
    await sleep((Number.isFinite(retryAfter) ? retryAfter : 2) * 1000 + 500);
  }
  throw new Error('unreachable');
}

async function authAccount(baseUrl, username, password, displayName) {
  const body = JSON.stringify({ username, displayName, password });
  const regRes = await fetchJson(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  if (regRes.ok) return regRes.json();
  if (regRes.status === 409) {
    const loginRes = await fetchJson(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!loginRes.ok) {
      throw new Error(`login failed ${loginRes.status}: ${await loginRes.text()}`);
    }
    return loginRes.json();
  }
  throw new Error(`register failed ${regRes.status}: ${await regRes.text()}`);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (!isLocalHost(opts.host)) {
    console.error(`Refusing non-localhost host: ${opts.host}`);
    process.exit(1);
  }

  const baseUrl = `http://${opts.host}:${opts.port}`;

  let prismaGenerated = false;
  try {
    const req = (await import('node:module')).createRequire(join(SERVER_CWD, 'package.json'));
    req.resolve('@prisma/client');
    prismaGenerated = true;
  } catch {}
  if (!prismaGenerated) {
    try {
      const prismaBin = join(ROOT, 'apps', 'server', 'node_modules', '.bin', 'prisma');
      const gen = spawn(prismaBin, ['generate'], { cwd: SERVER_CWD, stdio: 'inherit' });
      await new Promise((resolveGen, rejectGen) => {
        gen.on('exit', (code) => (code === 0 ? resolveGen() : rejectGen(new Error(`prisma generate exited ${code}`))));
        gen.on('error', rejectGen);
      });
    } catch (err) {
      console.error('Failed to generate Prisma client:', err.message);
      process.exit(1);
    }
  }

  // Ensure client sdk exists.
  if (!existsSync(join(CLIENT_SDK_PATH, 'build', 'index.mjs'))) {
    console.error(`Missing @colyseus/sdk at ${CLIENT_SDK_PATH}`);
    process.exit(1);
  }

  let serverProc = null;
  const samples = [];
  const rooms = [];
  const clients = [];
  let stopping = false;
  let warmupEnd = 0;

  const shutdown = async (exitCode) => {
    if (stopping) return;
    stopping = true;
    for (const room of rooms) {
      try { await room.leave(); } catch {}
    }
    for (const c of clients) {
      try { /* no explicit close */ } catch {}
    }
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
      await Promise.race([
        new Promise((res) => serverProc.on('exit', res)),
        sleep(10000),
      ]);
      if (!serverProc.killed) {
        try { serverProc.kill('SIGKILL'); } catch {}
      }
    }
    // cleanup DB optional
    if (opts.cleanup) {
      const dbPath = join(ROOT, 'apps', 'server', 'database', 'dev.db');
      if (existsSync(dbPath)) {
        const sql = `DELETE FROM players WHERE id IN (SELECT id FROM users WHERE username LIKE 'bench_%'); DELETE FROM users WHERE username LIKE 'bench_%';`;
        try {
          const p = spawn('sqlite3', [dbPath, sql], { stdio: 'inherit' });
          await new Promise((res) => p.on('exit', res));
        } catch {}
      }
    }
    // print cleanup hint
    console.log('\nCleanup SQL (optional):');
    console.log('DELETE FROM players WHERE id IN (SELECT id FROM users WHERE username LIKE \'bench_%\');');
    console.log('DELETE FROM users WHERE username LIKE \'bench_%\';');

    // Build summary
    const steadySamples = opts.includeWarmup ? samples : samples.filter((s) => !s.warmup);
    const byType = { kingdom: [], battlefield: [] };
    for (const s of steadySamples) {
      const t = s.type;
      if (!byType[t]) byType[t] = [];
      byType[t].push(s);
    }

    const summary = {};
    for (const [type, arr] of Object.entries(byType)) {
      if (arr.length === 0) continue;
      summary[type] = computeStats(arr);
    }

    // Also include types not in default
    // print table
    console.log('\nAutosave benchmark — %d kingdom clients%s, %ds (warmup %ds)',
      opts.clients, opts.battlefield ? ' + 1 battlefield' : '', opts.duration, opts.warmup);
    console.log('Samples: kingdom %d, battlefield %d',
      (byType.kingdom || []).length, (byType.battlefield || []).length);
    console.log('Zone type    n   min   p50   p95   max   mean   stmts(avg)');
    for (const type of ['battlefield', 'kingdom']) {
      const st = summary[type];
      if (!st) continue;
      console.log(
        `${type.padEnd(12)} ${String(st.n).padStart(3)} ${String(st.min).padStart(5)} ${String(st.p50).padStart(5)} ${String(st.p95).padStart(5)} ${String(st.max).padStart(5)} ${String(st.mean).padStart(6)} ${String(st.stmtsAvg).padStart(9)}`
      );
    }
    const totalStmts = (summary.kingdom ? summary.kingdom.stmtsAvg * opts.clients : 0) + (summary.battlefield ? summary.battlefield.stmtsAvg : 0);
    console.log(`Total stmts/cycle (${opts.clients} kingdom + ${opts.battlefield ? 1 : 0} bf): ~${Math.round(totalStmts)}`);

    const json = {
      runId: new Date().toISOString(),
      clients: opts.clients,
      battlefield: opts.battlefield,
      durationSec: opts.duration,
      warmupSec: opts.warmup,
      samples: samples.map((s) => ({
        zone: s.zone,
        type: s.type,
        players: s.players,
        buildings: s.buildings,
        units: s.units,
        ms: s.ms,
        stmts: s.stmts,
        warmup: s.warmup,
        t: s.t,
      })),
      summary,
    };

    const outPath = resolve(process.cwd(), opts.output);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(json, null, 2));
    console.log(`JSON: ${outPath}`);

    // exit code
    let code = exitCode;
    if (code === 0) {
      if (samples.length === 0) code = 1;
      else {
        const tooFew = Object.values(summary).some((st) => st.n > 0 && st.n < 5);
        if (tooFew) {
          console.log('WARNING: fewer than 5 samples in at least one zone; reliability low.');
          if (opts.strict) code = 2;
        }
      }
    }
    process.exit(code);
  };

  const onSignal = () => {
    void shutdown(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    // spawn/external server handling
    if (opts.server === 'spawn') {
      // port busy check
      try {
        const r = await fetch(`${baseUrl}/health`);
        if (r.ok) {
          console.error(`Port ${opts.port} already in use. Use --server external or stop the existing process.`);
          process.exit(1);
        }
      } catch {}
      // spawn
      serverProc = spawn('pnpm', ['--filter', '@chien-quoc/server', 'exec', 'tsx', 'src/index.ts'], {
        cwd: SERVER_CWD,
        env: { ...process.env, PORT: String(opts.port), NODE_ENV: 'development' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdoutBuf = '';
      serverProc.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString();
        let idx;
        while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
          const line = stdoutBuf.slice(0, idx).replace(/\r$/, '');
          stdoutBuf = stdoutBuf.slice(idx + 1);
          const parsed = parseAutosaveLine(line);
          if (parsed) {
            const type = classifyZone(parsed.zone);
            samples.push({
              zone: parsed.zone,
              type,
              players: parsed.players,
              buildings: parsed.buildings,
              units: parsed.units,
              ms: parsed.ms,
              stmts: parsed.stmts,
              warmup: Date.now() < warmupEnd,
              t: Date.now(),
            });
          }
        }
      });
      serverProc.stderr.on('data', (chunk) => {
        process.stderr.write(chunk);
      });
      serverProc.on('exit', (code) => {
        if (!stopping && code !== 0 && code !== null) {
          console.error(`Server exited with code ${code}`);
        }
      });

      // wait health
      const healthStart = Date.now();
      let healthy = false;
      while (Date.now() - healthStart < 30000) {
        try {
          const r = await fetch(`${baseUrl}/health`);
          if (r.ok) { healthy = true; break; }
        } catch {}
        await sleep(500);
      }
      if (!healthy) {
        console.error('Server did not become healthy within 30s.');
        await shutdown(1);
        return;
      }
    } else {
      // external: try health but don't fail hard
      try {
        const r = await fetch(`${baseUrl}/health`);
        if (!r.ok) console.warn('Server health check failed; continuing.');
      } catch {
        console.warn('Server health check failed; continuing.');
      }
    }

    const compactTs = String(Date.now());
    const password = DEFAULT_PASSWORD;

    // Register kingdom accounts
    const accountSpecs = Array.from({ length: opts.clients }, (_, i) => ({
      username: `bench_${compactTs}_${i}`,
      displayName: `Bench${compactTs}${i}`.slice(0, 24),
      password,
    }));

    let accounts;
    try {
      accounts = await runWithConcurrency(accountSpecs, 5, async (spec) => {
        const data = await authAccount(baseUrl, spec.username, spec.password, spec.displayName);
        return { ...data, username: spec.username };
      });
      // delay between batches approximated by concurrency; add small delay not needed
    } catch (err) {
      console.error('Auth failed:', err.message);
      await shutdown(1);
      return;
    }

    // join kingdom rooms
    const sdkModule = await import(pathToFileURL(join(CLIENT_SDK_PATH, 'build', 'index.mjs')).href);
    const { Client } = sdkModule;

    try {
      for (const acc of accounts) {
        const client = new Client(baseUrl);
        client.auth.token = acc.token;
        const room = await withTimeout(
          client.joinOrCreate('kingdom_room', { ownerId: acc.user.id }),
          30000,
          'kingdom join'
        );
        clients.push(client);
        rooms.push(room);
      }
    } catch (err) {
      console.error('Kingdom join failed:', err.message);
      await shutdown(1);
      return;
    }

    // battlefield account
    if (opts.battlefield) {
      const bfUsername = `bench_${compactTs}_bf`;
      const bfDisplayName = `Bench${compactTs}bf`.slice(0, 24);
      let bfAccount;
      try {
        bfAccount = await authAccount(baseUrl, bfUsername, password, bfDisplayName);
      } catch (err) {
        console.error('Battlefield auth failed:', err.message);
        await shutdown(1);
        return;
      }
      const bfClient = new Client(baseUrl);
      bfClient.auth.token = bfAccount.token;
      try {
        const bfRoom = await withTimeout(
          bfClient.joinOrCreate('battlefield_room'),
          30000,
          'battlefield join'
        );
        clients.push(bfClient);
        rooms.push(bfRoom);
      } catch (err) {
        console.error('Battlefield join failed:', err.message);
        await shutdown(1);
        return;
      }
    }

    // warmup
    warmupEnd = Date.now() + opts.warmup * 1000;
    // wait warmup
    await sleep(opts.warmup * 1000);

    // measurement window
    const measureEnd = Date.now() + opts.duration * 1000;
    while (Date.now() < measureEnd) {
      const remaining = measureEnd - Date.now();
      await sleep(Math.min(remaining, 1000));
    }

    // extra cycle to catch final autosave
    await sleep(30000);

    await shutdown(0);
  } catch (err) {
    console.error('Unexpected error:', err);
    await shutdown(1);
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  main();
}
