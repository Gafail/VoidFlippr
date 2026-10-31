/**
 * Rate limiter tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { consume, reset } = await import('../server/ratelimit.js');

test.beforeEach(() => reset());

test('requests are allowed up to the limit', () => {
    for (let i = 0; i < 5; i++) {
        const result = consume('key', 5, 60_000);
        assert.equal(result.allowed, true, `call ${i + 1} should be allowed`);
        assert.equal(result.remaining, 4 - i);
    }
});

test('requests past the limit are blocked', () => {
    for (let i = 0; i < 3; i++) consume('key', 3, 60_000);
    const blocked = consume('key', 3, 60_000);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.retryAfterSec > 0, 'expected a retry hint');
});

test('keys are independent of each other', () => {
    consume('a', 1, 60_000);
    assert.equal(consume('a', 1, 60_000).allowed, false);
    assert.equal(consume('b', 1, 60_000).allowed, true);
});

test('the window slides so old hits expire', async () => {
    consume('key', 1, 50);
    assert.equal(consume('key', 1, 50).allowed, false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(consume('key', 1, 50).allowed, true);
});

test('reset clears every bucket', () => {
    consume('key', 1, 60_000);
    reset();
    assert.equal(consume('key', 1, 60_000).allowed, true);
});