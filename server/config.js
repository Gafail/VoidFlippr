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

/** First existing directory from the candidate list, relative to ROOT. */
function firstExistingDir(...candidates) {
    for (const candidate of candidates) {
        const abs = path.resolve(ROOT, candidate);
        if (existsSync(abs) && statSync(abs).isDirectory()) return abs;
    }
    return path.resolve(ROOT, 'src');
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

    /** Where the per-day leaderboard JSON files live. */
    leaderboardDir: path.resolve(ROOT, process.env.LEADERBOARD_DIR || 'leaderboard'),

    /** Days of leaderboard history to keep before pruning. */
    retentionDays: intEnv('LEADERBOARD_RETENTION_DAYS', 7),

    /** Max accepted JSON body size for score submissions. */
    maxBodyBytes: intEnv('MAX_BODY_BYTES', 16 * 1024),

    /** Log every request to stdout (disable for quieter container logs). */
    verbose: process.env.VERBOSE === '1' || process.env.VERBOSE === 'true',
};

export default config;