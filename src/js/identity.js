/* Identity: name + GUID stored in localStorage. First visit prompts for a name;
   subsequent visits read from storage. */

import { state } from './state.js';
import { generateGuid } from './util.js';
import { showToast } from './toast.js';

const GUID_RE = /^[A-Z2-9]{8}$/;
const NAME_RE = /^[A-Za-z0-9 _-]{1,20}$/;

export function loadIdentity() {
    try {
        const raw = localStorage.getItem('voidflippr_player');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.name === 'string' && typeof parsed.guid === 'string' &&
                GUID_RE.test(parsed.guid)) {
                state.playerName = parsed.name;
                state.playerGuid = parsed.guid;
                return true;
            }
        }
    } catch (e) {
        // corrupt or unavailable storage - treat as a first visit
    }
    return false;
}

function saveIdentity(name, guid) {
    try {
        localStorage.setItem('voidflippr_player', JSON.stringify({ name, guid }));
    } catch (e) {
        // storage unavailable - the player can still play, but not be ranked
        showToast('Could not save your name — scores may not persist.');
    }
    state.playerName = name;
    state.playerGuid = guid;
}

export function ensureIdentity(onReady) {
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

    const guid = generateGuid();
    if (guidSpan) guidSpan.textContent = guid;
    overlay.classList.add('active');
    nameInput.value = '';
    setTimeout(() => nameInput.focus(), 100);

    const submit = () => {
        const raw = nameInput.value.trim();
        if (!raw) {
            nameInput.focus();
            return;
        }
        if (!NAME_RE.test(raw)) {
            showToast('Name must be 1-20 chars (letters, digits, space, _ or -)');
            return;
        }
        saveIdentity(raw, guid);
        overlay.classList.remove('active');
        if (onReady) onReady();
    };

    confirmBtn.onclick = submit;
    nameInput.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}