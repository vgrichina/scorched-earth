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

// Guidance weapon indices
// EXE VERIFIED: Bal Guidance (idx 38) overridden with Earth Disrupter at fire_weapon
// 0x3070C — handled in game.js fireWeapon(). Bal Guidance is not a valid guidance type.
const GUIDANCE = { HEAT: 37, BAL: 38, HORZ: 39, VERT: 40 };
const GUIDANCE_STRENGTH = 2.0;  // correction magnitude per step (applied via wind_x/wind_y)

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
        proj.rollDir = -proj.rollDir;
        proj.rollSpeed *= 0.8;
        proj.x = proj.x < 0 ? 1 : config.screenWidth - 2;
        break;
      case WALL.PADDED:
        proj.rollDir = -proj.rollDir;
        proj.rollSpeed *= 0.5;
        proj.x = proj.x < 0 ? 1 : config.screenWidth - 2;
        break;
      case WALL.SPRING:
        proj.rollDir = -proj.rollDir;
        proj.rollSpeed *= 1.2;
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
    if (pixel > 0 && pixel < 80) {
      return { split: true, spawn: [], remove: true, explodeHere: true, radius: weapon.param };
    }
  }

  return { split: false, spawn: [], remove: false };
}

// --- Bounce/LeapFrog (0x0006): reflect velocity on terrain, param = bounce count ---
// EXE: handler seg 0x2382 (file 0x2A220), struct param = max bounce count
function bhvBounce(proj, weapon, hitResult) {
  if (hitResult !== 'hit_terrain') {
    return { explode: true, radius: 20, spawn: [], dirtAdd: false, skipDamage: false };
  }

  if (!proj.bounceCount) proj.bounceCount = 0;
  proj.bounceCount++;

  if (proj.bounceCount >= weapon.param) {
    // Final bounce: explode
    return { explode: true, radius: 20, spawn: [], dirtAdd: false, skipDamage: false };
  }

  // Bounce: reflect vy, slight randomization, small explosion at bounce point
  proj.vy = Math.abs(proj.vy) * 0.7;
  proj.vx *= 0.9;
  // Move projectile above terrain
  proj.y -= 3;
  proj.active = true;

  return { explode: true, radius: 5, spawn: [], dirtAdd: false, skipDamage: false, keepAlive: true };
}

// --- MIRV (0x0239): detect apogee (vy sign flip), spawn 6 sub-warheads ---
// EXE: handler seg 0x25D5 (file 0x2C750)
// EXE: apogee detection — velocity sign comparison at DS:E4DC/E4E4
function bhvMirv(proj, weapon) {
  // If hit something before splitting, just explode
  return { explode: true, radius: 20, spawn: [], dirtAdd: false, skipDamage: false };
}

