/* Tiny utilities used across modules. */

export function formatElapsed(elapsed) {
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    const cs = Math.floor((elapsed % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

export function formatBestTime(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const millis = Math.floor((ms % 1000) / 10);

    if (minutes > 0) {
        return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(2, '0')}`;
    }
    return `${seconds}.${millis.toString().padStart(2, '0')}s`;
}

export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export function seededRandom(s) {
    const x = Math.sin(s) * 10000;
    return x - Math.floor(x);
}

export function generateGuid() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(8);
    if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let out = '';
    for (let i = 0; i < 8; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}