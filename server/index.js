/**
 * VoidFlippr HTTP server.
 *
 * Responsibilities:
 *   - serve the built game (dist/) or the raw source tree (src/)
 *   - expose the daily puzzle seed
 *   - issue player identities
 *   - accept and validate score submissions
 *   - serve the top-10 daily leaderboard
 *
 * Runs on any host with Node.js 22+ and no external npm dependencies.
 */
import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { config } from './config.js';
import { dayKey, seedFor, timestamp } from './daily.js';
import {
    closeStorage,
    initStorage,
    leaderboardSnapshot,
    loadDay,
    sortEntries,
    storage,
    submitScore,
} from './store.js';
import { resolveSafePath, sendFile } from './static.js';
import { validateSubmission } from './validate.js';
import { issueIdentity, validateRegistration, verifyGuidToken } from './identity.js';
import { consume } from './ratelimit.js';
import { dailyPuzzle } from '../shared/puzzle.js';

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/**
 * CORS headers for a request.
 *
 * The game is served from the same origin as the API, so cross-origin access
 * is denied by default. Set ALLOWED_ORIGINS to permit specific origins.
 */
function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin) return {};

    const allowed = config.allowedOrigins;
    if (!allowed.includes('*') && !allowed.includes(origin)) {
        // Do not echo the origin, and do not allow it.
        return { Vary: 'Origin' };
    }

    return {
        'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : origin,
        'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
    };
}

function sendJson(res, status, payload, extraHeaders = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        ...SECURITY_HEADERS,
        ...extraHeaders,
    });
    res.end(body);
}

/** Read a JSON body, refusing anything larger than the configured limit. */
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const declared = Number.parseInt(req.headers['content-length'] || '0', 10);
        if (Number.isFinite(declared) && declared > config.maxBodyBytes) {
            reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
            return;
        }

        const chunks = [];
        let size = 0;

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > config.maxBodyBytes) {
                reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
            } catch {
                reject(Object.assign(new Error('invalid json'), { statusCode: 400 }));
            }
        });

        req.on('error', reject);
    });
}

/** The client IP, honouring X-Forwarded-For only when a proxy is trusted. */
function clientIp(req) {
    if (config.trustProxy) {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string' && forwarded.length > 0) {
            return forwarded.split(',')[0].trim();
        }
    }
    return req.socket?.remoteAddress || 'unknown';
}

/**
 * The minimum number of clicks needed to solve today's board.
 * Cached per day, because the solver takes a few milliseconds.
 */
let puzzleCache = { day: null, minMoves: 0 };

function todaysMinMoves() {
    const today = dayKey();
    if (puzzleCache.day === today) return puzzleCache.minMoves;
    const { minMoves } = dailyPuzzle(seedFor());
    puzzleCache = { day: today, minMoves };
    return minMoves;
}

/** Serve the branded 404 page. */
async function sendNotFound(req, res) {
    const candidates = [path.join(config.webRoot, '404.html'), path.join(config.root, '404.html')];

    for (const branded of candidates) {
        try {
            const info = await stat(branded);
            if (!info.isFile()) continue;
            const body = await readFile(branded);
            res.writeHead(404, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Length': body.length,
                'Cache-Control': 'no-store',
                ...SECURITY_HEADERS,
            });
            res.end(req.method === 'HEAD' ? undefined : body);
            return;
        } catch {
            // try the next candidate
        }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Not found');
}

/**
 * Serve a static file from the web root.
 *
 * Only files inside the web root are served. The project root is NOT used as a
 * general fallback, because that would expose package.json, server source and
 * other non-public files over HTTP. The single exception is the branded 404
 * page, which lives at the project root and must stay reachable even when
 * serving straight from src/ without a build.
 */
