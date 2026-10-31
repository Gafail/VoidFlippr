/* Identity: a display name plus a server-issued GUID.
   The GUID is requested from the server on first visit, so it cannot be
   forged by hand and the server can rate-limit registrations. */

import { state } from './state.js';
import { showToast } from './toast.js';

const NAME_RE = /^[A-Za-z0-9 _-]{1,20}$/;
const GUID_RE = /^[A-Z2-9]{8}$/;

const STORAGE_KEY = 'voidflippr_player';

/** Read the stored identity, if it is valid. */
export function loadIdentity() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (parsed
            && typeof parsed.name === 'string'
            && typeof parsed.guid === 'string'
            && typeof parsed.token === 'string'
            && GUID_RE.test(parsed.guid)
            && parsed.token.length > 0) {
            state.playerName = parsed.name;
            state.playerGuid = parsed.guid;
            state.playerToken = parsed.token;
            return true;
        }
    } catch (e) {
        // corrupt or unavailable storage - treat as a first visit
    }
    return false;
}

function saveIdentity(name, guid, token) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, guid, token }));
    } catch (e) {
        // storage unavailable - the player can still play, but not be ranked
        showToast('Could not save your identity — scores may not persist.');
    }
    state.playerName = name;
    state.playerGuid = guid;
    state.playerToken = token;
}

/**
 * Ask the server for a new identity.
 * @returns {Promise<{guid: string, token: string}|null>}
 */
async function requestIdentity(name) {
    try {
        const response = await fetch('/daily-register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (!data || !data.guid || !data.token) return null;
        return { guid: data.guid, token: data.token };
    } catch (e) {
        return null;
    }
}

/**
 * Ensure the player has an identity, prompting for a name if needed.
 * @param {Function} onReady
 */
export async function ensureIdentity(onReady) {
    if (loadIdentity()) {
        if (onReady) onReady();
        return;
    }

    const overlay = document.getElementById('identityOverlay');
    const nameInput = document.getElementById('identityName');
    const guidSpan = document.getElementById('identityGuid');
    const confirmBtn = document.getElementById('identityConfirmBtn');
    if (!overlay || !nameInput || !confirmBtn) {
        if (onReady) onReady();
        return;
    }

    // Request a GUID up front so the player sees their ID immediately.
    // If it has not arrived by the time they confirm, the submit path fetches
    // one itself.
    let pending = requestIdentity('');
    if (guidSpan) guidSpan.textContent = '…';
    pending.then((identity) => {
        if (identity && guidSpan && !state.playerGuid) {
            guidSpan.textContent = identity.guid;
        }
    });

    overlay.classList.add('active');
    nameInput.value = '';
    setTimeout(() => nameInput.focus(), 100);

    let submitting = false;

    const submit = async () => {
        if (submitting) return;
        const raw = nameInput.value.trim();
        if (!raw) {
            nameInput.focus();
            return;
        }
        if (!NAME_RE.test(raw)) {
            showToast('Name must be 1-20 chars (letters, digits, space, _ or -)');
            return;
        }

        submitting = true;
        confirmBtn.disabled = true;

        // Reuse the identity fetched when the modal opened; only ask the
        // server again if that request failed.
        let identity;
        try {
            identity = await pending;
        } catch (e) {
            identity = null;
        }
        if (!identity) {
            identity = await requestIdentity(raw);
        }
        if (!identity) {
            submitting = false;
            confirmBtn.disabled = false;
            showToast('Could not reach the server — try again.');
            return;
        }

        saveIdentity(raw, identity.guid, identity.token);
        overlay.classList.remove('active');
        if (onReady) onReady();
    };

    confirmBtn.onclick = submit;
    nameInput.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}