// Scorched Earth - Weapon Behavior System
// EXE source: extras.cpp (seg 0x1895, file base 0x20EA0)
// EXE: central dispatch at file 0x1C6C8 — far call via weapon struct +0C:+0A
//   lcall [weapon_idx * 52 + DS:0x1200] selects handler by far ptr in struct
// 13 behavior handlers dispatched by BHV type code
// Each handler: onHit(proj, hitResult, ctx) → array of new projectiles to spawn

import { config } from './config.js';
import { BHV, WEAPONS } from './weapons.js';
import { terrain } from './terrain.js';
import { random, clamp } from './utils.js';
import { setPixel, getPixel } from './framebuffer.js';
import { players } from './tank.js';
import { WALL, resolvedWallType } from './physics.js';
import { PLAYER_COLOR_MAX, TERRAIN_THRESHOLD } from './constants.js';

// Guidance weapon indices
// EXE VERIFIED: Bal Guidance (idx 38) overridden with Earth Disrupter at fire_weapon
// 0x3070C — handled in game.js fireWeapon(). Bal Guidance is not a valid guidance type.
const GUIDANCE = { HEAT: 37, BAL: 38, HORZ: 39, VERT: 40 };
// EXE VERIFIED: Heat guidance uses continuous attraction force model (callback at 0x2589C).
// Correction = GUIDANCE_K * DT / distSq^(1/4), where GUIDANCE_K = DS:0x3224 = 10000.0.
// For Horz/Vert, a constant ±1 correction per step is fine (they redirect).
const GUIDANCE_K = 10000.0;     // DS:0x3224 — guidance correction multiplier
const GUIDANCE_DT = 0.02;       // DS:CEAC default timestep
const GUIDANCE_MIN_DISTSQ = 0.001;  // DS:0x321C — skip if closer than this

// Behavior dispatch — called when a projectile hits something
// Returns: { explode: bool, radius: number, spawn: projectile[], dirtAdd: bool, skipDamage: bool }
export function handleBehavior(proj, hitResult) {
  const weapon = WEAPONS[proj.weaponIdx];
  if (!weapon) return defaultResult(proj);

  switch (weapon.bhv) {
    case BHV.STANDARD:  return bhvStandard(proj, weapon, hitResult);
    case BHV.TRACER:    return bhvTracer(proj, weapon, hitResult);
    case BHV.ROLLER:    return bhvRoller(proj, weapon, hitResult);
    case BHV.BOUNCE:    return bhvBounce(proj, weapon, hitResult);
    case BHV.MIRV:      return bhvMirv(proj, weapon, hitResult);
    case BHV.NAPALM:    return bhvNapalm(proj, weapon, hitResult);
    case BHV.DIRT:      return bhvDirt(proj, weapon, hitResult);
    case BHV.TUNNEL:    return bhvTunnel(proj, weapon, hitResult);
    case BHV.PLASMA:    return bhvPlasma(proj, weapon, hitResult);
    case BHV.RIOT:      return bhvRiot(proj, weapon, hitResult);
    case BHV.DISRUPTER: return bhvDisrupter(proj, weapon, hitResult);
    case BHV.LIQUID:    return bhvLiquid(proj, weapon, hitResult);
    case BHV.DIRT_CHARGE: return bhvDirtCharge(proj, weapon, hitResult);
    case BHV.NONE:
      // Funky Bomb special case (idx 7)
      if (proj.weaponIdx === 7) return bhvFunky(proj, weapon, hitResult);
      // Popcorn Bomb special case (idx 1)
      if (proj.weaponIdx === 1) return bhvPopcorn(proj, weapon, hitResult);
      return defaultResult(proj);
    default:
      return defaultResult(proj);
  }
}

// Called each physics step for in-flight behaviors (MIRV apogee, roller terrain-follow)
// Returns: { split: bool, spawn: projectile[], remove: bool }
export function handleFlightBehavior(proj) {
  const weapon = WEAPONS[proj.weaponIdx];
  if (!weapon) return { split: false, spawn: [], remove: false };

  switch (weapon.bhv) {
    case BHV.MIRV:   return mirvFlightCheck(proj, weapon);
    case BHV.ROLLER: return rollerFlightStep(proj, weapon);
    default:
      return { split: false, spawn: [], remove: false };
  }
}

