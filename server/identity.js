/**
 * Server-issued player identity.
 *
 * The browser used to mint its own GUID, which meant anyone could fabricate
 * unlimited identities and flood the leaderboard. Identities are now issued
 * by the server and signed with an HMAC, so a client cannot invent a GUID the
 * server has not seen.
 *
 * The token is sent back on every submission and verified server-side.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { config } from './config.js';

/** GUID alphabet: A-Z and 2-9, so no 0/O/1/I confusion. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const GUID_RE = /^[A-Z2-9]{8}$/;
const NAME_RE = /^[A-Za-z0-9 _-]{1,20}$/;

let cachedSecret = null;

/**
 * The signing secret. Uses IDENTITY_SECRET when set, otherwise a generated
 * secret cached in the data directory so tokens survive a restart.
 */
async function secret() {
    if (config.identitySecret) return config.identitySecret;
    if (cachedSecret) return cachedSecret;

    const keyPath = path.join(config.dataDir, '.identity-secret');

    try {
        const existing = (await readFile(keyPath, 'utf8')).trim();
        if (existing.length >= 32) {
            cachedSecret = existing;
            return cachedSecret;
        }
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }

    const generated = randomBytes(32).toString('hex');
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(keyPath, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });
    cachedSecret = generated;
    return generated;
}

/** Generate a random GUID. */
export function generateGuid() {
    const bytes = randomBytes(8);
    let out = '';
    for (let i = 0; i < 8; i++) {
        out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return out;
}

/** Sign a GUID into a token. */
export async function signGuid(guid) {
    const key = await secret();
    return createHmac('sha256', key).update(guid).digest('base64url');
}

/**
 * Check that a token was issued by this server for that GUID.
 * Uses a constant-time comparison to avoid leaking information.
 */
export async function verifyGuidToken(guid, token) {
    if (typeof guid !== 'string' || !GUID_RE.test(guid)) return false;
    if (typeof token !== 'string' || token.length === 0) return false;

    const expected = await signGuid(guid);
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

/**
 * Issue a new identity.
 * @returns {Promise<{guid: string, token: string, name: string}>}
 */
export async function issueIdentity(name = '') {
    const guid = generateGuid();
    const token = await signGuid(guid);
    return { guid, token, name: typeof name === 'string' ? name.trim() : '' };
}

/**
 * Validate a registration request.
 *
 * The name is optional here: the client asks for an identity before the
 * player has typed their name, so the identity is issued with an empty name
 * and the real name is sent with the score submission.
 *
 * @returns {{ok: true, value: {name: string}} | {ok: false, reason: string}}
 */
export function validateRegistration(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, reason: 'invalid body' };
    }
    // A missing name means "not chosen yet" and is allowed. A name of the
    // wrong type is a malformed request.
    if (body.name !== undefined && typeof body.name !== 'string') {
        return { ok: false, reason: 'invalid name' };
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name && !NAME_RE.test(name)) {
        return { ok: false, reason: 'invalid name' };
    }
    return { ok: true, value: { name } };
}

export { GUID_RE, NAME_RE };