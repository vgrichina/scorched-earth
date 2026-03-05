// Scorched Earth - AI System
// EXE source: shark.cpp (seg 0x3167, file base 0x38070)
// EXE: AI solver region file 0x24F01-0x2610F (decoded in disasm/ai_solver_decoded.txt)
// EXE: AI config data at DS:0x05BEDA
// 7 difficulty levels: Moron → Spoiler
// Analytic ballistic solver with wind correction + sinusoidal noise injection

import { config } from './config.js';
import { players } from './tank.js';
import { random, clamp } from './utils.js';
import { WEAPONS, WPN } from './weapons.js';
import { terrain } from './terrain.js';

// AI type constants — EXE: vtable at DS:0x02E2, types stored in player struct
export const AI_TYPE = {
  HUMAN:     0,
  MORON:     1,
  SHOOTER:   2,
  POOLSHARK: 3,
  TOSSER:    4,
  CHOOSER:   5,
  SPOILER:   6,
  CYBORG:    7,  // randomizes to 0-5 (EXE: dispatch at 0x292A5)
  UNKNOWN:   8,  // randomizes to 0-5 (EXE: dispatch at 0x292A5)
  SENTIENT:  9,  // EXE: corrupted vtable (DS:0x0306), crashes DOS; intended as highest difficulty
};

export const AI_NAMES = [
  'Human', 'Moron', 'Shooter', 'Poolshark',
  'Tosser', 'Chooser', 'Spoiler', 'Cyborg', 'Unknown', 'Sentient',
];

// EXE: noise parameters per AI type — higher = more inaccurate
// EXE: switch at file 0x29505, each type pushes different param count
// Lower noise_amplitude = higher freq harmonics = more accurate scanning
// NOTE: Spoiler (type 5) uses RANDOM amplitudes per solve (unpredictable difficulty);
// EXE function at 0x29564 generates random values for Spoiler's noise budget each turn.
// All others use fixed amplitudes.
const AI_NOISE = {
  [AI_TYPE.MORON]:     [50, 50, 50],
  [AI_TYPE.SHOOTER]:   [23],
  [AI_TYPE.POOLSHARK]: [23],
  [AI_TYPE.TOSSER]:    [63, 23],
  [AI_TYPE.CHOOSER]:   [63, 63, 23],
  [AI_TYPE.SENTIENT]:  [],  // EXE: accuracy switch (0x29505) only covers types 0-5; Sentient gets NO noise = perfect accuracy
};

// EXE: Spoiler AI uses random noise amplitudes per solve (not fixed [63,63,63]).
// EXE: function at file 0x29564 generates: random(2)→DS:5172, random(100)→DS:516E, random(100)→DS:5170
// param[0]=angle amplitude (0 or 1 = nearly perfect), param[1]=power, param[2]=angle2 (both 0-99)
function getSpoilerNoise() {
  return [random(2), random(100), random(100)];
}

// EXE: ai_inject_noise (file 0x25DE9-0x2610F)
// Budget-driven harmonics with shot-number domain (not wall-clock).
// DS constants: π=DS:0x322E, 2π=DS:0x3236, 4.0=DS:0x323E, 0.5=DS:0x3242, 2.0=DS:0x3246
const NOISE_SHOT_RANGE = 90;  // angular range for budget calculation

function generateHarmonics(noiseAmplitude) {
  const freq_base = Math.PI / (noiseAmplitude * 2);  // DS:0x322E / (amp*2)
  const freq_cap = 2 * Math.PI / 10;                 // DS:0x3236 / 10
  for (let retry = 0; retry < 20; retry++) {
    let freq_mult = freq_base * 4.0;                  // DS:0x323E
    let budget = NOISE_SHOT_RANGE - 30;
    const harmonics = [];
    while (budget > 10 && harmonics.length < 5) {
      const amp = Math.random() * budget * 0.5;       // DS:0x3242
      let freq, attempts = 0;
      do {
        freq = Math.random() * freq_mult;
        attempts++;
      } while ((freq < freq_base || freq > freq_cap) && attempts < 1000);
      if (attempts >= 1000) freq = (freq_base + freq_cap) / 2;
      harmonics.push({ amp, freq, phase: Math.floor(Math.random() * 300) });
      budget = Math.floor(budget - amp * 2.0);         // DS:0x3246
      freq_mult *= 4.0;
    }
    if (harmonics.length >= 2) return harmonics;       // min 2 harmonics
  }
  // Fallback: two minimal harmonics
  const mid = (freq_base + freq_cap) / 2;
  return [
    { amp: 10, freq: mid, phase: Math.floor(Math.random() * 300) },
    { amp: 5, freq: mid * 2, phase: Math.floor(Math.random() * 300) },
  ];
}

function evaluateHarmonics(harmonics, shotNumber) {
  let sum = 0;
  for (const h of harmonics) {
    sum += h.amp * Math.sin(h.freq * (h.phase + shotNumber));
  }
  return sum;
}

// Per-player noise state: harmonics persist for scanning correlation, shot counter increments
const playerNoiseState = new Map();

