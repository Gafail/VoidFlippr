/* Leaderboard: fetches top-10 from server, renders the home-screen block,
   and submits scores. */

import { state } from './state.js';
import { escapeHtml, formatElapsed } from './util.js';

export async function fetchLeaderboard() {
    try {
        // Sending the GUID lets the server include our own slots in the
        // response, which the submit UI needs when we are outside the top 10.
        const guid = state.playerGuid ? `?guid=${encodeURIComponent(state.playerGuid)}` : '';
        const response = await fetch(`/daily-leaderboard${guid}`);
        if (!response.ok) return null;
        const data = await response.json();
        state.lbCache = data;
        return data;
    } catch (e) {
        return null;
    }
}

export function renderLeaderboard(data) {
    const dateEl = document.getElementById('lbDate');
    const body = document.getElementById('leaderboardBody');
    if (dateEl && state.utcDateStr) {
        const y = state.utcDateStr.slice(0, 4);
        const m = state.utcDateStr.slice(4, 6);
        const d = state.utcDateStr.slice(6, 8);
        dateEl.textContent = `${y}-${m}-${d}`;
    }
    if (!body) return;
    if (!data) {
        body.innerHTML = '<div class="leaderboard-empty">Leaderboard unavailable</div>';
        return;
    }
    if (!data.top10 || data.top10.length === 0) {
        body.innerHTML = '<div class="leaderboard-empty">No submissions yet — be the first!</div>';
        return;
    }
    const rows = data.top10.map(e => {
        const slotLabel = e.slot === 'first' ? 'First' : 'Best';
        const slotClass = e.slot;
        const me = (state.playerGuid && e.guid === state.playerGuid) ? ' me' : '';
        return `<li class="lb-row${me}">
            <span class="lb-rank">${e.rank}</span>
            <span class="lb-name">${escapeHtml(e.name)}<span class="lb-guid">${escapeHtml(e.guid)}</span><span class="lb-slot ${slotClass}">${slotLabel}</span></span>
            <span class="lb-time">${formatElapsed(e.timeMs)}</span>
        </li>`;
    }).join('');
    body.innerHTML = `<ul class="leaderboard-list">${rows}</ul>`;
}

export async function loadLeaderboard() {
    const data = await fetchLeaderboard();
    renderLeaderboard(data);
}

export async function submitDailyScore(slotHint) {
    if (!state.playerGuid || !state.playerName) return null;
    if (!state.dailySeedValue) {
        const { fetchDailyDate } = await import('./daily.js');
        await fetchDailyDate();
    }
    try {
        const response = await fetch('/daily-submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                guid: state.playerGuid,
                name: state.playerName,
                seed: state.dailySeedValue,
                timeMs: state.finalElapsedMs,
                slotHint,
            }),
        });
        return await response.json();
    } catch (e) {
        return { ok: false, reason: 'network error' };
    }
}

/**
 * The player's own entries for today.
 * Prefers the server-provided `me` block; falls back to scanning the top 10
 * for older servers that do not send it.
 */
export function findMyEntries() {
    if (!state.lbCache) return { first: null, best: null };

    const me = state.lbCache.me;
    if (me && typeof me === 'object') {
        return {
            first: me.first || null,
            best: me.best || null,
        };
    }

    let first = null;
    let best = null;
    for (const e of state.lbCache.top10 || []) {
        if (!state.playerGuid || e.guid !== state.playerGuid) continue;
        if (e.slot === 'first' && !first) first = e;
        if (e.slot === 'best' && !best) best = e;
    }
    return { first, best };
}