function defaultResult(proj) {
  const weapon = WEAPONS[proj.weaponIdx];
  const radius = weapon ? Math.abs(weapon.param) || 10 : 10;
  return { explode: true, radius, spawn: [], dirtAdd: false, skipDamage: false };
}

// --- Standard (0x0021): simple blast with parameterized radius ---
// EXE: handler seg 0x3D1E (file 0x43BE0), param = blast radius from struct +0E
function bhvStandard(proj, weapon) {
  return { explode: true, radius: weapon.param, spawn: [], dirtAdd: false, skipDamage: false };
}

// --- Tracer (0x0002): no damage, no crater, path only ---
// EXE: handler seg 0x3D1E (shared with standard), skips explosion/damage path
function bhvTracer() {
  return { explode: false, radius: 0, spawn: [], dirtAdd: false, skipDamage: true };
}

// --- Roller (0x0003): two-phase — flight then terrain-follow ---
// EXE: on_impact handler at file 0x365D3 (seg 0x2FBD:0x0003)
// EXE: per_frame roller at file 0x3684B (seg 0x2FBD:0x027B)
// EXE: terrain check: pixel >= 105 → terrain surface
function bhvRoller(proj, weapon, hitResult) {
  // If roller hits terrain, start rolling phase
  if (hitResult === 'hit_terrain' && !proj.rolling) {
    proj.rolling = true;
    proj.rollFrames = 0;
    proj.maxRollFrames = 120;  // max frames of rolling

    // EXE: valley scanning — look 40px left and right, roll toward deeper valley
    const sx = Math.round(proj.x);
    let leftDepth = 0, rightDepth = 0;
    for (let d = 1; d <= 40; d++) {
      const lx = sx - d, rx = sx + d;
      if (lx >= 0 && lx < config.screenWidth) leftDepth += terrain[lx];
      if (rx >= 0 && rx < config.screenWidth) rightDepth += terrain[rx];
    }
    // Higher terrain[] Y = deeper valley (screen coords)
    proj.rollDir = rightDepth >= leftDepth ? 1 : -1;
    proj.rollSpeed = Math.max(1, Math.abs(proj.vx) * 0.01);

    return { explode: false, radius: 0, spawn: [], dirtAdd: false, skipDamage: true, keepAlive: true };
  }
  // Hit tank while rolling → explode
  return { explode: true, radius: weapon.param, spawn: [], dirtAdd: false, skipDamage: false };
}

