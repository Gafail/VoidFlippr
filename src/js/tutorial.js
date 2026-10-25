/* Tutorial overlay: shows a 3x3 interactive demo. Clicking a tile flips its
   3x3 neighborhood using the same logic as the real game. */

export function showTutorial() {
    resetTutorialGrid();
    document.getElementById('tutorialOverlay').classList.add('active');
    document.getElementById('dontShowAgain').checked = false;
    document.getElementById('tutorialToggle').classList.remove('active');
}

export function closeTutorial() {
    const dontShow = document.getElementById('dontShowAgain').checked;
    if (dontShow) {
        try {
            localStorage.setItem('voidflippr_tutorial_dismissed', 'true');
        } catch (e) {
            // storage unavailable - the tutorial still closes
        }
    }
    document.getElementById('tutorialOverlay').classList.remove('active');
}

export function resetTutorialGrid() {
    const tiles = document.querySelectorAll('#tutorialGrid .tutorial-tile');
    tiles.forEach(t => {
        const r = parseInt(t.dataset.row, 10);
        const c = parseInt(t.dataset.col, 10);
        t.classList.toggle('back', r === 1 && c === 1);
    });
}

function tutorialFlip(row, col) {
    const grid = document.getElementById('tutorialGrid');
    const tiles = grid.querySelectorAll('.tutorial-tile');
    const directions = [
        [0, 0], [-1, -1], [-1, 0], [-1, 1],
        [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]
    ];
    tiles.forEach(t => {
        const r = parseInt(t.dataset.row, 10);
        const c = parseInt(t.dataset.col, 10);
        for (const [dr, dc] of directions) {
            if (r === row + dr && c === col + dc) {
                t.classList.toggle('back');
                t.classList.add('pop');
                setTimeout(() => t.classList.remove('pop'), 200);
                break;
            }
        }
    });
}

export function wireTutorialClicks() {
    document.querySelectorAll('#tutorialGrid .tutorial-tile').forEach(t => {
        t.addEventListener('click', () => {
            tutorialFlip(parseInt(t.dataset.row, 10), parseInt(t.dataset.col, 10));
        });
    });
}