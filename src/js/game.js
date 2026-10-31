/* Game mechanics: board generation, tile flipping, timer, win detection. */

import { state, saveBestTime } from './state.js';
import { formatElapsed } from './util.js';
import { BOARD_SIZE, DAILY_STEPS, generateBoard, flipTiles } from '../../shared/puzzle.js';
import { playClickSound, playWinSound } from './audio.js';
import { showScreen, renderSubmitSection } from './ui.js';
import { fetchDailyDate, getSeedFromURL } from './daily.js';
import { loadLeaderboard } from './leaderboard.js';

const FLIP_DIRECTIONS = [
    [0, 0], [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]
];

function renderBoard() {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;
    boardEl.style.gridTemplateColumns = `repeat(${state.gridSize}, 1fr)`;
    boardEl.innerHTML = '';

    for (let r = 0; r < state.gridSize; r++) {
        for (let c = 0; c < state.gridSize; c++) {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = `tile ${state.board[r][c] ? 'back' : 'front'}`;
            tile.dataset.row = r;
            tile.dataset.col = c;
            tile.onclick = () => handleTileClick(r, c);
            boardEl.appendChild(tile);
        }
    }
}

function handleTileClick(row, col) {
    if (!state.gameStarted) {
        state.gameStarted = true;
        startTimer();
    }

    playClickSound();
    flipTiles(state.board, row, col);
    state.playerMoves++;

    // Repaint only the tiles this click actually changed.
    const boardEl = document.getElementById('board');
    if (boardEl) {
        for (const [dr, dc] of FLIP_DIRECTIONS) {
            const r = row + dr;
            const c = col + dc;
            if (r < 0 || r >= state.gridSize || c < 0 || c >= state.gridSize) continue;
            const tile = boardEl.querySelector(`.tile[data-row="${r}"][data-col="${c}"]`);
            if (!tile) continue;
            tile.className = `tile ${state.board[r][c] ? 'back' : 'front'}`;
            tile.classList.add('pop');
            setTimeout(() => tile.classList.remove('pop'), 200);
        }
    }

    updateStats();

    if (checkWin()) {
        endGame();
    }
}

function updateStats() {
    const movesEl = document.getElementById('playerMoves');
    if (movesEl) movesEl.textContent = state.playerMoves;
}

/** Win when every tile matches the first tile's colour (all front or all back). */
function checkWin() {
    if (!state.board.length) return false;
    const first = state.board[0][0];
    return state.board.every(row => row.every(cell => cell === first));
}

function startTimer() {
    state.startTime = Date.now();
    stopTimer();
    state.timerInterval = setInterval(updateTimer, 100);
}

function updateTimer() {
    if (!state.startTime) return;
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.textContent = formatElapsed(Date.now() - state.startTime);
}

export function stopTimer() {
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
    }
}

export function formatTime() {
    return formatElapsed(state.finalElapsedMs);
}

export function getElapsedTime() {
    return state.finalElapsedMs;
}

export function startGame(steps, dailySeed = null) {
    state.gridSize = BOARD_SIZE;
    state.isDaily = !!dailySeed;

    let seedValue = dailySeed;
    if (!seedValue) {
        const urlSeed = getSeedFromURL();
        if (urlSeed !== null) {
            seedValue = urlSeed;
            const seedInput = document.getElementById('puzzleSeed');
            if (seedInput) seedInput.value = urlSeed;
            const url = new URL(window.location.href);
            url.searchParams.delete('seed');
            window.history.replaceState({}, '', url);
        } else {
            const seedInput = document.getElementById('puzzleSeed');
            const raw = seedInput ? seedInput.value : '';
            const parsed = parseInt(raw, 10);
            seedValue = raw && !isNaN(parsed) ? parsed : Math.floor(Math.random() * 999999);
        }
    }

    state.seed = seedValue;
    state.board = generateBoard(state.gridSize, steps, seedValue);
    state.initialBoard = JSON.parse(JSON.stringify(state.board));
    state.optimalMoves = steps;
    state.playerMoves = 0;
    state.gameStarted = false;

    if (steps === 10) state.currentDifficulty = 'easy';
    else if (steps === 20) state.currentDifficulty = 'medium';
    else if (steps === 30) state.currentDifficulty = 'hard';
    else state.currentDifficulty = 'custom';

    const seedDisplay = document.getElementById('seedDisplay');
    if (seedDisplay) {
        seedDisplay.textContent = state.isDaily ? `Daily #${state.seed}` : `Seed: ${state.seed}`;
    }
    const optimalEl = document.getElementById('optimalMoves');
    if (optimalEl) optimalEl.textContent = state.optimalMoves;
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.textContent = '00:00.00';

    stopTimer();
    renderBoard();
    showScreen('gameScreen');
}

export async function startDaily() {
    if (!state.dailySeedValue) await fetchDailyDate();
    state.lastSubmissionResult = null;
    startGame(DAILY_STEPS, state.dailySeedValue);
}

export function startCustom() {
    const input = document.getElementById('customFlips');
    const flips = parseInt(input ? input.value : '', 10);
    const clampedFlips = Math.max(1, Math.min(100, isNaN(flips) ? 10 : flips));
    if (input) input.value = clampedFlips;
    startGame(clampedFlips);
}

export function restartGame() {
    state.board = JSON.parse(JSON.stringify(state.initialBoard));
    state.playerMoves = 0;
    state.gameStarted = false;
    state.finalElapsedMs = 0;
    stopTimer();
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.textContent = '00:00.00';
    updateStats();
    renderBoard();
    const winModal = document.getElementById('winModal');
    if (winModal) winModal.classList.remove('active');
}

export function goHome() {
    stopTimer();
    state.playerMoves = 0;
    state.gameStarted = false;
    state.finalElapsedMs = 0;
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.textContent = '00:00.00';
    updateStats();
    const winModal = document.getElementById('winModal');
    if (winModal) winModal.classList.remove('active');
    showScreen('homeScreen');
    loadLeaderboard();
}

export function endGame() {
    stopTimer();
    state.finalElapsedMs = state.startTime ? Date.now() - state.startTime : 0;
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.textContent = formatElapsed(state.finalElapsedMs);
    playWinSound();

    const elapsed = state.finalElapsedMs;
    const isNewRecord = !state.isDaily && saveBestTime(state.currentDifficulty, elapsed);

    const finalTime = document.getElementById('finalTime');
    const finalMoves = document.getElementById('finalMoves');
    const finalOptimal = document.getElementById('finalOptimal');
    if (finalTime) finalTime.textContent = formatTime();
    if (finalMoves) finalMoves.textContent = state.playerMoves;
    if (finalOptimal) finalOptimal.textContent = state.optimalMoves;

    const newRecord = document.getElementById('newRecord');
    const winTitle = document.getElementById('winTitle');

    if (winTitle) {
        winTitle.textContent = state.isDaily ? 'Daily Complete!' : 'Puzzle Solved!';
    }
    if (newRecord) {
        newRecord.style.display = isNewRecord ? 'block' : 'none';
    }

    state.lastSubmissionResult = null;
    if (state.isDaily) {
        loadLeaderboard().then(() => renderSubmitSection());
    } else {
        const submitSection = document.getElementById('submitSection');
        if (submitSection) submitSection.style.display = 'none';
    }

    const winModal = document.getElementById('winModal');
    if (winModal) winModal.classList.add('active');
}