// Per-player sticky target: EXE player struct +0x8E/+0x90 stores previous target far ptr
// EXE Moron AI (0x38B4E) reads player[+0x8E/+0x90]; if previous target valid, prefers it
const playerLastTarget = new Map();

function getNoiseState(player, noiseParams) {
  let state = playerNoiseState.get(player);
  const key = noiseParams.join(',');
  if (!state || state.key !== key) {
    state = {
      key,
      generators: noiseParams.map(amp => generateHarmonics(amp)),
      shotNumber: state ? state.shotNumber : 0,
    };
    playerNoiseState.set(player, state);
  }
  return state;
}

export function resetAINoise() {
  playerNoiseState.clear();
  playerLastTarget.clear();
}

// AI state for current computation
const aiState = {
  thinking: false,
  thinkFrames: 0,
  targetAngle: 90,
  targetPower: 500,
  selectedWeapon: WPN.BABY_MISSILE,
  animatingAim: false,
};

// Check if a player is AI-controlled
export function isAI(player) {
  return player.aiType > 0;
}

// Get effective AI type (resolve Cyborg/Unknown to random 0-5)
// EXE: dispatch at file 0x292A5 — random(6) gives 0-5 (Human through Chooser)
function getEffectiveType(aiType) {
  if (aiType === AI_TYPE.CYBORG || aiType === AI_TYPE.UNKNOWN) {
    return random(6);  // 0-5 (includes Human, excludes Spoiler)
  }
  return aiType;
}

// EXE: ai_compute_power (file 0x254E9-0x2589B)
// Ballistic formula: v² = g_config * dx² / (2 * cos²(θ) * (dx*tan(θ) - dy))
// EXE constants: DS:3214 (f32)=2.0, DS:3218 (f32)=50.0, DS:512A (f64)=0.2 (gravity default)
// Web equivalent: g = GRAVITY_FACTOR * config.gravity = 400 * g_config
// Scaling proof: v_exe * 50 = v_web * 2.5 (v_web = v_exe * 20, k = MAX_SPEED/1000 = 0.4)
function computePowerForAngle(shooter, target, angleDeg) {
  const dx = target.x - shooter.x;
  const dy = -(target.y - shooter.y);  // positive = up (world coords)
  const angleRad = angleDeg * Math.PI / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const g = 400.0 * config.gravity;  // GRAVITY_FACTOR — must match physics.js
  if (Math.abs(cosA) < 0.01 || Math.abs(dx) < 1) return 500;
  const denom = 2 * cosA * cosA * (dx * sinA / cosA - dy);
  if (denom <= 0) return 500;  // angle can't reach target at this geometry
  const vSq = g * dx * dx / denom;
  if (vSq <= 0) return 500;
  return clamp(Math.round(Math.sqrt(vSq) * 1000 / 400), 50, 1000);  // 400 = MAX_SPEED
}

// Main AI entry: compute shot parameters
// EXE architecture: harmonic scan selects angle; power computed analytically per angle.
// All noise generators contribute to angle scanning (NOT split angle/power as in prior web port).
export function aiComputeShot(player) {
  const effectiveType = getEffectiveType(player.aiType);
  const noiseParams = effectiveType === AI_TYPE.SPOILER
    ? getSpoilerNoise()
    : (AI_NOISE[effectiveType] || AI_NOISE[AI_TYPE.MORON]);

  const target = selectTarget(player);
  if (!target) {
    aiState.targetAngle = 90;
    aiState.targetPower = 200;
    aiState.selectedWeapon = WPN.BABY_MISSILE;
    return aiState;
  }

  aiState.selectedWeapon = selectWeapon(player, target, effectiveType);

  const dx = target.x - player.x;
  // Valid hemisphere: toward target (EXE: min_angle determined by target direction)
  const minAngle = dx >= 0 ? 0 : 90;

  if (noiseParams.length === 0) {
    // Sentient: empty noise → perfect accuracy (EXE vtable corrupted, never reached)
    // Best-effort: scan all valid angles, pick lowest error from power mid-range
    const minA = dx >= 0 ? 1 : 91;
    const maxA = dx >= 0 ? 89 : 179;
    let bestAngle = minA + Math.round((maxA - minA) / 2);
    let bestPower = 500;
    let bestScore = Infinity;
    for (let a = minA; a <= maxA; a++) {
      const p = computePowerForAngle(player, target, a);
      if (p >= 50 && p <= 1000) {
        const score = Math.abs(p - 500);
        if (score < bestScore) { bestScore = score; bestAngle = a; bestPower = p; }
      }
    }
    aiState.targetAngle = bestAngle;
    aiState.targetPower = bestPower;
  } else {
    // EXE: harmonic scan (ai_inject_noise → angle space exploration → ai_compute_power)
    // base_angle: random start within valid hemisphere (EXE: min_angle + rand(shot_range))
    // All generators summed → angle offset; power derived analytically for that angle.
    const noiseState = getNoiseState(player, noiseParams);
    const shotNum = noiseState.shotNumber++;

    const baseAngle = minAngle + random(NOISE_SHOT_RANGE);
    let angleOffset = 0;
    for (let i = 0; i < noiseState.generators.length; i++) {
      angleOffset += evaluateHarmonics(noiseState.generators[i], shotNum) * noiseParams[i] / 100;
    }

    const angle = clamp(Math.round(baseAngle + angleOffset), 1, 179);

    // Wind compensation: estimate wind drift and adjust target.x
    // Skip if wind opposes shot direction (EXE behavior: only correct when wind aids)
    // Wind displacement = 0.5 * wind_accel * t², wind_accel = WIND_FACTOR * wind = 0.2 * wind
    // Flight time t ≈ |dx| / (cos(angle) * power * MAX_SPEED/1000)
    // We estimate power without wind first, then use it to derive flight time.
    const WIND_FACTOR_AI = 0.2;  // matches physics.js WIND_FACTOR
    const MAX_SPEED_AI = 400;    // matches physics.js MAX_SPEED
    let windTarget = target;
    if (_wind !== 0 && Math.sign(dx) === Math.sign(_wind)) {
      const cosA = Math.cos(angle * Math.PI / 180);
      if (Math.abs(cosA) > 0.01) {
        const rawPwr = computePowerForAngle(player, target, angle);
        const hVel = cosA * (rawPwr / 1000) * MAX_SPEED_AI;
        if (hVel > 0.1) {
          const flightTime = Math.abs(dx) / hVel;
          const windDisp = 0.5 * WIND_FACTOR_AI * _wind * flightTime * flightTime;
          windTarget = { x: target.x - windDisp, y: target.y };
        }
      }
    }
    const power = computePowerForAngle(player, windTarget, angle);

    aiState.targetAngle = angle;
    aiState.targetPower = clamp(power, 50, 1000);
  }

  return aiState;
}