async function serveStatic(req, res, urlPath) {
    const filePath = await resolveSafePath(config.webRoot, urlPath);
    if (filePath) {
        // Asset filenames are not content-hashed, so revalidate rather than
        // cache aggressively - a deploy should be picked up immediately.
        const cacheControl = filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=300';
        return sendFile(req, res, filePath, { cacheControl });
    }

    // Site-root assets (icons, manifest, robots.txt) live in public/.
    const publicPath = await resolveSafePath(config.publicDir, urlPath);
    if (publicPath) {
        const cacheControl = publicPath.endsWith('robots.txt') ? 'public, max-age=3600' : 'public, max-age=86400';
        return sendFile(req, res, publicPath, { cacheControl });
    }

    if (urlPath === '/404.html') {
        const branded = await resolveSafePath(config.root, '/404.html');
        if (branded) return sendFile(req, res, branded, { cacheControl: 'no-cache' });
    }

    return false;
}

async function handleSubmit(req, res) {
    let body;
    try {
        body = await readJsonBody(req);
    } catch (err) {
        sendJson(res, err.statusCode || 400, { ok: false, reason: err.message });
        return;
    }

    // Validate the shape before spending any rate limit budget, so malformed
    // requests are cheap and honest clients are not punished.
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { ok: false, reason: 'invalid body' });
        return;
    }

    const guid = typeof body.guid === 'string' ? body.guid : '';
    const ip = clientIp(req);
    const windowMs = config.rateLimitWindowSec * 1000;

    // Per-IP limits are generous: many players can share one address behind
    // NAT or a mobile carrier, so this only stops runaway scripts.
    const ipLimit = consume(`submit:ip:${ip}`, config.submitLimit, windowMs);
    if (!ipLimit.allowed) {
        sendJson(res, 429, { ok: false, reason: 'too many submissions' },
            { 'Retry-After': String(ipLimit.retryAfterSec) });
        return;
    }

    // A single player can only improve their own two slots, so a tight
    // per-identity limit is safe.
    if (guid) {
        const guidLimit = consume(`submit:guid:${guid}`, config.submitGuidLimit, windowMs);
        if (!guidLimit.allowed) {
            sendJson(res, 429, { ok: false, reason: 'too many submissions' },
                { 'Retry-After': String(guidLimit.retryAfterSec) });
            return;
        }
    }

    // Check the shape and format of the payload before touching identity, so
    // a malformed request gets an honest 400 rather than a misleading 403.
    const expectedSeed = seedFor();
    const validation = validateSubmission(body, expectedSeed, todaysMinMoves());
    if (!validation.ok) {
        sendJson(res, 400, { ok: false, reason: validation.reason });
        return;
    }

    // The identity must have been issued by this server.
    if (!(await verifyGuidToken(guid, body.token))) {
        sendJson(res, 403, { ok: false, reason: 'unknown identity' });
        return;
    }

    try {
        const result = await submitScore(validation.value, timestamp());
        sendJson(res, 200, result);
    } catch (err) {
        console.error('[server] submit failed:', err);
        sendJson(res, 500, { ok: false, reason: 'server error' });
    }
}

async function handleRegister(req, res) {
    const ip = clientIp(req);
    const windowMs = config.rateLimitWindowSec * 1000;

    const limit = consume(`identity:ip:${ip}`, config.identityLimit, windowMs);
    if (!limit.allowed) {
        sendJson(res, 429, { ok: false, reason: 'too many registrations' },
            { 'Retry-After': String(limit.retryAfterSec) });
        return;
    }

    let body;
    try {
        body = await readJsonBody(req);
    } catch (err) {
        sendJson(res, err.statusCode || 400, { ok: false, reason: err.message });
        return;
    }

    const validation = validateRegistration(body);
    if (!validation.ok) {
        sendJson(res, 400, { ok: false, reason: validation.reason });
        return;
    }

    const identity = await issueIdentity(validation.value.name);
    sendJson(res, 200, {
        ok: true,
        guid: identity.guid,
        token: identity.token,
        name: identity.name,
    });
}

async function handleLeaderboard(req, res, url) {
    try {
        const snapshot = await leaderboardSnapshot();

        // When the player sends their GUID we also report their own slots, so
        // the client can show "first" / "best" state even when the player is
        // outside the top 10.
        const guid = url.searchParams.get('guid');
        if (guid && /^[A-Z2-9]{8}$/.test(guid)) {
            snapshot.me = await playerSlots(guid);
        }

        sendJson(res, 200, snapshot);
    } catch (err) {
        console.error('[server] leaderboard failed:', err);
        sendJson(res, 500, { ok: false, reason: 'server error' });
    }
}

