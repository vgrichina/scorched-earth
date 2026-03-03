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
// Modeled here as three independent random(64) values per aiComputeShot call.
function getSpoilerNoise() {
  return [random(64), random(64), random(64)];
}

// EXE: ai_inject_noise (file 0x25DE9-0x2610F)
// Budget-driven harmonics with shot-number domain (not wall-clock).
// DS constants: π=DS:0x322E, 2π=DS:0x3236, 4.0=DS:0x323E, 0.5=DS:0x3242, 2.0=DS:0x3246
const NOISE_SHOT_RANGE = 90;  // angular range for budget calculation
const POWER_NOISE_SCALE = 5;  // degrees-to-power-units scaling

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

// Main AI entry: compute shot parameters
export function aiComputeShot(player) {
  const effectiveType = getEffectiveType(player.aiType);
  // Spoiler: random amplitudes per solve (EXE: random budget at 0x29564)
  const noise = effectiveType === AI_TYPE.SPOILER
    ? getSpoilerNoise()
    : (AI_NOISE[effectiveType] || AI_NOISE[AI_TYPE.MORON]);

  // Select target: nearest alive enemy
  const target = selectTarget(player);
  if (!target) {
    // No target — fire straight up
    aiState.targetAngle = 90;
    aiState.targetPower = 200;
    aiState.selectedWeapon = WPN.BABY_MISSILE;
    return aiState;
  }

  // Select weapon based on AI type
  aiState.selectedWeapon = selectWeapon(player, target, effectiveType);

  // Compute ideal angle and power using analytic ballistics
  const solution = solveBallistic(player, target);

  // EXE: scanning noise — shot-number domain, budget-driven harmonics
  // Each noise param generates independent harmonic set; param count per AI type
  // controls which aspects get noise (more params = wider noise)
  // Sentient: empty noise array = perfect accuracy (no noise injection)
  let angleNoise = 0;
  let powerNoise = 0;

  if (noise.length > 0) {
    const noiseState = getNoiseState(player, noise);
    const shotNum = noiseState.shotNumber++;

    // Angle noise: param[0] + param[2] if present (scaled by noise_amplitude)
    angleNoise = evaluateHarmonics(noiseState.generators[0], shotNum) * noise[0] / 100;
    if (noise.length >= 3) {
      angleNoise += evaluateHarmonics(noiseState.generators[2], shotNum) * noise[2] / 100;
    }

    // Power noise: param[1] if present (no power noise for 1-param types like Shooter)
    if (noise.length >= 2) {
      powerNoise = evaluateHarmonics(noiseState.generators[1], shotNum) * noise[1] / 100 * POWER_NOISE_SCALE;
    }
  }

  aiState.targetAngle = clamp(Math.round(solution.angle + angleNoise), 0, 180);
  aiState.targetPower = clamp(Math.round(solution.power + powerNoise), 50, 1000);

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

// Analytic ballistic solver
// EXE: shark.cpp solver at file 0x24F01-0x2610F
// EXE: uses FPU math (INT 34h-3Dh Borland emulation), decoded in disasm/ai_solver_decoded.txt
// EXE: player struct stride 0x6C (108 bytes), base at DS:CEB8
// Computes angle + power to hit target, accounting for gravity and wind
function solveBallistic(shooter, target) {
  const dx = target.x - shooter.x;
  const dy = -(target.y - shooter.y);  // positive = up in world coords

  const dt = 0.02;  // must match physics.js DT
  // EXE-derived: gravity = 2500 × G × k² = 400 × config.gravity (k=MAX_SPEED/1000)
  const gravity = 400.0 * config.gravity;  // must match physics.js GRAVITY_FACTOR
  const windAccel = game_wind() * 0.2;  // must match physics.js WIND_FACTOR (1.25 × k²)
  const maxSpeed = 400;  // must match physics.js MAX_SPEED

  // Effective horizontal distance accounting for wind
  // Wind pushes projectile, so adjust target position
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Direct angle to target
  const directAngle = Math.atan2(dy, dx);

  // Try a range of launch angles, pick best
  let bestAngle = directAngle * 180 / Math.PI;
  let bestPower = 500;
  let bestError = Infinity;

  // Search angles from high arc to direct
  const angleStart = dx > 0 ? 20 : 100;
  const angleEnd = dx > 0 ? 90 : 160;
  const angleStep = 3;

  for (let angleDeg = angleStart; angleDeg <= angleEnd; angleDeg += angleStep) {
    const angleRad = angleDeg * Math.PI / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    if (Math.abs(cosA) < 0.01) continue;

    // Time to reach target x: dx = vx*t + 0.5*wind*t^2
    // Simplified: t ≈ dx / (vx + wind*t/2)
    // First estimate without wind
    // power = speed / maxSpeed * 1000
    // vx = cos(a) * speed
    // vy = sin(a) * speed
    // At time t: x = vx*t + windAccel*t^2/2, y = vy*t - gravity*t^2/2

    // From y equation: 0 = vy*t - g*t^2/2 - dy → t = (vy + sqrt(vy^2 - 2*g*dy)) / g
    // From x equation: speed = dx / (cos(a) * t - windAccel*t^2/(2*speed... recursive))

    // Iterative approach: guess power, simulate, refine
    for (let powerGuess = 200; powerGuess <= 1000; powerGuess += 50) {
      const speed = (powerGuess / 1000) * maxSpeed;
      const vx = cosA * speed;
      const vy = sinA * speed;

      // Simulate trajectory to find where it lands near target x
      let px = 0, py = 0, pvx = vx, pvy = vy;
      let landed = false;
      const maxSteps = 500;

      for (let step = 0; step < maxSteps; step++) {
        pvy -= gravity * dt;
        pvx += windAccel * dt;
        px += pvx * dt;
        py += pvy * dt;  // world coords

        // Check if we've passed the target x
        if ((dx > 0 && px >= dx) || (dx < 0 && px <= dx)) {
          const error = Math.abs(py - dy) + Math.abs(px - dx) * 0.5;
          if (error < bestError) {
            bestError = error;
            bestAngle = angleDeg;
            bestPower = powerGuess;
          }
          landed = true;
          break;
        }

        // Gone too far vertically
        if (py < dy - 200) break;
      }
    }
  }

  // Fine-tune around best found angle
  for (let da = -3; da <= 3; da++) {
    for (let dp = -50; dp <= 50; dp += 25) {
      const angleDeg = bestAngle + da;
      const power = bestPower + dp;
      if (angleDeg < 0 || angleDeg > 180 || power < 50 || power > 1000) continue;

      const angleRad = angleDeg * Math.PI / 180;
      const speed = (power / 1000) * maxSpeed;
      const vx = Math.cos(angleRad) * speed;
      const vy = Math.sin(angleRad) * speed;

      let px = 0, py = 0, pvx = vx, pvy = vy;
      for (let step = 0; step < 500; step++) {
        pvy -= gravity * dt;
        pvx += windAccel * dt;
        px += pvx * dt;
        py += pvy * dt;

        if ((dx > 0 && px >= dx) || (dx < 0 && px <= dx)) {
          const error = Math.abs(py - dy) + Math.abs(px - dx) * 0.5;
          if (error < bestError) {
            bestError = error;
            bestAngle = angleDeg;
            bestPower = power;
          }
          break;
        }
        if (py < dy - 200) break;
      }
    }
  }

  return { angle: bestAngle, power: bestPower };
}

// Access game wind without circular dependency
function game_wind() {
  // Import at call time to avoid circular dependency
  // game.wind is set by game.js
  return _wind;
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