// Select target: sticky — prefer previous target if alive, else fall back to nearest enemy.
// EXE: player struct +0x8E/+0x90 stores previous target far ptr (Moron AI at 0x38B4E reads it).
// EXE: selects nearest valid target (by horizontal distance in Moron); web uses Euclidean.
function selectTarget(shooter) {
  // Sticky: return previous target if still alive
  const last = playerLastTarget.get(shooter);
  if (last && last.alive) return last;

  // Fall back: find nearest alive enemy
  let bestTarget = null;
  let bestDist = Infinity;
  for (const p of players) {
    if (p === shooter || !p.alive) continue;
    const dx = p.x - shooter.x;
    const dy = p.y - shooter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      bestTarget = p;
    }
  }
  playerLastTarget.set(shooter, bestTarget);
  return bestTarget;
}

// Select weapon based on AI intelligence and inventory
function selectWeapon(player, target, aiType) {
  const dx = target.x - player.x;
  const dy = target.y - player.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Smarter AIs use better weapons when available
  if (aiType >= AI_TYPE.CHOOSER) {
    // Try nukes for distant targets
    if (dist > 100 && player.inventory[WPN.NUKE] > 0) return WPN.NUKE;
    if (player.inventory[WPN.BABY_NUKE] > 0) return WPN.BABY_NUKE;
    if (player.inventory[WPN.MIRV] > 0) return WPN.MIRV;
  }

  if (aiType >= AI_TYPE.SHOOTER) {
    if (player.inventory[WPN.MISSILE] > 0) return WPN.MISSILE;
  }

  return WPN.BABY_MISSILE;
}

let _wind = 0;
export function setAIWind(w) { _wind = w; }

// AI turn state machine
const aiTurn = {
  phase: 'idle',  // idle, thinking, aiming, ready
  frames: 0,
  shot: null,
};

// Start AI turn
export function startAITurn(player) {
  aiTurn.phase = 'thinking';
  aiTurn.frames = 0;
  aiTurn.shot = null;
}

// Step AI turn, returns 'thinking' | 'aiming' | 'fire'
export function stepAITurn(player) {
  switch (aiTurn.phase) {
    case 'thinking':
      aiTurn.frames++;
      if (aiTurn.frames > 30) {  // ~0.5s "thinking" delay
        aiTurn.shot = aiComputeShot(player);
        player.selectedWeapon = aiTurn.shot.selectedWeapon;
        aiTurn.phase = 'aiming';
        aiTurn.frames = 0;
      }
      return 'thinking';

    case 'aiming':
      // Animate turret toward target angle
      aiTurn.frames++;
      const targetAngle = aiTurn.shot.targetAngle;
      const targetPower = aiTurn.shot.targetPower;

      // Move angle toward target (15ms/degree equivalent at 60fps ≈ 1 degree/frame)
      if (player.angle < targetAngle) {
        player.angle = Math.min(player.angle + 1, targetAngle);
      } else if (player.angle > targetAngle) {
        player.angle = Math.max(player.angle - 1, targetAngle);
      }

      // Move power toward target
      if (player.power < targetPower) {
        player.power = Math.min(player.power + 10, targetPower);
      } else if (player.power > targetPower) {
        player.power = Math.max(player.power - 10, targetPower);
      }

      // Check if done aiming
      if (player.angle === targetAngle && player.power === targetPower) {
        aiTurn.phase = 'idle';
        return 'fire';
      }
      return 'aiming';

    default:
      return 'thinking';
  }
}
