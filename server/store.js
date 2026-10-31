/**
 * Leaderboard storage.
 *
 * Two backends, chosen automatically:
 *
 *   sqlite  - the default. Uses node:sqlite (built into Node 22+, no npm
 *             dependency). Survives restarts and supports concurrent writers.
 *   json    - the fallback. One JSON file per UTC day, written atomically.
 *
 * Both expose the same interface, so the rest of the server does not care
 * which one is in use.
 *
 * Set STORAGE_BACKEND=json to force the file-based backend, or
 * STORAGE_BACKEND=sqlite to force SQLite.
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { config } from './config.js';
import { dayKey } from './daily.js';

/** Serialises all mutating operations within this process. */
let writeChain = Promise.resolve();

function withLock(fn) {
    const run = writeChain.then(fn, fn);
    // Keep the chain alive even if this operation rejects.
    writeChain = run.then(() => undefined, () => undefined);
    return run;
}

const DAY_FILE_RE = /^\d{8}\.json$/;

// ---------------------------------------------------------------------------
// SQLite backend
// ---------------------------------------------------------------------------

/**
 * Open the SQLite backend. Returns null if node:sqlite is unavailable.
 */
async function openSqlite() {
    let DatabaseSync;
    try {
        ({ DatabaseSync } = await import('node:sqlite'));
    } catch {
        return null;
    }

    await mkdir(config.dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(config.dataDir, 'leaderboard.db'));

    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS entries (
            day       TEXT    NOT NULL,
            guid      TEXT    NOT NULL,
            slot      TEXT    NOT NULL,
            name      TEXT    NOT NULL,
            time_ms   INTEGER NOT NULL,
            submitted_at TEXT  NOT NULL,
            PRIMARY KEY (day, guid, slot)
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_entries_day_time ON entries (day, time_ms)');

    const insert = db.prepare(`
        INSERT INTO entries (day, guid, slot, name, time_ms, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(day, guid, slot) DO UPDATE SET
            name = excluded.name,
            time_ms = excluded.time_ms,
            submitted_at = excluded.submitted_at
    `);
    const remove = db.prepare('DELETE FROM entries WHERE day = ? AND guid = ? AND slot = ?');
    const selectDay = db.prepare('SELECT guid, slot, name, time_ms, submitted_at FROM entries WHERE day = ?');
    const selectDayTimes = db.prepare('SELECT time_ms FROM entries WHERE day = ?');
    const selectDays = db.prepare('SELECT DISTINCT day FROM entries');
    const deleteDay = db.prepare('DELETE FROM entries WHERE day = ?');

    return {
        kind: 'sqlite',

        async loadDay(day) {
            const rows = selectDay.all(day);
            return rows.map((r) => ({
                guid: r.guid,
                slot: r.slot,
                name: r.name,
                timeMs: r.time_ms,
                submittedAt: r.submitted_at,
            }));
        },

        async saveDay(day, entries) {
            // Replace the whole day atomically: clear then insert.
            const run = db.prepare('BEGIN IMMEDIATE');
            run.run();
            try {
                deleteDay.run(day);
                for (const e of entries) {
                    insert.run(day, e.guid, e.slot, e.name, e.timeMs, e.submittedAt);
                }
                db.exec('COMMIT');
            } catch (err) {
                db.exec('ROLLBACK');
                throw err;
            }
        },

        async pruneStale(referenceDay) {
            const cutoff = dayBefore(referenceDay, config.retentionDays);
            for (const row of selectDays.all()) {
                if (row.day < cutoff) deleteDay.run(row.day);
            }
        },

        async countDay(day) {
            const rows = selectDayTimes.all(day);
            return rows.length;
        },

        close() {
            db.close();
        },
    };
}

// ---------------------------------------------------------------------------
// JSON backend
// ---------------------------------------------------------------------------

function openJson() {
    const dir = config.dataDir;

    function dayPath(day) {
        return path.join(dir, `${day}.json`);
    }

    return {
        kind: 'json',

        async loadDay(day) {
            try {
                const raw = await readFile(dayPath(day), 'utf8');
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed?.entries) ? parsed.entries : [];
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    console.error(`[leaderboard] failed to read ${day}:`, err.message);
                }
                return [];
            }
        },

        async saveDay(day, entries) {
            await mkdir(dir, { recursive: true });
            const target = dayPath(day);
            const tmp = `${target}.${process.pid}.tmp`;
            await writeFile(tmp, JSON.stringify({ entries }, null, 2), 'utf8');
            await rename(tmp, target);
        },

        async pruneStale(referenceDay) {
            const cutoff = dayBefore(referenceDay, config.retentionDays);
            let files;
            try {
                files = await readdir(dir);
            } catch (err) {
                if (err.code !== 'ENOENT') throw err;
                return;
            }
            await Promise.all(files.map(async (name) => {
                if (!DAY_FILE_RE.test(name)) return;
                if (name.slice(0, 8) >= cutoff) return;
                try {
                    await unlink(path.join(dir, name));
                } catch (err) {
                    if (err.code !== 'ENOENT') {
                        console.error(`[leaderboard] failed to prune ${name}:`, err.message);
                    }
                }
            }));
        },

        async countDay(day) {
            const entries = await this.loadDay(day);
            return entries.length;
        },

        close() {},
    };
}

