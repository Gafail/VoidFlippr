/**
 * Validation rules for incoming score submissions.
 *
 * The server never trusts the client: every field is re-validated here before
 * anything is written to disk.
 */

/** GUIDs are 8 characters from A-Z and 2-9. */
export const GUID_RE = /^[A-Z2-9]{8}$/;

/** Display names are 1-20 characters: letters, digits, space, underscore, dash. */
export const NAME_RE = /^[A-Za-z0-9 _-]{1,20}$/;

/** Minimum plausible completion time: 1 second. */
export const MIN_TIME_MS = 1_000;

/** Maximum plausible completion time: 30 minutes. */
export const MAX_TIME_MS = 1_800_000;

/** The two leaderboard slots a player can occupy on a given day. */
export const SLOTS = ['first', 'best'];

/**
 * Validate a raw submission body.
 * @returns {{ok: true, value: object} | {ok: false, reason: string}}
 */
export function validateSubmission(body, expectedSeed) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, reason: 'invalid body' };
    }

    const guid = body.guid;
    const name = body.name;
    const seed = body.seed;
    const timeMs = body.timeMs;

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

    let slotHint = body.slotHint;
    if (!SLOTS.includes(slotHint)) slotHint = '';

    return {
        ok: true,
        value: {
            guid,
            name: name.trim(),
            seed,
            timeMs,
            slotHint,
        },
    };
}