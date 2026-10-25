/**
 * End-to-end API tests.
 *
 * Boots the real HTTP server against a temporary leaderboard directory and
 * exercises the endpoints a player actually uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmpRoot = await mkdtemp(path.join(tmpdir(), 'voidflippr-test-'));
process.env.LEADERBOARD_DIR = tmpRoot;
process.env.PORT = '0';
process.env.VERBOSE = '0';

const { default: config } = await import('../server/config.js');
const { dayKey, seedFor } = await import('../server/daily.js');

// Import the server last so it picks up the environment set above.
const { server, start } = await import('../server/index.js');

// PORT=0 asks the OS for a free port, so tests never clash with a dev server.
start();

/** Wait until the server is accepting connections. */
if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve));
}

const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function get(pathname) {
    const res = await fetch(`${base}${pathname}`);
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
}

async function post(pathname, body) {
    const res = await fetch(`${base}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
}

const GUID = 'TESTGUID';
let seed;

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(tmpRoot, { recursive: true, force: true });
});

test('GET /daily-seed returns the UTC date and seed', async () => {
    const res = await get('/daily-seed');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.equal(data.date, dayKey());
    assert.equal(data.seed, seedFor());
    assert.match(data.iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    seed = data.seed;
});

test('GET / serves the game', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.text, /VoidFlippr/);
});

test('GET /healthz reports ok', async () => {
    const res = await get('/healthz');
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.text).ok, true);
});

test('GET /404.html serves the branded page', async () => {
    const res = await get('/404.html');
    assert.equal(res.status, 200);
    assert.match(res.text, /404/);
});

test('an unknown path returns 404', async () => {
    const res = await get('/definitely-not-a-page');
    assert.equal(res.status, 404);
});

test('source files are not exposed over HTTP', async () => {
    for (const p of ['/package.json', '/server.js', '/build.mjs', '/server/index.js']) {
        const res = await get(p);
        assert.equal(res.status, 404, `${p} should not be served`);
    }
});

test('path traversal is blocked', async () => {
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/css/../../package.json']) {
        const res = await get(p);
        assert.equal(res.status, 404, `${p} should not be served`);
    }
});

test('POST /daily-submit rejects a malformed body', async () => {
    const res = await post('/daily-submit', '{not json');
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.text).ok, false);
});

test('POST /daily-submit rejects an empty body', async () => {
    const res = await post('/daily-submit', {});
    assert.equal(res.status, 400);
});

test('POST /daily-submit rejects a bad guid', async () => {
    const res = await post('/daily-submit', { guid: 'nope!', name: 'Alice', seed, timeMs: 20000 });
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.text).reason, 'invalid guid');
});

test('POST /daily-submit rejects a seed mismatch', async () => {
    const res = await post('/daily-submit', { guid: GUID, name: 'Alice', seed: seed + 1, timeMs: 20000 });
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.text).reason, 'seed mismatch');
});

test('the first submission takes the "first" slot', async () => {
    const res = await post('/daily-submit', { guid: GUID, name: 'Alice', seed, timeMs: 25000, slotHint: 'first' });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.equal(data.ok, true);
    assert.equal(data.accepted, true);
    assert.equal(data.slot, 'first');
});

test('a faster second submission takes the "best" slot', async () => {
    const res = await post('/daily-submit', { guid: GUID, name: 'Alice', seed, timeMs: 20000, slotHint: 'best' });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.equal(data.accepted, true);
    assert.equal(data.slot, 'best');
    assert.equal(data.improved, true);
});

test('a slower submission is not accepted as an improvement', async () => {
    const res = await post('/daily-submit', { guid: GUID, name: 'Alice', seed, timeMs: 30000, slotHint: 'best' });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.equal(data.ok, true);
    assert.equal(data.accepted, false);
    assert.equal(data.reason, 'not an improvement');
    assert.equal(data.timeMs, 20000);
});

test('the leaderboard lists both of a player\'s entries', async () => {
    const res = await get('/daily-leaderboard');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.equal(data.date, dayKey());
    assert.equal(data.total, 2);
    assert.equal(data.top10.length, 2);
    assert.deepEqual(data.top10.map((e) => e.slot).sort(), ['best', 'first']);
    assert.equal(data.top10[0].timeMs, 20000);
});

test('the leaderboard reports the player\'s own slots when asked', async () => {
    const res = await get(`/daily-leaderboard?guid=${GUID}`);
    const data = JSON.parse(res.text);
    assert.ok(data.me, 'expected a "me" block');
    assert.equal(data.me.guid, GUID);
    assert.equal(data.me.first.timeMs, 25000);
    assert.equal(data.me.best.timeMs, 20000);
});

test('a different player only sees the first slot', async () => {
    const res = await post('/daily-submit', { guid: 'OTHERGUY', name: 'Bob', seed, timeMs: 22000 });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.text).slot, 'first');

    const lb = JSON.parse((await get('/daily-leaderboard?guid=OTHERGUY')).text);
    assert.equal(lb.me.first.timeMs, 22000);
    assert.equal(lb.me.best, null);
});

test('the wrong method returns 405', async () => {
    const res = await fetch(`${base}/daily-seed`, { method: 'DELETE' });
    assert.equal(res.status, 405);
});

test('the server works with an explicit PORT env var', () => {
    assert.equal(typeof config.port, 'number');
});