function rollerFlightStep(proj, weapon) {
  if (!proj.rolling) return { split: false, spawn: [], remove: false };

  proj.rollFrames++;
  if (proj.rollFrames > proj.maxRollFrames) {
    return { split: true, spawn: [], remove: true, explodeHere: true, radius: weapon.param };
  }

  const sx = Math.round(proj.x);
  const terrY = (sx >= 0 && sx < config.screenWidth) ? terrain[sx] : config.screenHeight;

  // Move along terrain surface
  proj.x += proj.rollDir * Math.min(proj.rollSpeed, 2);
  proj.y = terrY - 1;

  // EXE: downhill acceleration — when rolling into deeper terrain, speed up
  const nextX = Math.round(proj.x);
  if (nextX >= 0 && nextX < config.screenWidth) {
    const nextTerrY = terrain[nextX];
    if (nextTerrY > terrY) {
      // Going downhill (screen Y increases = deeper)
      proj.rollSpeed += 0.3;
    }
  }

  // Friction deceleration
  proj.rollSpeed *= 0.98;
  if (proj.rollSpeed < 0.3) {
    return { split: true, spawn: [], remove: true, explodeHere: true, radius: weapon.param };
  }

  // EXE: wall interaction for rollers
  if (proj.x < 0 || proj.x >= config.screenWidth) {
    const wt = (config.wallType === WALL.ERRATIC || config.wallType === WALL.RANDOM) ? resolvedWallType : config.wallType;
    switch (wt) {
      case WALL.WRAP:
        proj.x = proj.x < 0 ? config.screenWidth - 1 : 0;
        break;
      case WALL.RUBBER:
        // EXE: coeff magnitude 1.0 — perfect reflection for rollers
        proj.rollDir = -proj.rollDir;
        proj.x = proj.x < 0 ? 1 : config.screenWidth - 2;
        break;
      case WALL.PADDED:
        // EXE: coeff magnitude 0.5 — halve speed
        proj.rollDir = -proj.rollDir;
        proj.rollSpeed *= 0.5;
        proj.x = proj.x < 0 ? 1 : config.screenWidth - 2;
        break;
      case WALL.SPRING:
        // EXE: coeff magnitude 2.0 — double speed
        proj.rollDir = -proj.rollDir;
        proj.rollSpeed *= 2.0;
        proj.x = proj.x < 0 ? 1 : config.screenWidth - 2;
        break;
      case WALL.CONCRETE:
        return { split: true, spawn: [], remove: true, explodeHere: true, radius: weapon.param };
      default:  // NONE
        return { split: false, spawn: [], remove: true };
    }
  }

  // Check if we hit a tank at current position
  const px = Math.round(proj.x);
  const py = Math.round(proj.y);
  if (px >= 0 && px < config.screenWidth && py >= 0 && py < config.screenHeight) {
    const pixel = getPixel(px, py);
    if (pixel > 0 && pixel < PLAYER_COLOR_MAX) {
      return { split: true, spawn: [], remove: true, explodeHere: true, radius: weapon.param };
    }
  }

  return { split: false, spawn: [], remove: false };
}

// --- Bounce/LeapFrog (0x0006): damage_type countdown with decreasing radii ---
// EXE: handler at file 0x2A226 (seg 0x1F7F:0x4036). Uses damage_type (player+0x54)
// as countdown: initial=2, decrements each bounce. Radius from DS:0x50CA table:
//   damage_type 2→30, 1→25, 0→20 (all × EXPLOSION_SCALE). Speed ÷ 1.5 per bounce.
const BOUNCE_RADIUS_TABLE = [20, 25, 30]; // DS:0x50CA, indexed by damage_type
function bhvBounce(proj, weapon, hitResult) {
  // Initialize damage_type countdown (EXE: hardcoded to 2 at file 0x21397)
  if (proj.damageType === undefined) proj.damageType = 2;

  const scale = [0.5, 1.0, 1.5][config.explosionScale] || 1.0;
  const radius = Math.floor(BOUNCE_RADIUS_TABLE[proj.damageType] * scale);

  if (hitResult !== 'hit_terrain') {
    return { explode: true, radius, spawn: [], dirtAdd: false, skipDamage: false };
  }

  if (proj.damageType <= 0) {
    // Final bounce: explode with smallest radius (20 × scale)
    return { explode: true, radius, spawn: [], dirtAdd: false, skipDamage: false };
  }

  // Bounce: decrement damage_type, reduce speed by ÷1.5, reflect vy
  proj.damageType--;
  const dampFactor = 1.0 / 1.5; // DS:0x50D0 = 1.5f
  proj.vx *= dampFactor;
  proj.vy = -Math.abs(proj.vy) * dampFactor;
  // Move projectile above terrain
  proj.y -= 3;
  proj.active = true;

  return { explode: true, radius, spawn: [], dirtAdd: false, skipDamage: false, keepAlive: true };
}

// --- MIRV (0x0239): detect apogee (vy sign flip), spawn sub-warheads ---
// EXE: handler seg 0x25D5 (file 0x2C750)
// EXE: apogee detection — velocity sign comparison at DS:E4DC/E4E4
// EXE: sub-warhead params from DS:0x529E/52A2/52A6 table indexed by weapon.param:
//   MIRV (param=0):        count=5, sub_radius=20, spread_coeff=50
//   Death's Head (param=1): count=9, sub_radius=35, spread_coeff=20
// EXE spread formula: vx_offset = (i - (count+1)) * coeff (all negative, left-biased)
// EXE: vy for sub-warheads is unchanged from parent (no angle math)
function bhvMirv(proj, weapon) {
  // If hit something before splitting, just explode
  return { explode: true, radius: 20, spawn: [], dirtAdd: false, skipDamage: false };
}

