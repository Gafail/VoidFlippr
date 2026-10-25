/* Entry point. Wires inline onclick= handlers onto window and runs init. */

import { wireTutorialClicks, closeTutorial, showTutorial } from './tutorial.js';
import { showHomeScreen, showDifficultyMenu, showSettings, toggleTheme,
         toggleSound, updateTileColors, resetColors, closeModalAndNew,
         renderSubmitSection, onSubmitClick, loadSavedColors, loadSettings } from './ui.js';
import { startGame, startDaily, startCustom, restartGame, goHome } from './game.js';
import { fetchDailyDate } from './daily.js';
import { ensureIdentity } from './identity.js';
import { loadLeaderboard } from './leaderboard.js';
import { showToast } from './toast.js';

// --- expose for inline onclick= handlers ---
window.showHomeScreen = showHomeScreen;
window.showDifficultyMenu = showDifficultyMenu;
window.showSettings = showSettings;
window.toggleTheme = toggleTheme;
window.toggleSound = toggleSound;
window.updateTileColors = updateTileColors;
window.resetColors = resetColors;
window.closeModalAndNew = closeModalAndNew;
window.renderSubmitSection = renderSubmitSection;
window.onSubmitClick = onSubmitClick;
window.startGame = startGame;
window.startDaily = startDaily;
window.startCustom = startCustom;
window.restartGame = restartGame;
window.goHome = goHome;
window.closeTutorial = closeTutorial;
window.showTutorial = showTutorial;
window.showToast = showToast;

// --- init ---
loadSavedColors();
loadSettings();
wireTutorialClicks();

// Top-level await is avoided so the bundle keeps working on the es2020
// target used by older mobile browsers.
fetchDailyDate()
    .catch(() => {
        // fetchDailyDate already falls back to the local UTC date.
    })
    .then(() => {
        ensureIdentity(() => {
            loadLeaderboard();
        });
    });