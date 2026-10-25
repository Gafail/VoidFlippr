/* UI plumbing: theme, settings, screen navigation, submit panel.
   Functions called from inline onclick= attributes live here so they're
   reachable from main.js where we wire them onto window. */

import { state, updateBestTimes } from './state.js';
import { formatElapsed, escapeHtml } from './util.js';
import { showToast } from './toast.js';
import { loadLeaderboard, findMyEntries, submitDailyScore } from './leaderboard.js';

export function showScreen(screenId) {
    const target = document.getElementById(screenId);
    if (!target) return;
    const current = document.querySelector('.screen.active');

    if (current === target) return;

    if (current) {
        current.classList.remove('active');
        setTimeout(() => {
            target.classList.add('active');
            if (screenId === 'difficultyScreen') {
                updateBestTimes();
            }
        }, 200);
    } else {
        target.classList.add('active');
        if (screenId === 'difficultyScreen') {
            updateBestTimes();
        }
    }
}

export function showHomeScreen() {
    showScreen('homeScreen');
}

export function showDifficultyMenu() {
    const winModal = document.getElementById('winModal');
    if (winModal) winModal.classList.remove('active');
    const customFlips = document.getElementById('customFlips');
    if (customFlips) customFlips.value = '';
    const puzzleSeed = document.getElementById('puzzleSeed');
    if (puzzleSeed) puzzleSeed.value = Math.floor(Math.random() * 999999);
    showScreen('difficultyScreen');
}

export function showSettings() {
    showScreen('settingsScreen');
}

export function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = isDark ? '☀️' : '🌙';
    try {
        localStorage.setItem('voidflippr_theme', isDark ? 'dark' : 'light');
    } catch (e) {
        // storage unavailable - theme still applies for this session
    }
}

export function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    const toggle = document.getElementById('soundToggle');
    if (toggle) toggle.classList.toggle('active', state.soundEnabled);
    try {
        localStorage.setItem('voidflippr_sound', String(state.soundEnabled));
    } catch (e) {
        // storage unavailable - sound still toggles for this session
    }

    if (state.soundEnabled) {
        // Lazily init audio on first sound-enabled click (browser autoplay policy).
        import('./audio.js').then(({ playClickSound }) => playClickSound());
    }
}

function applyTileColors() {
    document.documentElement.style.setProperty('--tile-front', state.tileFrontColor);
    document.documentElement.style.setProperty('--tile-back', state.tileBackColor);

    const frontPreview = document.getElementById('frontPreview');
    const backPreview = document.getElementById('backPreview');
    if (frontPreview) frontPreview.style.background = state.tileFrontColor;
    if (backPreview) backPreview.style.background = state.tileBackColor;
}

export function updateTileColors() {
    const frontInput = document.getElementById('frontColor');
    const backInput = document.getElementById('backColor');
    if (frontInput) state.tileFrontColor = frontInput.value;
    if (backInput) state.tileBackColor = backInput.value;

    applyTileColors();

    try {
        localStorage.setItem('voidflippr_front', state.tileFrontColor);
        localStorage.setItem('voidflippr_back', state.tileBackColor);
    } catch (e) {
        // storage unavailable - colours still apply for this session
    }
}

export function resetColors() {
    state.tileFrontColor = '#ffffff';
    state.tileBackColor = '#1a1a2e';

    const frontInput = document.getElementById('frontColor');
    const backInput = document.getElementById('backColor');
    if (frontInput) frontInput.value = state.tileFrontColor;
    if (backInput) backInput.value = state.tileBackColor;

    applyTileColors();

    try {
        localStorage.removeItem('voidflippr_front');
        localStorage.removeItem('voidflippr_back');
    } catch (e) {
        // storage unavailable - nothing to clean up
    }
}

export function loadSavedColors() {
    try {
        const savedFront = localStorage.getItem('voidflippr_front');
        const savedBack = localStorage.getItem('voidflippr_back');

        if (savedFront) {
            state.tileFrontColor = savedFront;
            const frontInput = document.getElementById('frontColor');
            if (frontInput) frontInput.value = savedFront;
        }
        if (savedBack) {
            state.tileBackColor = savedBack;
            const backInput = document.getElementById('backColor');
            if (backInput) backInput.value = savedBack;
        }
    } catch (e) {
        // storage unavailable - keep the defaults
    }

    applyTileColors();
}

