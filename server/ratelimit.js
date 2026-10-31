/**
 * Simple in-memory rate limiting.
 *
 * A sliding window per key. This is enough for a single-process server and
 * keeps the deployment dependency-free. If you run several instances behind
 * a load balancer, put a shared limiter in front of them.
 */

/** key -> array of timestamps (ms) within the current window. */
const buckets = new Map();

/** Drop buckets that have gone quiet, so memory does not grow forever. */
function sweep(now, windowMs) {
    for (const [key, hits] of buckets) {
        const live = hits.filter((t) => now - t < windowMs);
        if (live.length === 0) {
            buckets.delete(key);
        } else {
            buckets.set(key, live);
        }
    }
}

let lastSweep = Date.now();

/**
 * Consume one unit from a key's allowance.
 *
 * @param {string} key
 * @param {number} limit   Maximum hits allowed in the window
 * @param {number} windowMs
 * @returns {{allowed: boolean, remaining: number, retryAfterSec: number}}
 */
export function consume(key, limit, windowMs) {
    const now = Date.now();

    if (now - lastSweep > 60_000) {
        sweep(now, windowMs);
        lastSweep = now;
    }

    const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);

    if (hits.length >= limit) {
        const oldest = hits[0];
        const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
        buckets.set(key, hits);
        return { allowed: false, remaining: 0, retryAfterSec };
    }

    hits.push(now);
    buckets.set(key, hits);

    return { allowed: true, remaining: limit - hits.length, retryAfterSec: 0 };
}

/** Clear all buckets. Used by tests. */
export function reset() {
    buckets.clear();
}