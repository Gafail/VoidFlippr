/**
 * Runtime configuration for the VoidFlippr server.
 *
 * Everything is environment-driven so the exact same build can be dropped onto
 * any host (a VPS, a container platform, a PaaS) without touching code.
 */
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Project root: the directory that contains package.json. */
export const ROOT = path.resolve(SERVER_DIR, '..');

function intEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    return raw === '1' || raw.toLowerCase() === 'true';
}

/** First existing directory from the candidate list, relative to ROOT. */
function firstExistingDir(...candidates) {
    for (const candidate of candidates) {
        const abs = path.resolve(ROOT, candidate);
        if (existsSync(abs) && statSync(abs).isDirectory()) return abs;
    }
    return path.resolve(ROOT, 'src');
}

/**
 * Extra browser origins allowed to call the API.
 * Empty by default: the game is served from the same origin as the API, so
 * cross-origin access is not needed and is denied.
 */
function allowedOrigins() {
    const raw = process.env.ALLOWED_ORIGINS || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
    /** Absolute path to the project root. */
    root: ROOT,

    /** TCP port. PORT is the de-facto standard used by most hosts. */
    port: intEnv('PORT', intEnv('VOIDFLIPPR_PORT', 9865)),

    /** Bind address. 0.0.0.0 for containers; set 127.0.0.1 behind a reverse proxy. */
    host: process.env.HOST || '0.0.0.0',

    /** Built assets if present, otherwise the raw source tree (dev mode). */
    webRoot: firstExistingDir('dist', 'src'),

    /**
     * Static site-root assets: icons, manifest, robots.txt.
     * Served from the project root in dev and from public/ in production.
     */
    publicDir: path.resolve(ROOT, 'public'),

    /**
     * Where leaderboard data is stored. Point this at a persistent volume on
     * hosts with an ephemeral filesystem, otherwise scores are lost on
     * restart or redeploy.
     */
    dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),

    /** 'auto' picks SQLite when available, 'json' forces per-day files. */
    storageBackend: (process.env.STORAGE_BACKEND || 'auto').toLowerCase(),

    /** Days of leaderboard history to keep before pruning. */
    retentionDays: intEnv('LEADERBOARD_RETENTION_DAYS', 7),

    /** Max accepted JSON body size for score submissions. */
    maxBodyBytes: intEnv('MAX_BODY_BYTES', 16 * 1024),

    /** Log every request to stdout (disable for quieter container logs). */
    verbose: boolEnv('VERBOSE'),

    // --- anti-cheat --------------------------------------------------------

    /**
     * Reject submitted times that are faster than physically possible.
     * The floor is derived from the true minimum move count for the day's
     * board, times this many milliseconds per move.
     *
     * 500ms is the baseline: fast enough for a quick player, slow enough that
     * a script cannot claim an instant solve. Raise it to make the
     * leaderboard stricter, lower it to welcome speedrunners.
     */
    minMsPerMove: intEnv('MIN_MS_PER_MOVE', 500),

    /**
     * When true, the server refuses any submission faster than the computed
     * minimum. When false, such submissions are accepted but not ranked.
     */
    enforceMinTime: boolEnv('ENFORCE_MIN_TIME', true),

    /**
     * Hard floor on a submission, independent of the puzzle. 1 second.
     */
    minTimeMs: intEnv('MIN_TIME_MS', 1000),

    /** Maximum plausible completion time: 30 minutes. */
    maxTimeMs: intEnv('MAX_TIME_MS', 1_800_000),

    /**
     * Rate limit: submissions allowed per IP per window. Deliberately
     * generous, because many players can share one address.
     */
    submitLimit: intEnv('RATE_LIMIT_SUBMIT', 60),

    /** Rate limit: submissions allowed per player identity per window. */
    submitGuidLimit: intEnv('RATE_LIMIT_SUBMIT_GUID', 20),

    /** Rate limit: identity registrations allowed per IP per window. */
    identityLimit: intEnv('RATE_LIMIT_IDENTITY', 30),

    /** Rate limit window in seconds. */
    rateLimitWindowSec: intEnv('RATE_LIMIT_WINDOW_SEC', 60),

    /**
     * Trust X-Forwarded-For for client IP detection. Enable only when the
     * server sits behind a proxy you control (nginx, Cloudflare).
     */
    trustProxy: boolEnv('TRUST_PROXY'),

    /**
     * Secret used to sign identity tokens. When unset, a secret is generated
     * and cached in the data directory so it survives restarts.
     */
    identitySecret: process.env.IDENTITY_SECRET || null,

    /** Extra browser origins allowed to call the API. */
    allowedOrigins: allowedOrigins(),
};

export default config;