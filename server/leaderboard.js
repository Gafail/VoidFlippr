/**
 * Leaderboard storage.
 *
 * One JSON file per UTC day (leaderboard/YYYYMMDD.json). Writes are atomic
 * (write to a temp file, then rename) and serialised through a promise chain
 * so concurrent submissions can never interleave and corrupt a day's file.
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { config } from './config.js';
import { dayKey } from './daily.js';

/** Serialises all mutating operations. */
let writeChain = Promise.resolve();

function withLock(fn) {
    const run = writeChain.then(fn, fn);
    // Keep the chain alive even if this operation rejects.
    writeChain = run.then(() => undefined, () => undefined);
    return run;
}

function dayPath(day) {
    return path.join(config.leaderboardDir, `${day}.json`);
}

const DAY_FILE_RE = /^\d{8}\.json$/;

/** Load a day's entries. Missing or corrupt files read as empty. */
export async function loadDay(day) {
    try {
        const raw = await readFile(dayPath(day), 'utf8');
        const parsed = JSON.parse(raw);
        const entries = parsed?.entries;
        if (!Array.isArray(entries)) return [];
        return entries;
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error(`[leaderboard] failed to read ${day}:`, err.message);
        }
        return [];
    }
}

/** Atomically persist a day's entries. */
async function saveDay(day, entries) {
    await mkdir(config.leaderboardDir, { recursive: true });
    const target = dayPath(day);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ entries }, null, 2), 'utf8');
    await rename(tmp, target);
}

/**
 * Delete day files older than the retention window.
 * The current day is never removed.
 */
async function pruneStale(referenceDay = dayKey()) {
    const cutoff = new Date(`${referenceDay.slice(0, 4)}-${referenceDay.slice(4, 6)}-${referenceDay.slice(6, 8)}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - config.retentionDays);

    let files;
    try {
        files = await readdir(config.leaderboardDir);
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        return;
    }

    await Promise.all(files.map(async (name) => {
        if (!DAY_FILE_RE.test(name)) return;
        const stamp = new Date(`${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}T00:00:00Z`);
        if (Number.isNaN(stamp.getTime()) || stamp >= cutoff) return;
        try {
            await unlink(path.join(config.leaderboardDir, name));
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error(`[leaderboard] failed to prune ${name}:`, err.message);
            }
        }
    }));
}

/** Entries sorted fastest first. */
export function sortEntries(entries) {
    return [...entries].sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Rank a player's entry. Returns null when the entry is not found.
 * Rank is 1-based within the day's full entry list.
 */
function rankFor(entries, guid, slot) {
    const sorted = sortEntries(entries);
    const index = sorted.findIndex((e) => e.guid === guid && e.slot === slot);
    if (index === -1) return null;
    return { rank: index + 1, total: sorted.length };
}

/** Top 10 entries for display. */
function topTen(entries) {
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
        const today = dayKey();
        await pruneStale(today);

        const entries = await loadDay(today);
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
        await saveDay(today, kept);

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
    const today = dayKey();
    await pruneStale(today);
    const entries = await loadDay(today);
    const sorted = sortEntries(entries);
    return {
        date: today,
        total: sorted.length,
        top10: topTen(entries),
    };
}