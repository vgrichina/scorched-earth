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

// EXE: fire sound — not a distinct event; approximated as short rising blip
export function playFireSound() {
  playTone(400, 800, 0.15, 'square', 0.12);
}

// EXE: explosion — rising sweep 1000→10000 Hz in steps of 100 Hz (extras.cpp 0x21267)
// Duration scales with blast radius
export function playExplosionSound(radius) {
  const duration = Math.min(0.8, 0.1 + radius * 0.01);
  playTone(1000, 10000, duration, 'square', 0.15);
}

// EXE: flight sound — velocity-based PIT divisor: speed*1000 → divisor (play.cpp 0x31663)
// freq = 1,193,277 / (speed * 1000); starts at 20 Hz (0x3162C), updates per frame
// Web: speed ≈ sqrt(distSq) pixel/frame; approximates EXE formula
export function playFlightSound(distSq) {
  if (!audioCtx || !soundEnabled) return;
  const speed = Math.sqrt(distSq);
  const freq = speed > 0 ? Math.min(4000, 1193.277 / speed) : 20;
  playTone(freq, freq, 0.03, 'square', 0.04);
}

// EXE: beep — turn-change uses 100 fg_click toggles (play.cpp 0x30991)
// Approximated as short low-frequency burst
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
