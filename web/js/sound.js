// Scorched Earth - Sound System
// EXE: PC speaker tones via INT 61h / port 42h timer programming
// Web: Web Audio API OscillatorNode emulating PC speaker square waves
// EXE: sound toggle key = 'H', fly sound and explosion sounds

import { config } from './config.js';

let audioCtx = null;
let soundEnabled = true;

// Lazy-init AudioContext on first user gesture (browser autoplay policy)
export function initSound() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    // Web Audio not available
  }
}

export function toggleSound() {
  soundEnabled = !soundEnabled;
  return soundEnabled;
}

export function isSoundEnabled() {
  return soundEnabled;
}

// Play a tone sweep (frequency ramp over duration)
function playTone(startFreq, endFreq, duration, type = 'square', volume = 0.15) {
  if (!audioCtx || !soundEnabled) return;
  initSound();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(startFreq, audioCtx.currentTime);
  osc.frequency.linearRampToValueAtTime(endFreq, audioCtx.currentTime + duration);

  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + duration);
}

// EXE: fire sound — ascending tone 400→800Hz, 0.15s
export function playFireSound() {
  playTone(400, 800, 0.15, 'square', 0.12);
}

// EXE: explosion sound — low freq sweep, duration scales with radius
export function playExplosionSound(radius) {
  const duration = Math.min(0.8, 0.1 + radius * 0.01);
  playTone(200, 40, duration, 'square', 0.15);
}

// EXE: flight sound — pitch = sqrt(distSq) * 1.5 + 1000
// Called per frame during flight — we just play a short blip
export function playFlightSound(distSq) {
  if (!audioCtx || !soundEnabled) return;
  const freq = Math.sqrt(distSq) * 1.5 + 1000;
  playTone(freq, freq * 0.9, 0.03, 'square', 0.04);
}

// EXE: beep — 40Hz, 200ms — failed action / error
export function playBeep() {
  playTone(40, 40, 0.2, 'square', 0.1);
}

// Lightning strike — high-freq crack (2000→200Hz, 0.1s)
export function playLightningSound() {
  playTone(2000, 200, 0.1, 'square', 0.15);
}

// Tank death — low thud (80→20Hz, 0.3s)
export function playDeathSound() {
  playTone(80, 20, 0.3, 'square', 0.12);
}