/** Look up a player's own "first" and "best" entries for today. */
async function playerSlots(guid) {
    const today = dayKey();
    const entries = sortEntries(await loadDay(today));

    const result = { guid, first: null, best: null };
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.guid !== guid) continue;
        if (e.slot === 'first' && !result.first) {
            result.first = { timeMs: e.timeMs, rank: i + 1, submittedAt: e.submittedAt };
        } else if (e.slot === 'best' && !result.best) {
            result.best = { timeMs: e.timeMs, rank: i + 1, submittedAt: e.submittedAt };
        }
    }
    return result;
}

async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const cors = corsHeaders(req);

    if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, ...SECURITY_HEADERS });
        res.end();
        return;
    }

    // --- API -------------------------------------------------------------
    if (pathname === '/daily-seed') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(res, 405, { ok: false, reason: 'method not allowed' }, { Allow: 'GET, HEAD' });
            return;
        }
        const now = new Date();
        sendJson(res, 200, {
            date: dayKey(now),
            iso: timestamp(now),
            seed: seedFor(now),
            minMoves: todaysMinMoves(),
        }, cors);
        return;
    }

    if (pathname === '/daily-register') {
        if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, reason: 'method not allowed' }, { Allow: 'POST' });
            return;
        }
        await handleRegister(req, res);
        return;
    }

    if (pathname === '/daily-leaderboard') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(res, 405, { ok: false, reason: 'method not allowed' }, { Allow: 'GET, HEAD' });
            return;
        }
        await handleLeaderboard(req, res, url);
        return;
    }

    if (pathname === '/daily-submit') {
        if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, reason: 'method not allowed' }, { Allow: 'POST' });
            return;
        }
        await handleSubmit(req, res);
        return;
    }

    if (pathname === '/healthz') {
        sendJson(res, 200, {
            ok: true,
            uptime: Math.round(process.uptime()),
            storage: storage().kind,
        }, cors);
        return;
    }

    // --- static ----------------------------------------------------------
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { ok: false, reason: 'method not allowed' }, { Allow: 'GET, HEAD' });
        return;
    }

    if (pathname === '/') {
        const indexPath = path.join(config.webRoot, 'index.html');
        if (await sendFile(req, res, indexPath, { cacheControl: 'no-cache' })) return;
    }

    if (await serveStatic(req, res, pathname)) return;

    await sendNotFound(req, res);
}

export const server = http.createServer((req, res) => {
    const started = Date.now();

    res.on('finish', () => {
        if (!config.verbose && res.statusCode < 400) return;
        console.log(`${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started}ms)`);
    });

    handleRequest(req, res).catch((err) => {
        console.error('[server] unhandled error:', err);
        if (!res.headersSent) {
            sendJson(res, 500, { ok: false, reason: 'server error' });
        } else {
            res.end();
        }
    });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[server] port ${config.port} is already in use.`);
    } else {
        console.error('[server] error:', err);
    }
    process.exit(1);
});

/**
 * Start listening. Skipped when the module is imported by a test, which
 * starts the server itself so it can pick a free port and shut down cleanly.
 */
let started = false;

export function start() {
    if (started || server.listening) return server;
    started = true;

    initStorage().then(() => {
        server.listen(config.port, config.host, () => {
            console.log(`VoidFlippr listening on http://${config.host}:${config.port}`);
            console.log(`  web root:        ${config.webRoot}`);
            console.log(`  data dir:        ${config.dataDir}`);
            console.log(`  storage:         ${storage().kind}`);
            console.log(`  min moves/day:   ${todaysMinMoves()}`);
        });
    }).catch((err) => {
        console.error('[server] failed to start:', err.message);
        process.exit(1);
    });

    return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) start();

/** Close the server cleanly so systemd/docker restarts do not drop requests. */
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        console.log(`\n[server] ${signal} received, shutting down.`);
        closeStorage();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
    });
}