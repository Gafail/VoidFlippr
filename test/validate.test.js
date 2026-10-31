/**
 * Validation tests for the submission rules.
 *
 * Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateSubmission, GUID_RE, NAME_RE, MIN_TIME_MS, MAX_TIME_MS } from '../server/validate.js';

const SEED = 120261025;

/**
 * The daily board needs at least this many clicks, and no human clicks
 * faster than MIN_MS_PER_MOVE.
 */
const MIN_MOVES = 15;
const MIN_TIME = MIN_MOVES * 1200;

const valid = {
    guid: 'ABCDEFGH',
    name: 'Alice',
    seed: SEED,
    timeMs: MIN_TIME + 5000,
    moves: MIN_MOVES,
    slotHint: 'first',
};

test('accepts a well-formed submission', () => {
    const result = validateSubmission(valid, SEED, MIN_MOVES);
    assert.equal(result.ok, true);
    assert.equal(result.value.guid, 'ABCDEFGH');
    assert.equal(result.value.name, 'Alice');
    assert.equal(result.value.timeMs, MIN_TIME + 5000);
    assert.equal(result.value.moves, MIN_MOVES);
    assert.equal(result.value.slotHint, 'first');
});

test('trims whitespace from the name', () => {
    const result = validateSubmission({ ...valid, name: '  Bob  ' }, SEED, MIN_MOVES);
    assert.equal(result.ok, true);
    assert.equal(result.value.name, 'Bob');
});

test('rejects a missing body', () => {
    assert.equal(validateSubmission(null, SEED, MIN_MOVES).ok, false);
    assert.equal(validateSubmission(undefined, SEED, MIN_MOVES).ok, false);
});

test('rejects a non-object body', () => {
    assert.equal(validateSubmission('string', SEED, MIN_MOVES).ok, false);
    assert.equal(validateSubmission([1, 2, 3], SEED, MIN_MOVES).ok, false);
});

test('rejects an invalid guid', () => {
    for (const guid of ['', 'short', 'TOOLONGXX', 'abcdefgh', 'ABCDEFG!', 12345678, null]) {
        const result = validateSubmission({ ...valid, guid }, SEED, MIN_MOVES);
        assert.equal(result.ok, false, `expected guid ${guid} to be rejected`);
        assert.equal(result.reason, 'invalid guid');
    }
});

test('rejects an invalid name', () => {
    for (const name of ['', '   ', 'x'.repeat(21), 'bad<script>', 'emoji😀', null, 42]) {
        const result = validateSubmission({ ...valid, name }, SEED, MIN_MOVES);
        assert.equal(result.ok, false, `expected name ${name} to be rejected`);
        assert.equal(result.reason, 'invalid name');
    }
});

test('rejects a seed that does not match today', () => {
    const result = validateSubmission({ ...valid, seed: SEED + 1 }, SEED, MIN_MOVES);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'seed mismatch');
});

test('rejects a non-integer seed', () => {
    for (const seed of [SEED + 0.5, String(SEED), null, undefined]) {
        const result = validateSubmission({ ...valid, seed }, SEED, MIN_MOVES);
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'seed mismatch');
    }
});

test('rejects out-of-range times', () => {
    for (const timeMs of [0, MIN_TIME_MS - 1, MAX_TIME_MS + 1, -5, 12.5, '1000', null]) {
        const result = validateSubmission({ ...valid, timeMs }, SEED, MIN_MOVES);
        assert.equal(result.ok, false, `expected timeMs ${timeMs} to be rejected`);
        assert.equal(result.reason, 'time out of range');
    }
});

test('accepts the boundary times', () => {
    // With no puzzle floor (minMoves 0) and no claimed moves, only the
    // absolute 1s..30min range applies.
    const base = { ...valid, moves: 0 };
    assert.equal(validateSubmission({ ...base, timeMs: MIN_TIME_MS }, SEED, 0).ok, true);
    assert.equal(validateSubmission({ ...base, timeMs: MAX_TIME_MS }, SEED, 0).ok, true);
});

test('rejects a time faster than the moves allow', () => {
    // 15 moves at 1200ms each cannot be done in 2 seconds.
    const result = validateSubmission({ ...valid, timeMs: 2000 }, SEED, MIN_MOVES);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'time below minimum possible');
});

test('rejects a move count below the true minimum', () => {
    const result = validateSubmission({ ...valid, timeMs: 60000, moves: MIN_MOVES - 1 }, SEED, MIN_MOVES);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'implausible move count');
});

test('normalises an unknown slot hint to an empty string', () => {
    const result = validateSubmission({ ...valid, slotHint: 'nonsense' }, SEED, MIN_MOVES);
    assert.equal(result.ok, true);
    assert.equal(result.value.slotHint, '');
});

test('the guid and name patterns match the documented rules', () => {
    assert.equal(GUID_RE.test('ABCDEFGH'), true);
    assert.equal(GUID_RE.test('ABCDEFG1'), false);
    assert.equal(NAME_RE.test('Alice Smith_2-x'), true);
    assert.equal(NAME_RE.test('Alice.Smith'), false);
});