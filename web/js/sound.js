// Scorched Earth - Sound System
// EXE: PC speaker tones via INT 61h / port 42h timer programming
// Web: Web Audio API OscillatorNode emulating PC speaker square waves
// EXE: sound toggle key = 'H', fly sound and explosion sounds

import { config } from './config.js';

let audioCtx = null;
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
  config.soundEnabled = config.soundEnabled ? 0 : 1;
  return config.soundEnabled;
}

export function isSoundEnabled() {
  return config.soundEnabled;
}

// Play a tone sweep (frequency ramp over duration)
function playTone(startFreq, endFreq, duration, type = 'square', volume = 0.15) {
  if (!audioCtx || !config.soundEnabled) return;
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

// EXE: explosion — 7 discrete frequency steps (extras.cpp 0x21267)
// for (si = 0; si < 100; si += 15): freq = si * 100 + 1000; delay(5 ticks)
// Steps: 1000, 2500, 4000, 5500, 7000, 8500, 10000 Hz
export function playExplosionSound(radius) {
  if (!audioCtx || !config.soundEnabled) return;
  initSound();

  const frequencies = [1000, 2500, 4000, 5500, 7000, 8500, 10000];
  const stepDuration = 5 / 18.2; // 5 clock ticks at 18.2 Hz PIT timer
  const totalDuration = frequencies.length * stepDuration;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'square';
  const now = audioCtx.currentTime;

  // Schedule discrete frequency steps (not a continuous ramp)
  for (let i = 0; i < frequencies.length; i++) {
    osc.frequency.setValueAtTime(frequencies[i], now + i * stepDuration);
  }

  gain.gain.setValueAtTime(0.15, now);
  gain.gain.setValueAtTime(0, now + totalDuration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + totalDuration);
}

// EXE: flight sound — velocity-based PIT divisor: speed*1000 → divisor (play.cpp 0x31663)
// freq = 1,193,277 / (speed * 1000); starts at 20 Hz (0x3162C), updates per frame
// Web: speed ≈ sqrt(distSq) pixel/frame; approximates EXE formula
export function playFlightSound(distSq) {
  if (!audioCtx || !config.soundEnabled) return;
  const speed = Math.sqrt(distSq);
  const freq = speed > 0 ? Math.min(4000, 1193.277 / speed) : 20;
  playTone(freq, freq, 0.03, 'square', 0.04);
}

// EXE: turn-change click — fg_click(20, 100) at play.cpp 0x30991
// 200 speaker toggles (count×2) with delay=20 busy-wait each toggle.
// On ~10 MHz 286: ~1-2ms burst of broadband clicking — a short "tick" pop.
// Web: short noise burst via AudioBuffer to approximate PC speaker toggle clicks.
export function playBeep() {
  if (!audioCtx || !config.soundEnabled) return;
  initSound();

  // Create a short noise burst (~3ms) to emulate 200 rapid speaker toggles
  const sampleRate = audioCtx.sampleRate;
  const duration = 0.003; // ~3ms matches fg_click(20,100) timing
  const numSamples = Math.ceil(sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);

  // Simulate speaker toggle: alternating +1/-1 with irregular timing
  // fg_click toggles bit 1 of port 0x61 — each toggle is a step impulse
  let val = 1;
  for (let i = 0; i < numSamples; i++) {
    // Toggle roughly every few samples to approximate the busy-wait timing
    if (i % 3 === 0) val = -val;
    data[i] = val;
  }

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.12, audioCtx.currentTime);

  source.connect(gain);
  gain.connect(audioCtx.destination);
  source.start(audioCtx.currentTime);
}

// Lightning strike — high-freq crack (2000→200Hz, 0.1s)
export function playLightningSound() {
  playTone(2000, 200, 0.1, 'square', 0.15);
}

// Tank death — low thud (80→20Hz, 0.3s)
export function playDeathSound() {
  playTone(80, 20, 0.3, 'square', 0.12);
}