function mirvFlightCheck(proj, weapon) {
  if (proj.hasSplit) return { split: false, spawn: [], remove: false };

  // Detect apogee: vy was positive (going up), now negative or zero (coming down)
  if (proj.prevVy !== undefined && proj.prevVy > 0 && proj.vy <= 0) {
    proj.hasSplit = true;
    // EXE-verified: MIRV=5, Death's Head=9 sub-warheads (DS:0x52A2)
    const subCount  = weapon.param === 1 ? 9 : 5;
    // EXE-verified: explosion radius per sub-warhead (DS:0x529E)
    const subRadius = weapon.param === 1 ? 35 : 20;
    // EXE-verified: spread is purely horizontal (vx offset only, vy unchanged)
    // EXE formula: vx_offset = (i - (count+1)) * coeff — all offsets negative (left-biased)
    // MIRV:        offsets -300,-250,-200,-150,-100 relative to parent vx
    // Death's Head: offsets -200,-180,...,-40 relative to parent vx
    const coeff = weapon.param === 1 ? 20 : 50;  // DS:0x52A6 values
    const spawn = [];

    for (let i = 0; i < subCount; i++) {
      spawn.push({
        x: proj.x,
        y: proj.y,
        vx: proj.vx + (i - (subCount + 1)) * coeff,
        vy: proj.vy,  // EXE: vy unchanged
        weaponIdx: proj.weaponIdx,
        attackerIdx: proj.attackerIdx,
        isSubWarhead: true,
        subRadius: subRadius,
        trail: [],
        active: true,
      });
    }

    return { split: true, spawn, remove: true };
  }

  proj.prevVy = proj.vy;
  return { split: false, spawn: [], remove: false };
}

// --- Napalm (0x01A0): pixel-walking cellular automaton ---
// EXE: handler at file 0x2DA00 (seg 0x26E6). NOT velocity-based.
// Particles walk 1 pixel/step along terrain surfaces using check_direction().
// DS:1D60=0.7 is explosion damage falloff, DS:1D68=0.001 is explosion sqrt epsilon —
// NEITHER is related to napalm (previous 0.7× damping and speedSq<25 were fabricated).
// Single controller particle manages internal queue (linked list in EXE).
function bhvNapalm(proj, weapon) {
  const particleCount = Math.min(Math.abs(weapon.param), 99);  // EXE: 99-slot pool (DS:0xE9B2)
  const isDirt = weapon.param < 0;
  const ix = Math.round(proj.x);
  const iy = Math.round(proj.y);

  // Single controller particle with internal queue (EXE: linked list at DS:E754)
  const spawn = [{
    x: ix, y: iy,
    vx: 0, vy: 0,
    weaponIdx: proj.weaponIdx,
    attackerIdx: proj.attackerIdx,
    isNapalmParticle: true,
    isDirtParticle: isDirt,
    // Internal pixel-walking state
    napalmQueue: [{ x: ix, y: iy }],
    napalmExplosionPts: [],
    napalmStepsTotal: 0,
    napalmStepsSinceExp: 0,
    napalmParam: particleCount,    // max explosion points (EXE: spawn_count < param)
    napalmExplosionCount: 0,
    napalmFirePixels: [],          // track fire pixels for cleanup
    trail: [],
    active: true,
  }];

  // Fire mode: small initial explosion; Dirt mode: no explosion
  return { explode: !isDirt, radius: isDirt ? 0 : 5, spawn, dirtAdd: false, skipDamage: isDirt };
}

// --- Dirt Adding (0x0009): inverse crater, fill circle with terrain ---
// EXE: handler seg 0x15A0 (file 0x1C400), param=radius; param=0 → Dirt Tower (seg 0x2770)
function bhvDirt(proj, weapon) {
  const radius = weapon.param;
  if (radius === 0) {
    // Dirt Tower: vertical column of dirt
    return { explode: false, radius: 0, spawn: [], dirtAdd: true, skipDamage: true, dirtTower: true, dirtRadius: 30 };
  }
  return { explode: false, radius, spawn: [], dirtAdd: true, skipDamage: true };
}

