import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  isLocalHost,
  classifyZone,
  parseAutosaveLine,
  percentileNearestRank,
  median,
  computeStats,
} from './benchmark-autosave.mjs';

test('parseArgs defaults', () => {
  const o = parseArgs([]);
  assert.equal(o.clients, 10);
  assert.equal(o.duration, 90);
  assert.equal(o.warmup, 5);
  assert.equal(o.battlefield, true);
  assert.equal(o.server, 'spawn');
  assert.equal(o.host, 'localhost');
});

test('parseArgs flags', () => {
  const o = parseArgs(['--clients', '2', '--duration', '65', '--no-battlefield', '--host', '127.0.0.1', '--output', '/tmp/x.json', '--strict']);
  assert.equal(o.clients, 2);
  assert.equal(o.duration, 65);
  assert.equal(o.battlefield, false);
  assert.equal(o.host, '127.0.0.1');
  assert.equal(o.output, '/tmp/x.json');
  assert.equal(o.strict, true);
});

test('isLocalHost', () => {
  assert.equal(isLocalHost('localhost'), true);
  assert.equal(isLocalHost('127.0.0.1'), true);
  assert.equal(isLocalHost('example.com'), false);
});

test('classifyZone', () => {
  assert.equal(classifyZone('battlefield'), 'battlefield');
  assert.equal(classifyZone('kingdom:abc'), 'kingdom');
});

test('parseAutosaveLine', () => {
  const line = '💾 [DatabaseService] kingdom:u1 auto-saved (Players: 1, Buildings: 4, Units: 3, 10 ms, 12 stmts)';
  const r = parseAutosaveLine(line);
  assert.deepEqual(r, { zone: 'kingdom:u1', players: 1, buildings: 4, units: 3, ms: 10, stmts: 12 });
  assert.equal(parseAutosaveLine('no match'), null);
  const bf = parseAutosaveLine('💾 [DatabaseService] battlefield auto-saved (Players: 2, Buildings: 0, Units: 1, 8 ms, 2 stmts)');
  assert.equal(bf.zone, 'battlefield');
});

test('percentileNearestRank', () => {
  const s = [1,2,3,4,5];
  assert.equal(percentileNearestRank(s, 0.95), 5);
  assert.equal(percentileNearestRank([8,9,11,13], 0.95), 13);
});

test('median', () => {
  assert.equal(median([1,2,3,4]), 2.5);
  assert.equal(median([1,2,3]), 2);
});

test('computeStats', () => {
  const samples = [
    { ms: 8, stmts: 2 },
    { ms: 9, stmts: 2 },
    { ms: 11, stmts: 2 },
    { ms: 13, stmts: 2 },
  ];
  const st = computeStats(samples);
  assert.equal(st.n, 4);
  assert.equal(st.min, 8);
  assert.equal(st.max, 13);
  assert.equal(st.p95, 13);
  assert.equal(st.stmtsAvg, 2);
});
