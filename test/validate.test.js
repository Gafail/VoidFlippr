/**
 * Validation tests for the submission rules.
 *
 * Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateSubmission, GUID_RE, NAME_RE, MIN_TIME_MS, MAX_TIME_MS } from '../server/validate.js';

const SEED = 120261025;

const valid = {
    guid: 'ABCDEFGH',
    name: 'Alice',
    seed: SEED,
    timeMs: 25430,
    slotHint: 'first',
};

test('accepts a well-formed submission', () => {
    const result = validateSubmission(valid, SEED);
    assert.equal(result.ok, true);
    assert.equal(result.value.guid, 'ABCDEFGH');
    assert.equal(result.value.name, 'Alice');
    assert.equal(result.value.timeMs, 25430);
    assert.equal(result.value.slotHint, 'first');
});

test('trims whitespace from the name', () => {
    const result = validateSubmission({ ...valid, name: '  Bob  ' }, SEED);
    assert.equal(result.ok, true);
    assert.equal(result.value.name, 'Bob');
});

test('rejects a missing body', () => {
    assert.equal(validateSubmission(null, SEED).ok, false);
    assert.equal(validateSubmission(undefined, SEED).ok, false);
});

test('rejects a non-object body', () => {
    assert.equal(validateSubmission('string', SEED).ok, false);
    assert.equal(validateSubmission([1, 2, 3], SEED).ok, false);
});

test('rejects an invalid guid', () => {
    for (const guid of ['', 'short', 'TOOLONGXX', 'abcdefgh', 'ABCDEFG!', 12345678, null]) {
        const result = validateSubmission({ ...valid, guid }, SEED);
        assert.equal(result.ok, false, `expected guid ${guid} to be rejected`);
        assert.equal(result.reason, 'invalid guid');
    }
});

test('rejects an invalid name', () => {
    for (const name of ['', '   ', 'x'.repeat(21), 'bad<script>', 'emoji😀', null, 42]) {
        const result = validateSubmission({ ...valid, name }, SEED);
        assert.equal(result.ok, false, `expected name ${name} to be rejected`);
        assert.equal(result.reason, 'invalid name');
    }
});

test('rejects a seed that does not match today', () => {
    const result = validateSubmission({ ...valid, seed: SEED + 1 }, SEED);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'seed mismatch');
});

test('rejects a non-integer seed', () => {
    for (const seed of [SEED + 0.5, String(SEED), null, undefined]) {
        const result = validateSubmission({ ...valid, seed }, SEED);
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'seed mismatch');
    }
});

test('rejects out-of-range times', () => {
    for (const timeMs of [0, MIN_TIME_MS - 1, MAX_TIME_MS + 1, -5, 12.5, '1000', null]) {
        const result = validateSubmission({ ...valid, timeMs }, SEED);
        assert.equal(result.ok, false, `expected timeMs ${timeMs} to be rejected`);
        assert.equal(result.reason, 'time out of range');
    }
});

test('accepts the boundary times', () => {
    assert.equal(validateSubmission({ ...valid, timeMs: MIN_TIME_MS }, SEED).ok, true);
    assert.equal(validateSubmission({ ...valid, timeMs: MAX_TIME_MS }, SEED).ok, true);
});

test('normalises an unknown slot hint to an empty string', () => {
    const result = validateSubmission({ ...valid, slotHint: 'nonsense' }, SEED);
    assert.equal(result.ok, true);
    assert.equal(result.value.slotHint, '');
});

test('the guid and name patterns match the documented rules', () => {
    assert.equal(GUID_RE.test('ABCDEFGH'), true);
    assert.equal(GUID_RE.test('ABCDEFG1'), false);
    assert.equal(NAME_RE.test('Alice Smith_2-x'), true);
    assert.equal(NAME_RE.test('Alice.Smith'), false);
});