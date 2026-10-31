/**
 * Validation rules for incoming score submissions.
 *
 * The server never trusts the client: every field is re-validated here before
 * anything is written to the database.
 */
import { config } from './config.js';

/** GUIDs are 8 characters from A-Z and 2-9. */
export const GUID_RE = /^[A-Z2-9]{8}$/;

/** Display names are 1-20 characters: letters, digits, space, underscore, dash. */
export const NAME_RE = /^[A-Za-z0-9 _-]{1,20}$/;

/** Minimum plausible completion time. */
export const MIN_TIME_MS = 1000;

/** Maximum plausible completion time: 30 minutes. */
export const MAX_TIME_MS = 1_800_000;

/** The two leaderboard slots a player can occupy on a given day. */
export const SLOTS = ['first', 'best'];

/**
 * The fastest time a player could legitimately finish, given the number of
 * moves they claim to have made.
 *
 * Every solution needs at least `minMoves` clicks, and a human cannot click
 * faster than `minMsPerMove` milliseconds per click. A claim below this is
 * physically impossible and is rejected.
 *
 * @param {number} minMoves Minimum clicks needed to solve the board
 * @param {number} claimedMoves Moves the player says they made
 * @returns {number} milliseconds
 */
export function minimumPlausibleTime(minMoves, claimedMoves) {
    const perMove = Math.max(1, config.minMsPerMove);
    const moves = Math.max(minMoves, claimedMoves);
    return Math.max(MIN_TIME_MS, moves * perMove);
}

/**
 * Validate a raw submission body.
 *
 * @param {object} body
 * @param {number} expectedSeed
 * @param {number} minMoves Minimum clicks needed to solve today's board
 * @returns {{ok: true, value: object} | {ok: false, reason: string}}
 */
export function validateSubmission(body, expectedSeed, minMoves = 0) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, reason: 'invalid body' };
    }

    const guid = body.guid;
    const name = body.name;
    const seed = body.seed;
    const timeMs = body.timeMs;
    const moves = body.moves;

    if (typeof guid !== 'string' || !GUID_RE.test(guid)) {
        return { ok: false, reason: 'invalid guid' };
    }

    if (typeof name !== 'string' || !NAME_RE.test(name.trim())) {
        return { ok: false, reason: 'invalid name' };
    }

    if (!Number.isInteger(seed) || seed !== expectedSeed) {
        return { ok: false, reason: 'seed mismatch' };
    }

    if (!Number.isInteger(timeMs) || timeMs < MIN_TIME_MS || timeMs > MAX_TIME_MS) {
        return { ok: false, reason: 'time out of range' };
    }

    // The player must report how many moves they made. It has to be at least
    // the true minimum, otherwise the claim is impossible.
    if (!Number.isInteger(moves) || moves < minMoves || moves > 1000) {
        return { ok: false, reason: 'implausible move count' };
    }

    // And the time has to be consistent with those moves.
    const floor = minimumPlausibleTime(minMoves, moves);
    if (timeMs < floor) {
        return { ok: false, reason: 'time below minimum possible' };
    }

    let slotHint = body.slotHint;
    if (!SLOTS.includes(slotHint)) slotHint = '';

    return {
        ok: true,
        value: {
            guid,
            name: name.trim(),
            seed,
            timeMs,
            moves,
            slotHint,
        },
    };
}