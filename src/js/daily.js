/* Daily puzzle: fetches the server's UTC date + seed, exposes helpers. */

import { state } from './state.js';

export async function fetchDailyDate() {
    try {
        const response = await fetch('/daily-seed');
        if (!response.ok) throw new Error(`status ${response.status}`);
        const data = await response.json();
        state.utcDateStr = data.date;
        state.dailySeedValue = data.seed;
    } catch (e) {
        // Offline or server unavailable: fall back to the local UTC date so
        // the daily puzzle still plays, just without leaderboard validation.
        const now = new Date();
        state.utcDateStr = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
        state.dailySeedValue = parseInt('1' + state.utcDateStr, 10);
    }
}

export function getSeedFromURL() {
    const params = new URLSearchParams(window.location.search);
    const seedParam = params.get('seed');
    if (seedParam) {
        const parsed = parseInt(seedParam, 10);
        if (!isNaN(parsed)) return parsed;
    }
    return null;
}