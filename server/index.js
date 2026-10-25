/**
 * VoidFlippr HTTP server.
 *
 * Responsibilities:
 *   - serve the built game (dist/) or the raw source tree (src/)
 *   - expose the daily puzzle seed
 *   - accept and validate score submissions
 *   - serve the top-10 daily leaderboard
 *
 * Runs on any host with Node.js 18+ and no external dependencies.
 */
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, stat } from 'node:fs/promises';

import { config } from './config.js';
import { dayKey, seedFor, timestamp } from './daily.js';
import { leaderboardSnapshot, submitScore } from './leaderboard.js';
import { resolveSafePath, sendFile } from './static.js';
import { validateSubmission } from './validate.js';

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function sendJson(res, status, payload, extraHeaders = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
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

/** True when the client asked for a JSON response. */
function wantsJson(req) {
    const accept = req.headers.accept || '';
    return accept.includes('application/json');
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
 * fallback, because that would expose package.json, server source and other
 * non-public files over HTTP.
 */
async function serveStatic(req, res, urlPath) {
    const filePath = await resolveSafePath(config.webRoot, urlPath);
    if (!filePath) return false;

    // Asset filenames are not content-hashed, so revalidate rather than cache
    // aggressively - a deploy should be picked up immediately.
    const cacheControl = filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=300';
    return sendFile(req, res, filePath, { cacheControl });
}

async function handleSubmit(req, res) {
    let body;
    try {
        body = await readJsonBody(req);
    } catch (err) {
        sendJson(res, err.statusCode || 400, { ok: false, reason: err.message });
        return;
    }

    const expectedSeed = seedFor();
    const validation = validateSubmission(body, expectedSeed);
    if (!validation.ok) {
        sendJson(res, 400, { ok: false, reason: validation.reason });
        return;
    }

    try {
        const result = await submitScore(validation.value, expectedSeed, timestamp());
        sendJson(res, 200, result);
    } catch (err) {
        console.error('[server] submit failed:', err);
        sendJson(res, 500, { ok: false, reason: 'server error' });
    }
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
    const { loadDay, sortEntries } = await import('./leaderboard.js');
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

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            ...SECURITY_HEADERS,
        });
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
        });
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
        sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
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
    server.listen(config.port, config.host, () => {
        console.log(`VoidFlippr listening on http://${config.host}:${config.port}`);
        console.log(`  web root:        ${config.webRoot}`);
        console.log(`  leaderboard dir: ${config.leaderboardDir}`);
    });
    return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) start();

/** Close the server cleanly so systemd/docker restarts do not drop requests. */
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        console.log(`\n[server] ${signal} received, shutting down.`);
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
    });
}