// --- Tunneling (0x000A): line removal through terrain ---
// EXE: handler seg 0x151B (file 0x1BBB0), param sign = dig direction
function bhvTunnel(proj, weapon) {
  const depth = Math.abs(weapon.param);
  const goesDown = weapon.param < 0;
  return { explode: false, radius: depth, spawn: [], dirtAdd: false, skipDamage: true, tunnel: true, tunnelDown: goesDown };
}

// --- Plasma (0x000D): variable radius beam ---
// EXE: plasma_blast_handler at file 0x3616D (seg 0x2F76:0x000D)
// EXE: shares code segment 0x2F76 with riot_blast_handler and draw_laser_sight
function bhvPlasma(proj, weapon) {
  // Plasma Blast (param=0): radius based on speed
  const speed = Math.sqrt(proj.vx * proj.vx + proj.vy * proj.vy);
  const radius = weapon.param === 0 ? Math.floor(speed * 0.1 + 10) : 25;  // per-sec scale (was *5 per-step)
  return { explode: true, radius, spawn: [], dirtAdd: false, skipDamage: false };
}

// --- Riot (0x03BD): earth-moving explosion ---
// EXE: riot_blast_handler at file 0x3651D (seg 0x2F76:0x03BD)
function bhvRiot(proj, weapon) {
  return { explode: true, radius: weapon.param, spawn: [], dirtAdd: false, skipDamage: false, riotBlast: true };
}

// --- Disrupter (0x0004): force dirt to fall ---
// EXE: handler seg 0x2319 (file 0x29190)
function bhvDisrupter(proj) {
  return { explode: false, radius: 40, spawn: [], dirtAdd: false, skipDamage: true, disrupt: true };
}

// --- Liquid Dirt (0x0081): napalm-style dirt spread ---
// EXE: handler seg 0x15A0 (file 0x1C400), uses napalm particle system with isDirt
function bhvLiquid(proj) {
  const ix = Math.round(proj.x);
  const iy = Math.round(proj.y);
  const spawn = [{
    x: ix, y: iy,
    vx: 0, vy: 0,
    weaponIdx: proj.weaponIdx,
    attackerIdx: proj.attackerIdx,
    isNapalmParticle: true,
    isDirtParticle: true,
    napalmQueue: [{ x: ix, y: iy }],
    napalmExplosionPts: [],
    napalmStepsTotal: 0,
    napalmStepsSinceExp: 0,
    napalmParam: 15,
    napalmExplosionCount: 0,
    napalmFirePixels: [],
    trail: [],
    active: true,
  }];
  return { explode: false, radius: 0, spawn, dirtAdd: false, skipDamage: true };
}

// --- Dirt Charge (0x013E): small explosion + dirt fill ---
// EXE: handler seg 0x162C (file 0x1CAC0)
function bhvDirtCharge(proj) {
  return { explode: true, radius: 15, spawn: [], dirtAdd: true, skipDamage: false };
}

// --- Funky Bomb: scatter 5-10 sub-bombs from screen top ---
// EXE: handler seg 0x1DCE (file 0x246E0). Sub-bombs are NOT weapon projectiles in EXE —
// they are custom animated fall objects. Parent explosion radius = 20 (hardcoded at 0x24AA9).
// Sub-bomb radius = (random(10)+15) × EXPLOSION_SCALE (file 0x24B0C-0x24B23).
// Shield hit blocks sub-bomb spawn in EXE (shield damage=10, early return).
function bhvFunky(proj, weapon) {
  const count = random(6) + 5;  // 5-10 sub-bombs
  const spawn = [];
  const cx = Math.round(proj.x);
  // EXE sub-bomb radius: (random(10)+15) × EXPLOSION_SCALE float (DS:0x50DA)
  const scale = [0.5, 1.0, 1.5][config.explosionScale] || 1.0;

  for (let i = 0; i < count; i++) {
    const spreadX = cx + random(weapon.param * 2) - weapon.param;
    const subRadius = Math.floor((random(10) + 15) * scale);  // EXE: 15-24 × scale
    spawn.push({
      x: clamp(spreadX, 10, config.screenWidth - 10),
      y: 16,  // just below HUD
      vx: (Math.random() - 0.5) * 100,  // per-second
      vy: -(Math.random() * 100 + 50),  // downward, per-second
      weaponIdx: 2,  // approximation — EXE uses custom fall, not weapon projectiles
      attackerIdx: proj.attackerIdx,
      isSubWarhead: true,
      subRadius,
      trail: [],
      active: true,
    });
  }

  return { explode: true, radius: 20, spawn, dirtAdd: false, skipDamage: false };
}

