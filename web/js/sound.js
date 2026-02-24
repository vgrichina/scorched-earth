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

// EXE: parachute deploy — sound(0x1E, 0x07D0) = 2000 Hz tone, duration 30 ticks
// File 0x208EA: deployment action sound
export function playParachuteDeploySound() {
  // 30 PIT ticks ≈ 30/18.2 ≈ 1.65s — but that's a frame count, not real seconds
  // In practice this is a short deployment "ping" at 2000 Hz
  playTone(2000, 2000, 0.15, 'square', 0.12);
}

// EXE: landing thud — sound(0x1E, 0xC8) = 200 Hz tone, duration 30 ticks
// File 0x20ACA: post-landing impact sound
export function playLandingThudSound() {
  playTone(200, 200, 0.15, 'square', 0.12);
}

// Lightning strike — high-freq crack (2000→200Hz, 0.1s)
export function playLightningSound() {
  playTone(2000, 200, 0.1, 'square', 0.15);
}

// Tank death — low thud (80→20Hz, 0.3s)
export function playDeathSound() {
  playTone(80, 20, 0.3, 'square', 0.12);
}

// EXE: terrain generation ping (ranges.cpp, file 0x35D41)
// for (si = 10; si < 20; si++) { fg_click(0, 20); delay(25 - (si-10)*2); }
// Rising-speed click train: 10 clicks with decreasing delay (25→7 ticks).
export function playTerrainGenPing() {
  if (!audioCtx || !config.soundEnabled) return;
  initSound();

  const now = audioCtx.currentTime;
  let t = 0;
  for (let si = 10; si < 20; si++) {
    const delayTicks = 25 - (si - 10) * 2; // 25, 23, 21, ... 7 ticks
    const delaySec = delayTicks / 18.2;     // PIT timer at 18.2 Hz

    // Each fg_click(0, 20) = 40 speaker toggles with no busy-wait → ~0.5ms burst
    const clickDur = 0.0005;
    const sampleRate = audioCtx.sampleRate;
    const numSamples = Math.ceil(sampleRate * clickDur);
    const buffer = audioCtx.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);
    let val = 1;
    for (let i = 0; i < numSamples; i++) {
      if (i % 3 === 0) val = -val;
      data[i] = val;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.10, now + t);
    source.connect(gain);
    gain.connect(audioCtx.destination);
    source.start(now + t);

    t += delaySec;
  }
}

// EXE: impact random tone (extras.cpp, file 0x247BA)
// freq = random(3000); fg_sound_on(freq); — updated each explosion animation frame.
// Rapidly varying random-frequency tone during impact/explosion animation.
export function playImpactFrame() {
  if (!audioCtx || !config.soundEnabled) return;
  initSound();

  const freq = Math.max(20, Math.floor(Math.random() * 3000));
  playTone(freq, freq, 0.05, 'square', 0.08);
}

// EXE: terrain-hit rising sound (extras.cpp, file 0x24DCD)
// Starting freq = 1000 Hz (0x3E8 at file 0x24CE4), +200 Hz per terrain pixel step.
// Plays when projectile enters terrain; frequency rises until projectile stops.
// numSteps = approximate number of terrain pixels traversed (typically 1–5 for web port).
export function playTerrainHitSound(numSteps) {
  if (!audioCtx || !config.soundEnabled) return;
  initSound();

  const baseFreq = 1000;
  const stepHz = 200;
  const steps = Math.min(numSteps || 3, 20);
  const stepDur = 0.015; // ~15ms per step
  const totalDur = steps * stepDur;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  const now = audioCtx.currentTime;

  for (let i = 0; i < steps; i++) {
    osc.frequency.setValueAtTime(baseFreq + i * stepHz, now + i * stepDur);
  }

  gain.gain.setValueAtTime(0.10, now);
  gain.gain.setValueAtTime(0, now + totalDur);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + totalDur);
}

// EXE: shield-hit random tone (shields.cpp, file 0x3AF33)
// freq = random(50); fg_sound_on(freq); — per-frame during shield hit animation.
// Low-frequency rumble/buzz matching PC speaker behavior at sub-50 Hz.
export function playShieldHitSound() {
  if (!audioCtx || !config.soundEnabled) return;
  initSound();

  // PC speaker at 0-49 Hz produces audible mechanical clicks;
  // Web Audio square wave at these frequencies produces a low buzz.
  const freq = Math.max(5, Math.floor(Math.random() * 50));
  playTone(freq, freq, 0.03, 'square', 0.10);
}