export function loadSettings() {
    try {
        const savedSound = localStorage.getItem('voidflippr_sound');
        if (savedSound !== null) {
            state.soundEnabled = savedSound === 'true';
            const soundToggle = document.getElementById('soundToggle');
            if (soundToggle) soundToggle.classList.toggle('active', state.soundEnabled);
        }

        const savedTheme = localStorage.getItem('voidflippr_theme');
        let useDark;
        if (savedTheme === 'dark') {
            useDark = true;
        } else if (savedTheme === 'light') {
            useDark = false;
        } else {
            useDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        }
        if (useDark) {
            document.body.classList.add('dark-mode');
            const themeBtn = document.getElementById('themeToggle');
            if (themeBtn) themeBtn.textContent = '☀️';
        }

        const dontShow = localStorage.getItem('voidflippr_tutorial_dismissed');
        if (dontShow !== 'true') {
            const overlay = document.getElementById('tutorialOverlay');
            if (overlay) overlay.classList.add('active');
        }
    } catch (e) {
        // storage unavailable - fall back to defaults
    }
}

export function closeModalAndNew() {
    const winModal = document.getElementById('winModal');
    if (winModal) winModal.classList.remove('active');
    showDifficultyMenu();
}

export function renderSubmitSection() {
    const section = document.getElementById('submitSection');
    const status = document.getElementById('submitStatus');
    const buttons = document.getElementById('submitButtons');
    if (!section || !status || !buttons) return;

    if (!state.isDaily) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';

    if (state.lastSubmissionResult) {
        const r = state.lastSubmissionResult;
        if (r.accepted) {
            const slotLabel = r.slot === 'first' ? 'First Run Submitted' : 'Best Updated';
            status.innerHTML = `
                <div class="submit-success">
                    <div class="submit-label">${slotLabel}</div>
                    <div class="submit-rank">#${r.rank}<span class="submit-rank-suffix">of ${r.total}</span></div>
                </div>`;
            buttons.innerHTML = '';
        } else {
            status.innerHTML = '';
            buttons.innerHTML = `<div class="submit-info">Not an improvement — your best is <strong>${formatElapsed(r.timeMs)}</strong> (rank ${r.rank} / ${r.total}).</div>`;
        }
        return;
    }

    const { first: myFirst, best: myBest } = findMyEntries();
    const hasFirst = !!myFirst;

    if (!hasFirst) {
        status.innerHTML = `Submit your score to the leaderboard.`;
        buttons.innerHTML = `<button class="btn btn-primary" onclick="onSubmitClick('first')">Submit · ${formatElapsed(state.finalElapsedMs)}</button>`;
    } else if (!myBest) {
        status.innerHTML = `Submit to set your best time.`;
        buttons.innerHTML = `<button class="btn btn-primary" onclick="onSubmitClick('best')">Submit · ${formatElapsed(state.finalElapsedMs)}</button>`;
    } else if (state.finalElapsedMs < myBest.timeMs) {
        status.innerHTML = `New personal best — submit to the leaderboard?`;
        buttons.innerHTML = `<button class="btn btn-primary" onclick="onSubmitClick('best')">Submit · ${formatElapsed(state.finalElapsedMs)}</button>`;
    } else {
        status.innerHTML = '';
        const firstLine = `First run locked at <strong>${formatElapsed(myFirst.timeMs)}</strong>`;
        const bestLine = `Best at <strong>${formatElapsed(myBest.timeMs)}</strong>`;
        const thisRun = `<br><br>This run: <strong>${formatElapsed(state.finalElapsedMs)}</strong>`;
        buttons.innerHTML = `<div class="submit-info">${firstLine}<br>${bestLine}${thisRun}</div>`;
    }
}

export async function onSubmitClick(slotHint) {
    const buttons = document.getElementById('submitButtons');
    const status = document.getElementById('submitStatus');
    if (buttons) buttons.innerHTML = '<div class="submit-info">Submitting…</div>';

    const result = await submitDailyScore(slotHint);
    state.lastSubmissionResult = result;

    if (!result) {
        if (status) status.innerHTML = '';
        if (buttons) buttons.innerHTML = '<div class="submit-info">Submit failed — check your connection.</div>';
        return;
    }
    if (!result.ok) {
        if (status) status.innerHTML = '';
        if (buttons) buttons.innerHTML = `<div class="submit-info">${escapeHtml(result.reason || 'rejected')}</div>`;
        return;
    }

    await loadLeaderboard();
    renderSubmitSection();
}

export { showToast };