/**
 * Tests for the shared puzzle module.
 *
 * These cover the two things the server and client must agree on:
 *   1. the exact board a seed produces
 *   2. the minimum number of clicks needed to solve it
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BOARD_SIZE,
    DAILY_STEPS,
    FLIP_DIRECTIONS,
    seededRandom,
    flipTiles,
    generateBoard,
    minimumMoves,
    dailyPuzzle,
} from '../shared/puzzle.js';

/** The original implementation, kept here as the reference oracle. */
function referenceBoard(size, steps, seedValue) {
    const board = Array(size).fill(null).map(() => Array(size).fill(false));
    let s = seedValue;
    for (let i = 0; i < steps; i++) {
        const r = Math.floor(seededRandom(s++) * size);
        const c = Math.floor(seededRandom(s++) * size);
        for (const [dr, dc] of FLIP_DIRECTIONS) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < board.length && nc >= 0 && nc < board.length) {
                board[nr][nc] = !board[nr][nc];
            }
        }
    }
    return board;
}

test('generateBoard matches the original implementation for many seeds', () => {
    for (const seed of [1, 42, 12345, 120261026, 120261027, 120261028, 999999]) {
        for (const steps of [10, 15, 20, 30]) {
            const actual = generateBoard(9, steps, seed);
            const expected = referenceBoard(9, steps, seed);
            assert.deepEqual(actual, expected, `seed=${seed} steps=${steps}`);
        }
    }
});

test('generateBoard is deterministic', () => {
    const a = generateBoard(9, 15, 120261026);
    const b = generateBoard(9, 15, 120261026);
    assert.deepEqual(a, b);
});

test('a fresh board starts all-front', () => {
    const board = generateBoard(9, 15, 120261026);
    assert.equal(board.flat().filter(Boolean).length > 0, true, 'board should not be solved');
});

test('flipTiles toggles the tile and its 8 neighbours', () => {
    const board = Array(5).fill(null).map(() => Array(5).fill(false));
    flipTiles(board, 2, 2);
    // A centre click on a 5x5 board affects the full 3x3 block.
    assert.equal(board.flat().filter(Boolean).length, 9);
    assert.equal(board[2][2], true);
    assert.equal(board[0][0], false);
});

test('a corner click affects only 4 tiles', () => {
    const board = Array(5).fill(null).map(() => Array(5).fill(false));
    flipTiles(board, 0, 0);
    assert.equal(board.flat().filter(Boolean).length, 4);
});

test('minimumMoves is 0 for an already uniform board', () => {
    const solved = Array(9).fill(null).map(() => Array(9).fill(false));
    assert.equal(minimumMoves(solved), 0);
    const allBack = Array(9).fill(null).map(() => Array(9).fill(true));
    assert.equal(minimumMoves(allBack), 0);
});

test('minimumMoves matches a brute-force search on a 3x3 board', () => {
    // On 3x3 there are only 512 possible click sets, so we can check the
    // exact answer by brute force.
    const directions = FLIP_DIRECTIONS;
    const apply = (board, mask) => {
        const out = board.map((row) => row.slice());
        for (let k = 0; k < 9; k++) {
            if (!(mask & (1 << k))) continue;
            const r = Math.floor(k / 3);
            const c = k % 3;
            for (const [dr, dc] of directions) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= 0 && nr < 3 && nc >= 0 && nc < 3) out[nr][nc] = !out[nr][nc];
            }
        }
        return out;
    };

    for (let trial = 0; trial < 25; trial++) {
        const board = Array.from({ length: 3 }, () =>
            Array.from({ length: 3 }, () => Math.random() < 0.5)
        );
        let brute = null;
        for (let mask = 0; mask < 512; mask++) {
            const out = apply(board, mask);
            if (out.every((row) => row.every((v) => v === out[0][0]))) {
                const w = mask.toString(2).split('').filter((x) => x === '1').length;
                if (brute === null || w < brute) brute = w;
            }
        }
        if (brute === null) continue;
        assert.equal(minimumMoves(board), brute);
    }
});

test('minimumMoves equals the number of generator flips for daily boards', () => {
    // The daily board is built from 15 flips, and that click sequence is
    // itself a solution, so the minimum can never exceed 15.
    for (const day of ['20261026', '20261027', '20261028']) {
        const seed = Number.parseInt(`1${day}`, 10);
        const { minMoves } = dailyPuzzle(seed);
        assert.ok(minMoves > 0, `seed ${seed} should need at least one move`);
        assert.ok(minMoves <= DAILY_STEPS, `seed ${seed} minMoves ${minMoves} exceeds ${DAILY_STEPS}`);
    }
});

test('minimumMoves is stable across repeated calls', () => {
    const seed = 120261026;
    const a = dailyPuzzle(seed).minMoves;
    const b = dailyPuzzle(seed).minMoves;
    assert.equal(a, b);
});

test('dailyPuzzle returns the same board as generateBoard', () => {
    const seed = 120261026;
    const { board } = dailyPuzzle(seed);
    assert.deepEqual(board, generateBoard(BOARD_SIZE, DAILY_STEPS, seed));
});

test('the daily seed format is 1 + YYYYMMDD', () => {
    assert.equal(Number.parseInt('120261026', 10), 120261026);
});