/** The day key `n` days before the reference day, as YYYYMMDD. */
function dayBefore(referenceDay, days) {
    const d = new Date(
        `${referenceDay.slice(0, 4)}-${referenceDay.slice(4, 6)}-${referenceDay.slice(6, 8)}T00:00:00Z`
    );
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

let backend = null;

/** Open the configured storage backend. Idempotent. */
export async function initStorage() {
    if (backend) return backend;

    const requested = config.storageBackend;

    if (requested !== 'json') {
        backend = await openSqlite();
        if (backend) return backend;
        if (requested === 'sqlite') {
            throw new Error(
                'STORAGE_BACKEND=sqlite was requested but node:sqlite is unavailable. ' +
                'Node.js 22 or newer is required.'
            );
        }
        console.warn('[storage] node:sqlite unavailable, falling back to JSON files.');
    }

    backend = openJson();
    await mkdir(config.dataDir, { recursive: true });
    return backend;
}

/** The active backend. Throws if initStorage() has not run yet. */
export function storage() {
    if (!backend) throw new Error('initStorage() must be called before using storage.');
    return backend;
}

/** Close the backend, if it needs closing. */
export function closeStorage() {
    if (backend?.close) backend.close();
    backend = null;
}

/** Load a day's entries from the active backend. */
export async function loadDay(day) {
    return storage().loadDay(day);
}

/** Replace a day's entries in the active backend. */
export async function saveDay(day, entries) {
    return storage().saveDay(day, entries);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Entries sorted fastest first. */
export function sortEntries(entries) {
    return [...entries].sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Rank a player's entry. Rank is 1-based within the day's full entry list.
 * Returns null when the entry is not found.
 */
export function rankFor(entries, guid, slot) {
    const sorted = sortEntries(entries);
    const index = sorted.findIndex((e) => e.guid === guid && e.slot === slot);
    if (index === -1) return null;
    return { rank: index + 1, total: sorted.length };
}

/** Top 10 entries for display. */
export function topTen(entries) {
    return sortEntries(entries).slice(0, 10).map((e, i) => ({
        rank: i + 1,
        name: e.name,
        guid: e.guid,
        timeMs: e.timeMs,
        slot: e.slot,
    }));
}

/**
 * Record a score.
 *
 * Two slots per player per day:
 *   - "first" is locked in on the player's first submission and never changes.
 *   - "best" is created on the second submission and only updated when the
 *     new time is faster.
 *
 * @returns {Promise<{ok: boolean, accepted: boolean, reason?: string, rank?: number|null, total?: number, slot?: string, timeMs?: number}>}
 */
export async function submitScore({ guid, name, timeMs }, timestamp) {
    return withLock(async () => {
        const store = storage();
        const today = dayKey();
        await store.pruneStale(today);

        const entries = await store.loadDay(today);
        const existingFirst = entries.find((e) => e.guid === guid && e.slot === 'first') || null;
        const existingBest = entries.find((e) => e.guid === guid && e.slot === 'best') || null;

        // A player only gets a "first" slot if they do not already have one.
        const targetSlot = existingFirst ? 'best' : 'first';

        if (targetSlot === 'best' && existingBest && timeMs >= existingBest.timeMs) {
            const { rank, total } = rankFor(entries, guid, 'best');
            return {
                ok: true,
                accepted: false,
                reason: 'not an improvement',
                rank,
                total,
                slot: 'best',
                timeMs: existingBest.timeMs,
            };
        }

        const entry = {
            guid,
            name,
            timeMs,
            submittedAt: timestamp,
            slot: targetSlot,
        };

        // Replacing the best entry means removing the old one (self-cleaning).
        const kept = targetSlot === 'best' && existingBest
            ? entries.filter((e) => !(e.guid === guid && e.slot === 'best'))
            : entries;

        kept.push(entry);
        await store.saveDay(today, kept);

        const { rank, total } = rankFor(kept, guid, targetSlot);
        return {
            ok: true,
            accepted: true,
            improved: targetSlot === 'best',
            rank,
            total,
            slot: targetSlot,
            timeMs,
        };
    });
}

/** Snapshot for the leaderboard endpoint. */
export async function leaderboardSnapshot() {
    const store = storage();
    const today = dayKey();
    await store.pruneStale(today);
    const entries = await store.loadDay(today);
    const sorted = sortEntries(entries);
    return {
        date: today,
        total: sorted.length,
        top10: topTen(entries),
    };
}