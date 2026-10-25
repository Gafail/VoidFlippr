/* All `let` globals that used to be at the top of the inline <script>.
   One place to look for state; everything else imports from here. */

import { formatBestTime } from './util.js';

export const state = {
    // Board
    gridSize: 9,
    board: [],
    initialBoard: [],
    seed: 0,
    optimalMoves: 0,
    playerMoves: 0,

    // Timer
    timerInterval: null,
    startTime: null,
    gameStarted: false,
    finalElapsedMs: 0,

    // Theme / audio
    tileFrontColor: '#ffffff',
    tileBackColor: '#1a1a2e',
    soundEnabled: true,
    audioContext: null,

    // Mode
    isDaily: false,
    currentDifficulty: 'medium',

    // Daily / leaderboard
    utcDateStr: null,
    dailySeedValue: null,
    lbCache: null,
    lastSubmissionResult: null,

    // Identity
    playerName: null,
    playerGuid: null,
};

// --- localStorage wrappers ---

/** localStorage can be unavailable (private mode) or hold corrupt JSON. */
function readStore(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (e) {
        return fallback;
    }
}

function writeStore(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        return false;
    }
}

export function getBestTime(difficulty) {
    const times = readStore('voidflippr_best_times', {});
    return times[difficulty] || null;
}

export function saveBestTime(difficulty, time) {
    const times = readStore('voidflippr_best_times', {});
    if (!times[difficulty] || time < times[difficulty]) {
        times[difficulty] = time;
        writeStore('voidflippr_best_times', times);
        return true;
    }
    return false;
}

export function updateBestTimes() {
    const difficulties = ['easy', 'medium', 'hard'];
    difficulties.forEach(diff => {
        const best = getBestTime(diff);
        const el = document.getElementById('best' + diff.charAt(0).toUpperCase() + diff.slice(1));
        if (!el) return;
        el.textContent = best ? `Best: ${formatBestTime(best)}` : '';
    });
}