// --- Popcorn Bomb (idx 1): scatter 5-10 sub-bombs from screen top ---
// EXE: similar to Funky Bomb but rains from above impact point
function bhvPopcorn(proj, weapon, hitResult) {
  const count = random(6) + 5;  // 5-10 sub-bombs
  const spawn = [];
  const cx = Math.round(proj.x);

  for (let i = 0; i < count; i++) {
    const spreadX = cx + random(160) - 80;  // +-80px scatter
    spawn.push({
      x: clamp(spreadX, 10, config.screenWidth - 10),
      y: 16,  // just below HUD
      vx: (Math.random() - 0.5) * 80,
      vy: -(Math.random() * 80 + 40),  // downward
      weaponIdx: 2,  // sub-bombs act as Baby Missiles (radius 10)
      attackerIdx: proj.attackerIdx,
      isSubWarhead: true,
      subRadius: 10,
      trail: [],
      active: true,
    });
  }

  return { explode: true, radius: 10, spawn, dirtAdd: false, skipDamage: false };
}

// --- Guidance system: one-shot course correction during flight ---
// EXE VERIFIED: extras.cpp 0x2263D — single-type, one-shot, consumed model.
// See REVERSE_ENGINEERING.md "Guidance System" section for full EXE pseudocode.
//
// At fire time: selectGuidanceType() picks highest-priority guidance the player
// has ammo for (Horz > Vert > Heat), decrements ammo, returns type constant.
// Per step: applyGuidance() checks spatial trigger condition for the stored type.
// On trigger: computes correction vector, stores as persistent wind_x/wind_y on
// the projectile, and sets guidanceType = 0 (consumed). After trigger, the
// correction vector is applied each step (EXE installs callback at +0x4C/+0x4E).

const HEAT_PROXIMITY = 40;  // EXE: DS:0x5186 = 40 pixel Euclidean distance threshold

// Select which guidance type to use at fire time. Consumes 1 ammo.
// EXE: priority order matches cascading if-else: Horz → Vert → Heat
// Returns: GUIDANCE constant or 0 (none)
export function selectGuidanceType(player) {
  // Priority: Horz > Vert > Heat (matches EXE cascading if-else order)
  if (player.inventory[GUIDANCE.HORZ] > 0) {
    player.inventory[GUIDANCE.HORZ]--;
    return GUIDANCE.HORZ;
  }
  if (player.inventory[GUIDANCE.VERT] > 0) {
    player.inventory[GUIDANCE.VERT]--;
    return GUIDANCE.VERT;
  }
  if (player.inventory[GUIDANCE.HEAT] > 0) {
    player.inventory[GUIDANCE.HEAT]--;
    return GUIDANCE.HEAT;
  }
  return 0;
}

// Find nearest enemy tank position for guidance targeting
function findNearestEnemy(proj) {
  const attacker = players[proj.attackerIdx];
  let bestDist = Infinity;
  let targetX = proj.x, targetY = proj.y;
  for (const p of players) {
    if (p === attacker || !p.alive) continue;
    const dx = p.x - proj.x;
    const dy = (p.y - 4) - proj.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      targetX = p.x;
      targetY = p.y - 4;
    }
  }
  return bestDist < Infinity ? { x: targetX, y: targetY } : null;
}

