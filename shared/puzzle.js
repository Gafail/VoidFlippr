/**
 * Shared puzzle logic.
 *
 * This module is the single source of truth for how a board is generated and
 * how many moves are needed to solve it. Both the browser client and the
 * server import it, so the server can never disagree with the client about
 * what a given seed looks like.
 *
 * It is deliberately dependency-free so it can run in both environments.
 */

/** Board edge length. The daily leaderboard is tuned for 9x9. */
export const BOARD_SIZE = 9;

/** Number of seeded flips used to generate the daily puzzle. */
export const DAILY_STEPS = 15;

/** A click flips the tile itself and all 8 neighbours (including diagonals). */
export const FLIP_DIRECTIONS = [
    [0, 0], [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];

/** Deterministic pseudo-random number generator seeded by a number. */
export function seededRandom(s) {
    const x = Math.sin(s) * 10000;
    return x - Math.floor(x);
}

/**
 * Flip a tile and its neighbours in place.
 * @param {boolean[][]} board
 * @param {number} row
 * @param {number} col
 */
export function flipTiles(board, row, col) {
    for (const [dr, dc] of FLIP_DIRECTIONS) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < board.length && nc >= 0 && nc < board.length) {
            board[nr][nc] = !board[nr][nc];
        }
    }
}

/**
 * Build a puzzle by applying `steps` seeded flips to an all-front board.
 * The same seed and step count always produce the same board.
 *
 * @param {number} size
 * @param {number} steps
 * @param {number} seed
 * @returns {boolean[][]}
 */
export function generateBoard(size = BOARD_SIZE, steps = DAILY_STEPS, seed = 0) {
    const board = Array(size).fill(null).map(() => Array(size).fill(false));
    let s = seed;

    for (let i = 0; i < steps; i++) {
        const r = Math.floor(seededRandom(s++) * size);
        const c = Math.floor(seededRandom(s++) * size);
        flipTiles(board, r, c);
    }

    return board;
}

/**
 * Build the daily board for a given seed.
 * @param {number} seed
 * @param {number} size
 * @param {number} steps
 */
export function dailyBoard(seed, size = BOARD_SIZE, steps = DAILY_STEPS) {
    return generateBoard(size, steps, seed);
}

// ---------------------------------------------------------------------------
// Minimum-move solver
// ---------------------------------------------------------------------------

/**
 * Minimum number of clicks needed to turn a board into a single uniform
 * colour, solved exactly over GF(2).
 *
 * Clicking a tile toggles a fixed set of cells, so the whole game is a linear
 * system over GF(2): A*x = b, where x is the set of tiles to click. The
 * system is solved with Gaussian elimination; when the solution space has a
 * free dimension the null space is enumerated to find the true minimum.
 *
 * @param {boolean[][]} board
 * @returns {number} minimum clicks, or 0 if the board is already solved
 */
export function minimumMoves(board) {
    const size = board.length;
    const cells = size * size;

    // Row i of A holds the cells that a click on variable k toggles, so that
    // row i reads "the parity of clicks affecting cell i must equal b[i]".
    const rows = new Array(cells);
    for (let cell = 0; cell < cells; cell++) {
        const r = Math.floor(cell / size);
        const c = cell % size;
        let mask = 0n;
        for (const [dr, dc] of FLIP_DIRECTIONS) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
                mask |= 1n << BigInt(nr * size + nc);
            }
        }
        rows[cell] = mask;
    }

    let best = null;

    // The board may be solved to all-front or to all-back; take the better.
    for (const target of [false, true]) {
        const rhs = new Array(cells);
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                rhs[r * size + c] = (board[r][c] ? 1 : 0) ^ (target ? 1 : 0);
            }
        }

        const solution = solveSystem(rows, rhs, cells);
        if (!solution) continue;

        const { particular, basis, nullity } = solution;
        let bestWeight = weightOf(particular);
        let bestVector = particular;

        // Enumerate the null space to find the true minimum weight solution.
        const total = 1 << nullity;
        for (let mask = 0; mask < total; mask++) {
            const candidate = particular.slice();
            for (let i = 0; i < nullity; i++) {
                if (mask & (1 << i)) {
                    for (let k = 0; k < cells; k++) candidate[k] ^= basis[i][k];
                }
            }
            const w = weightOf(candidate);
            if (w < bestWeight) {
                bestWeight = w;
                bestVector = candidate;
            }
        }

        if (best === null || bestWeight < best.weight) {
            best = { weight: bestWeight, vector: bestVector };
        }
    }

    return best ? best.weight : 0;
}

/**
 * Solve A*x = rhs over GF(2) using Gauss-Jordan elimination.
 * @returns {{particular: number[], basis: number[][], nullity: number}|null}
 */
function solveSystem(rowsIn, rhsIn, cells) {
    const rows = rowsIn.slice();
    const rhs = rhsIn.slice();
    const where = new Array(cells).fill(-1);
    let rank = 0;

    for (let col = 0; col < cells && rank < cells; col++) {
        let sel = -1;
        for (let i = rank; i < cells; i++) {
            if ((rows[i] >> BigInt(col)) & 1n) {
                sel = i;
                break;
            }
        }
        if (sel === -1) continue;

        [rows[sel], rows[rank]] = [rows[rank], rows[sel]];
        [rhs[sel], rhs[rank]] = [rhs[rank], rhs[sel]];
        where[col] = rank;

        for (let i = 0; i < cells; i++) {
            if (i !== rank && ((rows[i] >> BigInt(col)) & 1n)) {
                rows[i] ^= rows[rank];
                rhs[i] ^= rhs[rank];
            }
        }
        rank++;
    }

    // A row of all zeros with a set right-hand side means no solution.
    for (let i = rank; i < cells; i++) {
        if (rows[i] === 0n && rhs[i] === 1) return null;
    }

    const freeCols = [];
    for (let col = 0; col < cells; col++) {
        if (where[col] === -1) freeCols.push(col);
    }

    // Particular solution: all free variables set to zero.
    const particular = new Array(cells).fill(0);
    for (let col = 0; col < cells; col++) {
        if (where[col] !== -1) particular[col] = rhs[where[col]];
    }

    // Null space basis: one vector per free variable.
    const basis = [];
    for (const free of freeCols) {
        const vector = new Array(cells).fill(0);
        vector[free] = 1;
        for (let col = 0; col < cells; col++) {
            if (where[col] === -1) continue;
            const rowIndex = where[col];
            let parity = rhs[rowIndex];
            for (const other of freeCols) {
                if (other !== free && vector[other] === 1 && ((rows[rowIndex] >> BigInt(other)) & 1n)) {
                    parity ^= 1;
                }
            }
            vector[col] = parity;
        }
        basis.push(vector);
    }

    return { particular, basis, nullity: freeCols.length };
}

function weightOf(vector) {
    let total = 0;
    for (let i = 0; i < vector.length; i++) total += vector[i];
    return total;
}

/**
 * The daily board for a seed, together with the minimum number of moves
 * needed to solve it. The minimum is a lower bound on how fast a score can
 * legitimately be, which is what the server uses to reject impossible times.
 *
 * @param {number} seed
 * @param {number} size
 * @param {number} steps
 * @returns {{board: boolean[][], minMoves: number}}
 */
export function dailyPuzzle(seed, size = BOARD_SIZE, steps = DAILY_STEPS) {
    const board = dailyBoard(seed, size, steps);
    return { board, minMoves: minimumMoves(board) };
}