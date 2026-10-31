/**
 * Storage tests.
 *
 * The same suite runs against both backends so they stay interchangeable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmpRoot = await mkdtemp(path.join(tmpdir(), 'voidflippr-store-'));
process.env.DATA_DIR = tmpRoot;
process.env.STORAGE_BACKEND = process.env.TEST_STORAGE_BACKEND || 'sqlite';
process.env.PORT = '0';

const { default: config } = await import('../server/config.js');
const { initStorage, closeStorage, loadDay, saveDay, submitScore, leaderboardSnapshot, rankFor, sortEntries, topTen } =
    await import('../server/store.js');
const { dayKey } = await import('../server/daily.js');

await initStorage();

const TODAY = dayKey();
const sample = [
    { guid: 'AAAAAAA', slot: 'first', name: 'Alice', timeMs: 25000, submittedAt: '2026-01-01T00:00:00Z' },
    { guid: 'AAAAAAA', slot: 'best', name: 'Alice', timeMs: 19607, submittedAt: '2026-01-01T00:01:00Z' },
    { guid: 'BBBBBBB', slot: 'first', name: 'Bob', timeMs: 30000, submittedAt: '2026-01-01T00:02:00Z' },
];

test.after(async () => {
    closeStorage();
    await rm(tmpRoot, { recursive: true, force: true });
});

test('the configured backend opens', async () => {
    const store = await initStorage();
    assert.ok(['sqlite', 'json'].includes(store.kind));
    assert.equal(store.kind, process.env.STORAGE_BACKEND === 'json' ? 'json' : 'sqlite');
});

test('entries round-trip through the backend', async () => {
    await saveDay(TODAY, sample);
    const loaded = await loadDay(TODAY);
    assert.equal(loaded.length, 3);
    const alice = loaded.filter((e) => e.guid === 'AAAAAAA').map((e) => e.slot).sort();
    assert.deepEqual(alice, ['best', 'first']);
});

test('a missing day reads as empty', async () => {
    const loaded = await loadDay('19990101');
    assert.deepEqual(loaded, []);
});

test('saving replaces the whole day rather than appending', async () => {
    await saveDay(TODAY, sample);
    await saveDay(TODAY, sample.slice(0, 1));
    const loaded = await loadDay(TODAY);
    assert.equal(loaded.length, 1);
    // restore for the other tests
    await saveDay(TODAY, sample);
});

test('the first submission takes the first slot', async () => {
    const result = await submitScore({ guid: 'PLAYER1', name: 'Carol', timeMs: 30000 }, '2026-01-01T00:00:00Z');
    assert.equal(result.accepted, true);
    assert.equal(result.slot, 'first');
    assert.equal(result.improved, false);
});

test('a faster second submission takes the best slot', async () => {
    const result = await submitScore({ guid: 'PLAYER1', name: 'Carol', timeMs: 20000 }, '2026-01-01T00:03:00Z');
    assert.equal(result.accepted, true);
    assert.equal(result.slot, 'best');
    assert.equal(result.improved, true);
});

test('a slower submission is not an improvement', async () => {
    const result = await submitScore({ guid: 'PLAYER1', name: 'Carol', timeMs: 25000 }, '2026-01-01T00:04:00Z');
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'not an improvement');
    assert.equal(result.timeMs, 20000);
});

test('the first slot is never overwritten', async () => {
    const entries = await loadDay(TODAY);
    const first = entries.find((e) => e.guid === 'PLAYER1' && e.slot === 'first');
    assert.equal(first.timeMs, 30000, 'the first slot must stay locked');
});

test('a player cannot hold more than two entries', async () => {
    const entries = await loadDay(TODAY);
    const mine = entries.filter((e) => e.guid === 'PLAYER1');
    assert.equal(mine.length, 2);
});

test('the leaderboard snapshot reports totals and a sorted top 10', async () => {
    const before = (await loadDay(TODAY)).length;
    const snapshot = await leaderboardSnapshot();
    assert.equal(snapshot.date, TODAY);
    assert.equal(snapshot.total, before);
    assert.ok(snapshot.top10.length <= 10);
    for (let i = 1; i < snapshot.top10.length; i++) {
        assert.ok(snapshot.top10[i - 1].timeMs <= snapshot.top10[i].timeMs);
    }
});

test('rankFor finds a rank and reports null when absent', () => {
    const r = rankFor(sample, 'AAAAAAA', 'best');
    assert.equal(r.rank, 1);
    assert.equal(r.total, 3);
    assert.equal(rankFor(sample, 'ZZZZZZZ', 'best'), null);
});

test('sortEntries does not mutate the input', () => {
    const original = sample.slice();
    sortEntries(sample);
    assert.deepEqual(sample, original);
});

test('topTen caps the list at ten entries', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
        guid: 'GUID' + String(i).padStart(4, 'X'), slot: 'first', name: 'P' + i, timeMs: 1000 + i,
    }));
    const top = topTen(many);
    assert.equal(top.length, 10);
    assert.equal(top[0].rank, 1);
    assert.equal(top[9].timeMs, 1009);
});