/**
 * Identity tests: server-issued GUIDs and their signing tokens.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmpRoot = await mkdtemp(path.join(tmpdir(), 'voidflippr-id-'));
process.env.DATA_DIR = tmpRoot;
process.env.IDENTITY_SECRET = 'test-secret-value-that-is-long-enough-1234';

const {
    generateGuid,
    signGuid,
    verifyGuidToken,
    issueIdentity,
    validateRegistration,
} = await import('../server/identity.js');

test.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
});

test('generated GUIDs match the documented format', () => {
    for (let i = 0; i < 200; i++) {
        const guid = generateGuid();
        assert.match(guid, /^[A-Z2-9]{8}$/);
        assert.ok(!/[01OI]/.test(guid), 'GUID must avoid ambiguous characters');
    }
});

test('generated GUIDs are not all the same', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(generateGuid());
    assert.ok(seen.size > 190, `expected mostly unique GUIDs, got ${seen.size}`);
});

test('a signed token verifies for its own GUID', async () => {
    const guid = generateGuid();
    const token = await signGuid(guid);
    assert.equal(await verifyGuidToken(guid, token), true);
});

test('a token does not verify for a different GUID', async () => {
    const guid = generateGuid();
    const other = generateGuid();
    const token = await signGuid(guid);
    assert.equal(await verifyGuidToken(other, token), false);
});

test('a forged token does not verify', async () => {
    const guid = generateGuid();
    assert.equal(await verifyGuidToken(guid, 'forged'), false);
    assert.equal(await verifyGuidToken(guid, ''), false);
    assert.equal(await verifyGuidToken(guid, undefined), false);
    assert.equal(await verifyGuidToken(guid, null), false);
});

test('a malformed GUID never verifies', async () => {
    const token = await signGuid('ABCDEFGH');
    assert.equal(await verifyGuidToken('bad!', token), false);
    assert.equal(await verifyGuidToken('', token), false);
    assert.equal(await verifyGuidToken(null, token), false);
    assert.equal(await verifyGuidToken(12345678, token), false);
});

test('issueIdentity returns a usable guid and token', async () => {
    const identity = await issueIdentity('Alice');
    assert.match(identity.guid, /^[A-Z2-9]{8}$/);
    assert.equal(identity.name, 'Alice');
    assert.equal(await verifyGuidToken(identity.guid, identity.token), true);
});

test('issueIdentity trims the name', async () => {
    const identity = await issueIdentity('  Bob  ');
    assert.equal(identity.name, 'Bob');
});

test('validateRegistration accepts a good name', () => {
    const result = validateRegistration({ name: 'Alice Smith_2-x' });
    assert.equal(result.ok, true);
    assert.equal(result.value.name, 'Alice Smith_2-x');
});

test('validateRegistration rejects bad names', () => {
    // An empty name is allowed (the client pre-fetches an identity), but a
    // malformed one is not.
    for (const name of ['x'.repeat(21), 'bad<script>', 'emoji😀', null, 42, {}]) {
        const result = validateRegistration({ name });
        assert.equal(result.ok, false, `expected ${name} to be rejected`);
        assert.equal(result.reason, 'invalid name');
    }
});

test('validateRegistration accepts an empty name', () => {
    // The client asks for an identity before the player has typed a name.
    const result = validateRegistration({ name: '' });
    assert.equal(result.ok, true);
    assert.equal(result.value.name, '');
});

test('validateRegistration rejects a non-object body', () => {
    assert.equal(validateRegistration(null).ok, false);
    assert.equal(validateRegistration('string').ok, false);
    assert.equal(validateRegistration([1, 2]).ok, false);
});