// Called each physics step. Checks trigger condition and applies correction.
// EXE: per-step check at extras.cpp 0x2263D, callback at 0x21A85
export function applyGuidance(proj) {
  if (proj.isNapalmParticle || proj.isSubWarhead || proj.rolling) return;

  // After Heat trigger: apply continuous attraction toward stored target
  // EXE callback (0x2589C): correction = GUIDANCE_K * dt / distSq^(1/4) per step
  if (proj.heatTarget) {
    const dx = proj.heatTarget.x - proj.x;
    const dy = proj.y - proj.heatTarget.y;  // EXE: fsubr = current.Y - target.Y
    const distSq = dx * dx + dy * dy;
    // Overshoot check: sign(dx) matches initial wind_x OR sign(dy) opposes wind_y
    let overshot = false;
    if (proj.heatWindX !== 0) {
      if ((dx < 0 && proj.heatWindX < 0) || (dx > 0 && proj.heatWindX > 0)) overshot = true;
    }
    if (proj.heatWindY !== 0) {
      if ((dy < 0 && proj.heatWindY > 0) || (dy > 0 && proj.heatWindY < 0)) overshot = true;
    }
    if (overshot) {
      // EXE fire_mode==2: remove callback, stop guidance
      delete proj.heatTarget;
      return;
    }
    if (distSq < GUIDANCE_MIN_DISTSQ) return;  // too close
    const correction = GUIDANCE_K * GUIDANCE_DT / Math.sqrt(Math.sqrt(distSq));
    proj.vx += correction * dx;
    proj.vy -= correction * dy;  // screen Y inverted: subtract to match EXE convention
    return;
  }

  // After Horz/Vert trigger: apply persistent ±1 correction each step
  if (proj.guidanceCorrX !== undefined) {
    proj.vx += proj.guidanceCorrX;
    proj.vy += proj.guidanceCorrY;
    return;
  }

  // No guidance or already consumed
  if (!proj.guidanceType) return;

  const target = findNearestEnemy(proj);
  if (!target) return;

  const px = Math.round(proj.x);
  const py = Math.round(proj.y);
  const tx = Math.round(target.x);
  const ty = Math.round(target.y);

  // EXE: cascading if-else check per type
  if (proj.guidanceType === GUIDANCE.HORZ) {
    // Horz Guidance: triggers when projectile Y == target Y (horizontal alignment)
    // EXE: if (proj_target_Y == current_Y) → compute horizontal correction
    if (Math.abs(py - ty) <= 2) {
      const dx = target.x - proj.x;
      if (Math.abs(dx) > 1) {
        proj.guidanceCorrX = Math.sign(dx);
        proj.guidanceCorrY = 0;
        proj.guidanceType = 0;  // consumed
      }
    }
  } else if (proj.guidanceType === GUIDANCE.VERT) {
    // Vert Guidance: triggers when projectile X == target X (vertical alignment)
    // EXE: if (proj_target_X == current_X) → apply vertical correction
    if (Math.abs(px - tx) <= 2) {
      proj.guidanceCorrX = 0;
      proj.guidanceCorrY = (target.y > proj.y) ? -1 : 1;  // screen y inverted
      proj.guidanceType = 0;  // consumed
    }
  } else if (proj.guidanceType === GUIDANCE.HEAT) {
    // Heat Guidance: triggers via proximity check
    // EXE: call ai_select_target (0x24F01) — Euclidean distance < DS:0x5186 (40 pixels)
    const dx = target.x - proj.x;
    const dy = target.y - proj.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < HEAT_PROXIMITY) {
      // Store target and initial wind direction for overshoot detection
      // EXE: wind_x = -sign(target.X - current.X), wind_y = -sign(target.Y - current.Y)
      proj.heatTarget = { x: target.x, y: target.y };
      proj.heatWindX = (target.x > proj.x) ? -1 : 1;
      proj.heatWindY = (target.y > proj.y) ? -1 : 1;
      proj.guidanceType = 0;  // consumed
    }
  }
}

