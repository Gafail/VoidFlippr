/**
 * Daily puzzle helpers: the UTC day key, the timestamp format, and the seed.
 *
 * The seed is derived from the UTC date so every player worldwide gets the
 * exact same puzzle on the same day, and the leaderboard resets at midnight.
 */

/** UTC day key as YYYYMMDD, e.g. "20261026". */
export function dayKey(date = new Date()) {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/** UTC timestamp without milliseconds, e.g. "2026-10-26T12:07:00Z". */
export function timestamp(date = new Date()) {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Numeric seed for a given day. */
export function seedFor(date = new Date()) {
    return Number.parseInt(`1${dayKey(date)}`, 10);
}