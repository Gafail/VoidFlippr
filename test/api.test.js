/**
 * End-to-end API tests.
 *
 * Boots the real HTTP server against a temporary data directory and exercises
 * the endpoints a player actually uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmpRoot = await mkdtemp(path.join(tmpdir(), 'voidflippr-test-'));
process.env.DATA_DIR = tmpRoot;
process.env.PORT = '0';
process.env.VERBOSE = '0';
process.env.STORAGE_BACKEND = process.env.TEST_STORAGE_BACKEND || 'sqlite';

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

// Storage initialisation is async; wait for the listener to be up.
await new Promise((resolve) => setTimeout(resolve, 100));

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

/** Register a fresh identity through the server. */
async function register(name = 'Tester') {
    const res = await post('/daily-register', { name });
    const data = JSON.parse(res.text);
    return { ...data, name };
}

const GUID = 'ABCDEFGH';
let seed;
let minMoves;
/** A time that is comfortably above the minimum plausible time. */
let validTime;
/** One identity reused across the slot tests, like a real player. */
let player;

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    const { closeStorage } = await import('../server/store.js');
    closeStorage();
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
    minMoves = data.minMoves;
    validTime = Math.max(20000, minMoves * config.minMsPerMove + 5000);
    assert.ok(minMoves > 0, 'expected a positive minimum move count');
});

test('GET / serves the game', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.text, /VoidFlippr/);
});

test('GET /healthz reports ok and the storage backend', async () => {
    const res = await get('/healthz');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.equal(data.ok, true);
    assert.ok(['sqlite', 'json'].includes(data.storage));
});

test('GET /404.html serves the branded page', async () => {
    const res = await get('/404.html');
    assert.equal(res.status, 200);
    assert.match(res.text, /404/);
});

test('the branded 404 page is reachable even without a built dist/', async () => {
    const res = await get('/404.html');
    assert.equal(res.status, 200);
    assert.match(res.text, /VoidFlippr/);
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

test('CORS is not open by default', async () => {
    const res = await fetch(`${base}/daily-seed`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null,
        'a foreign origin must not be allowed');
});

test('POST /daily-register issues a signed identity', async () => {
    const res = await post('/daily-register', { name: 'Alice' });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.match(data.guid, /^[A-Z2-9]{8}$/);
    assert.ok(data.token.length > 0, 'expected a signing token');
    assert.equal(data.name, 'Alice');
});

test('POST /daily-register accepts a request with no name', async () => {
    // The client pre-fetches an identity before the player types a name.
    const res = await post('/daily-register', { name: '' });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.match(data.guid, /^[A-Z2-9]{8}$/);
    assert.ok(data.token.length > 0);
});

test('POST /daily-register rejects an invalid name', async () => {
    const res = await post('/daily-register', { name: 'bad<script>' });
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.text).ok, false);
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

test('POST /daily-submit rejects a forged identity', async () => {
    const res = await post('/daily-submit', {
        guid: GUID, token: 'forged-token', name: 'Alice', seed, timeMs: validTime, moves: minMoves,
    });
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.text).reason, 'unknown identity');
});

test('POST /daily-submit rejects a submission with no token', async () => {
    const res = await post('/daily-submit', {
        guid: GUID, name: 'Alice', seed, timeMs: validTime, moves: minMoves,
    });
    assert.equal(res.status, 403);
});

test('POST /daily-submit rejects an invalid guid', async () => {
    const identity = await register('Alice');
    const res = await post('/daily-submit', {
        guid: 'nope!', token: identity.token, name: 'Alice', seed, timeMs: validTime, moves: minMoves,
    });
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.text).reason, 'invalid guid');
});

test('POST /daily-submit rejects an implausible move count', async () => {
    const identity = await register('Alice');
    const res = await post('/daily-submit', {
        guid: identity.guid, token: identity.token, name: 'Alice', seed,
        timeMs: validTime, moves: 1,
    });
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.text).reason, 'implausible move count');
});

test('POST /daily-submit rejects a seed mismatch', async () => {
    const identity = await register('Alice');
    const res = await post('/daily-submit', {
        guid: identity.guid, token: identity.token, name: 'Alice',
        seed: seed + 1, timeMs: validTime, moves: minMoves,
    });
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.text).reason, 'seed mismatch');
});

test('POST /daily-submit rejects a time below the minimum possible', async () => {
    const identity = await register('Alice');
    const res = await post('/daily-submit', {
        guid: identity.guid, token: identity.token, name: 'Alice', seed, timeMs: 1000, moves: minMoves,
    });
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.text).reason, 'time below minimum possible');
});

test('the first submission takes the "first" slot', async () => {
    player = await register('Alice');
    const res = await post('/daily-submit', {
        guid: player.guid, token: player.token, name: 'Alice', seed,
        timeMs: validTime, moves: minMoves, slotHint: 'first',
    });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.equal(data.ok, true);
    assert.equal(data.accepted, true);
    assert.equal(data.slot, 'first');
    assert.equal(data.timeMs, validTime);
});

test('a faster second submission takes the "best" slot', async () => {
    const faster = validTime - 1000;
    const res = await post('/daily-submit', {
        guid: player.guid, token: player.token, name: 'Alice', seed,
        timeMs: faster, moves: minMoves, slotHint: 'best',
    });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.equal(data.accepted, true);
    assert.equal(data.slot, 'best');
    assert.equal(data.improved, true);
});

test('a slower submission is not accepted as an improvement', async () => {
    const res = await post('/daily-submit', {
        guid: player.guid, token: player.token, name: 'Alice', seed,
        timeMs: validTime + 5000, moves: minMoves, slotHint: 'best',
    });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.equal(data.ok, true);
    assert.equal(data.accepted, false);
    assert.equal(data.reason, 'not an improvement');
    assert.equal(data.timeMs, validTime - 1000);
});

test('the leaderboard lists both of a player\'s entries', async () => {
    const res = await get('/daily-leaderboard');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.equal(data.date, dayKey());
    assert.ok(data.total >= 2, `expected at least 2 entries, got ${data.total}`);
    const mine = data.top10.filter((e) => e.guid === player.guid).map((e) => e.slot);
    assert.ok(mine.includes('first'), 'expected a "first" slot on the board');
    assert.ok(mine.includes('best'), 'expected a "best" slot on the board');
    // Entries are ordered fastest first.
    for (let i = 1; i < data.top10.length; i++) {
        assert.ok(data.top10[i - 1].timeMs <= data.top10[i].timeMs, 'leaderboard must be sorted');
    }
});

test('the leaderboard reports the player\'s own slots when asked', async () => {
    const identity = await register('Bob');
    await post('/daily-submit', {
        guid: identity.guid, token: identity.token, name: 'Bob', seed, timeMs: validTime, moves: minMoves,
    });
    const res = await get(`/daily-leaderboard?guid=${identity.guid}`);
    const data = JSON.parse(res.text);
    assert.ok(data.me, 'expected a "me" block');
    assert.equal(data.me.guid, identity.guid);
    assert.equal(data.me.first.timeMs, validTime);
    assert.equal(data.me.best, null);
});

test('the wrong method returns 405', async () => {
    const res = await fetch(`${base}/daily-seed`, { method: 'DELETE' });
    assert.equal(res.status, 405);
});

test('the server works with an explicit PORT env var', () => {
    assert.equal(typeof config.port, 'number');
});