function mirvFlightCheck(proj, weapon) {
  if (proj.hasSplit) return { split: false, spawn: [], remove: false };

  // Detect apogee: vy was positive (going up), now negative or zero (coming down)
  if (proj.prevVy !== undefined && proj.prevVy > 0 && proj.vy <= 0) {
    proj.hasSplit = true;
    const subCount = 6;
    const spread = weapon.param === 1 ? 3.0 : 1.5;  // Death's Head wider spread
    const subRadius = weapon.param === 1 ? 25 : 15;
    const spawn = [];

    for (let i = 0; i < subCount; i++) {
      const angle = ((i - (subCount - 1) / 2) / subCount) * spread;
      spawn.push({
        x: proj.x,
        y: proj.y,
        vx: proj.vx + Math.sin(angle) * 100,
        vy: proj.vy - Math.abs(Math.cos(angle)) * 25,
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

// --- Napalm (0x01A0): fire particle spread ---
// EXE: handler seg 0x26E6 (file 0x2D860), 99-slot particle pool, 6-byte structs
// EXE: negative param → dirt particles (Ton of Dirt), positive → fire particles
function bhvNapalm(proj, weapon) {
  const particleCount = Math.min(Math.abs(weapon.param), 20);
  const isDirt = weapon.param < 0;
  const spawn = [];

  for (let i = 0; i < particleCount; i++) {
    const angle = (Math.random() * Math.PI * 2);
    const speed = Math.random() * 150 + 50;  // per-second (was 3+1 per-step)
    spawn.push({
      x: proj.x,
      y: proj.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.5 + 50,  // bias upward
      weaponIdx: proj.weaponIdx,
      attackerIdx: proj.attackerIdx,
      isNapalmParticle: true,
      isDirtParticle: isDirt,
      napalmLife: 60 + random(40),
      trail: [],
      active: true,
    });
  }

  return { explode: true, radius: 5, spawn, dirtAdd: false, skipDamage: false };
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
  const spawn = [];
  for (let i = 0; i < 15; i++) {
    const angle = (Math.random() * Math.PI * 2);
    const speed = Math.random() * 100 + 25;  // per-second (was 2+0.5 per-step)
    spawn.push({
      x: proj.x,
      y: proj.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.3 + 25,
      weaponIdx: proj.weaponIdx,
      attackerIdx: proj.attackerIdx,
      isNapalmParticle: true,
      isDirtParticle: true,
      napalmLife: 80 + random(40),
      trail: [],
      active: true,
    });
  }
  return { explode: false, radius: 0, spawn, dirtAdd: false, skipDamage: true };
}

// --- Dirt Charge (0x013E): small explosion + dirt fill ---
// EXE: handler seg 0x162C (file 0x1CAC0)
function bhvDirtCharge(proj) {
  return { explode: true, radius: 15, spawn: [], dirtAdd: true, skipDamage: false };
}

// --- Funky Bomb: scatter 5-10 sub-bombs from screen top ---
// EXE: handler seg 0x1DCE (file 0x246E0), spawns 5-10 sub-bombs as Baby Missiles
function bhvFunky(proj, weapon) {
  const count = random(6) + 5;  // 5-10 sub-bombs
  const spawn = [];
  const cx = Math.round(proj.x);

  for (let i = 0; i < count; i++) {
    const spreadX = cx + random(weapon.param * 2) - weapon.param;
    spawn.push({
      x: clamp(spreadX, 10, config.screenWidth - 10),
      y: 16,  // just below HUD
      vx: (Math.random() - 0.5) * 100,  // per-second (was *2 per-step)
      vy: -(Math.random() * 100 + 50),  // downward, per-second
      weaponIdx: 2,  // sub-bombs act as Baby Missiles
      attackerIdx: proj.attackerIdx,
      isSubWarhead: true,
      subRadius: 10,
      trail: [],
      active: true,
    });
  }

  return { explode: true, radius: 15, spawn, dirtAdd: false, skipDamage: false };
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

const HEAT_PROXIMITY = 60;  // pixel radius for heat-seek trigger

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

// Called each physics step. Checks trigger condition and applies one-shot correction.
// EXE: per-step check at extras.cpp 0x2263D
export function applyGuidance(proj) {
  if (proj.isNapalmParticle || proj.isSubWarhead || proj.rolling) return;

  // After trigger: apply persistent correction vector each step
  // EXE: callback at +0x4C applies wind_x/wind_y correction per step
  if (proj.guidanceCorrX !== undefined) {
    proj.vx += proj.guidanceCorrX * GUIDANCE_STRENGTH;
    proj.vy += proj.guidanceCorrY * GUIDANCE_STRENGTH;
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
    // EXE: call shark.cpp heat_seek — triggers when close to any enemy
    const dx = target.x - proj.x;
    const dy = target.y - proj.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < HEAT_PROXIMITY) {
      proj.guidanceCorrX = Math.sign(dx);
      proj.guidanceCorrY = (target.y > proj.y) ? -1 : 1;  // screen y inverted
      proj.guidanceType = 0;  // consumed
    }
  }
}

// --- Napalm particle flight step ---
// EXE: napalm particle pool at seg 0x26E6 (file 0x2D860), 6-byte per-particle structs
// EXE: velocity damping 0.7x from DS:1D60 (float constant), threshold DS:1D68 = 0.001
export function napalmParticleStep(proj) {
  if (!proj.isNapalmParticle) return { remove: false };

  proj.napalmLife--;
  if (proj.napalmLife <= 0) return { remove: true };

  // Dampen velocity 0.7x per frame (from RE: DS:1D60)
  proj.vx *= 0.7;
  proj.vy *= 0.7;

  // Check if speed is below threshold
  const speedSq = proj.vx * proj.vx + proj.vy * proj.vy;
  if (speedSq < 25) return { remove: true };  // per-sec² threshold (was 0.01 per-step²)

  // Napalm particles interact with terrain
  const sx = Math.round(proj.x);
  const sy = Math.round(proj.y);
  if (sx >= 0 && sx < config.screenWidth && sy >= 0 && sy < config.screenHeight) {
    const pixel = getPixel(sx, sy);
    if (pixel >= 105) {
      if (proj.isDirtParticle) {
        // Dirt particle: add terrain at this position
        return { remove: true, addDirt: true };
      } else {
        // Fire particle: burn terrain (small crater)
        return { remove: true, burnRadius: 3 };
      }
    }
  }

  return { remove: false };
}
