/**
 * Daily puzzle seed tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { dayKey, seedFor, timestamp } from '../server/daily.js';

test('dayKey returns YYYYMMDD in UTC', () => {
    assert.equal(dayKey(new Date('2026-10-26T12:07:00Z')), '20261026');
    assert.equal(dayKey(new Date('2026-01-01T00:00:00Z')), '20260101');
    assert.equal(dayKey(new Date('2026-12-31T23:59:59Z')), '20261231');
});

test('dayKey is stable regardless of the local timezone offset', () => {
    // 23:30 UTC is still the same UTC day even where the local date differs.
    assert.equal(dayKey(new Date('2026-10-26T23:30:00Z')), '20261026');
});

test('seedFor prefixes the day key with 1', () => {
    assert.equal(seedFor(new Date('2026-10-26T12:07:00Z')), 120261026);
    assert.equal(seedFor(new Date('2026-01-01T00:00:00Z')), 120260101);
});

test('the seed is an integer', () => {
    assert.equal(Number.isInteger(seedFor()), true);
});

test('timestamp renders ISO-8601 without milliseconds', () => {
    assert.equal(timestamp(new Date('2026-10-26T12:07:00.123Z')), '2026-10-26T12:07:00Z');
});