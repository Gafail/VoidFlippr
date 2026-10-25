/* Audio context + click/win sound effects.
   All errors swallowed — a missing AudioContext must never break the click flow. */

import { state } from './state.js';

function initAudio() {
    if (state.audioContext) return;
    try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        state.audioContext = new Ctor();
    } catch (e) {
        state.audioContext = null;
    }
}

function tone(frequency, startOffset, duration, peakGain) {
    const ctx = state.audioContext;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';

    const startTime = ctx.currentTime + startOffset;
    gainNode.gain.setValueAtTime(peakGain, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
}

export function playClickSound() {
    if (!state.soundEnabled) return;
    try {
        initAudio();
        if (!state.audioContext) return;
        tone(800, 0, 0.1, 0.1);
    } catch (e) {
        // audio is optional - never break the click flow
    }
}

export function playWinSound() {
    if (!state.soundEnabled) return;
    try {
        initAudio();
        if (!state.audioContext) return;
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, i) => tone(freq, i * 0.15, 0.3, 0.15));
    } catch (e) {
        // audio is optional - never break the win flow
    }
}