// --- Napalm pixel-walking cellular automaton ---
// EXE: handler at file 0x2DA00, check_direction at file 0x2DFCC
// Particles walk 1 pixel/step along terrain surfaces. No velocity, no damping.
// Previous 0.7× damping (DS:1D60) and speedSq<25 (DS:1D68) were WRONG — those
// constants are explosion damage falloff and sqrt epsilon respectively.
const NAPALM_STEPS_PER_FRAME = 20;  // steps per game frame (EXE runs all 1000 synchronously)
const NAPALM_MAX_STEPS = 1000;      // EXE: frame_counter > 1000 → overflow
const FIRE_COLOR = 254;              // VGA 254 — fire pixel (DS:E702 = 0xFE)
const DIRT_NAPALM_COLOR = 130;       // mid-terrain palette for dirt deposition

// check_direction(x, y) — EXE at file 0x2DFCC
// Returns: 0 = terrain below (drop), -1 = go left, +1 = go right, 2 = erode upward
function checkNapalmDirection(x, y, pixelColor, wind) {
  // Check pixel below (y+1)
  if (y + 1 < config.screenHeight) {
    const below = getPixel(x, y + 1);
    if (below !== pixelColor && below >= TERRAIN_THRESHOLD)
      return 0;  // terrain below → drop down
  }
  // Check pixels left (x-1) and right (x+1) for terrain
  let canLeft = false, canRight = false;
  if (x > 0) {
    const left = getPixel(x - 1, y);
    canLeft = left !== pixelColor && left >= TERRAIN_THRESHOLD;
  }
  if (x < config.screenWidth - 1) {
    const right = getPixel(x + 1, y);
    canRight = right !== pixelColor && right >= TERRAIN_THRESHOLD;
  }
  // Wind direction determines preference when both available (EXE: DS:0x515A)
  if (canLeft && canRight) return wind > 0 ? 1 : -1;
  if (canLeft) return -1;
  if (canRight) return 1;
  return 2;  // no horizontal neighbor → erode upward
}

export function napalmParticleStep(proj, wind) {
  if (!proj.isNapalmParticle) return { remove: false };

  const queue = proj.napalmQueue;
  const isDirt = proj.isDirtParticle;
  const pixelColor = isDirt ? DIRT_NAPALM_COLOR : FIRE_COLOR;
  const W = config.screenWidth;
  const H = config.screenHeight;

  for (let step = 0; step < NAPALM_STEPS_PER_FRAME; step++) {
    // Done conditions: queue empty, enough explosion points, or step limit
    if (queue.length === 0 ||
        proj.napalmExplosionCount >= proj.napalmParam ||
        proj.napalmStepsTotal >= NAPALM_MAX_STEPS) {
      return {
        remove: true,
        napalmDamage: isDirt ? null : proj.napalmExplosionPts,
        napalmFirePixels: proj.napalmFirePixels,
        isDirt,
      };
    }

    const pos = queue.shift();
    const dir = checkNapalmDirection(pos.x, pos.y, pixelColor, wind || 0);

    let nx, ny;
    switch (dir) {
      case 0:  nx = pos.x; ny = pos.y + 1; break;      // drop down
      case -1: nx = pos.x - 1; ny = pos.y; break;       // go left
      case 1:  nx = pos.x + 1; ny = pos.y; break;       // go right
      case 2:  nx = pos.x; ny = pos.y - 1; break;       // erode upward
      default: continue;
    }

    // Bounds check
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;

    // Set fire/dirt pixel in framebuffer (EXE: draw_pixel at each step)
    setPixel(nx, ny, pixelColor);
    proj.napalmFirePixels.push({ x: nx, y: ny });

    // Add new position to queue (EXE: insert_particle)
    queue.push({ x: nx, y: ny });

    // Update proj position for rendering
    proj.x = nx;
    proj.y = ny;
    proj.trail.push({ x: nx, y: ny });
    if (proj.trail.length > 30) proj.trail.shift();

    proj.napalmStepsTotal++;
    proj.napalmStepsSinceExp++;

    // Every 20th step: record explosion point (EXE: explosion_pts[spawn_count])
    if (proj.napalmStepsSinceExp >= 20) {
      proj.napalmStepsSinceExp = 0;
      proj.napalmExplosionPts.push({ x: nx, y: ny });
      proj.napalmExplosionCount++;
    }
  }

  return { remove: false };
}
