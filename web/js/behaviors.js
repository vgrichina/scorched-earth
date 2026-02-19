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

// Guidance weapon indices
const GUIDANCE = { HEAT: 37, BAL: 38, HORZ: 39, VERT: 40 };
const GUIDANCE_STRENGTH = 2.0;  // correction per second (0.04 per-step / dt=0.02)

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

    // Determine roll direction from horizontal velocity
    proj.rollDir = proj.vx >= 0 ? 1 : -1;
    proj.rollSpeed = Math.max(1, Math.abs(proj.vx) * 0.01);  // per-sec → per-step (0.5 * dt)

    return { explode: false, radius: 0, spawn: [], dirtAdd: false, skipDamage: true, keepAlive: true };
  }
  // Hit tank while rolling → explode
  return { explode: true, radius: weapon.param, spawn: [], dirtAdd: false, skipDamage: false };
}

function rollerFlightStep(proj, weapon) {
  if (!proj.rolling) return { split: false, spawn: [], remove: false };

  proj.rollFrames++;
  if (proj.rollFrames > proj.maxRollFrames) {
    // Explode at current position
    return { split: true, spawn: [], remove: true, explodeHere: true, radius: weapon.param };
  }

  const sx = Math.round(proj.x);
  // Find terrain surface at this x
  const terrY = (sx >= 0 && sx < config.screenWidth) ? terrain[sx] : config.screenHeight;

  // Move along terrain surface
  proj.x += proj.rollDir * Math.min(proj.rollSpeed, 2);
  proj.y = terrY - 1;

  // Slow down
  proj.rollSpeed *= 0.98;
  if (proj.rollSpeed < 0.3) {
    return { split: true, spawn: [], remove: true, explodeHere: true, radius: weapon.param };
  }

  // Check if we've rolled off the edge
  if (proj.x < 0 || proj.x >= config.screenWidth) {
    return { split: false, spawn: [], remove: true };
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

// --- Guidance system: steer projectile during flight ---
// Called each physics step. Checks if attacker has guidance items and applies correction.
export function applyGuidance(proj) {
  if (proj.isNapalmParticle || proj.isSubWarhead || proj.rolling) return;

  const attacker = players[proj.attackerIdx];
  if (!attacker) return;

  // Heat Guidance: steer toward nearest enemy tank
  if (attacker.inventory[GUIDANCE.HEAT] > 0) {
    let bestDist = Infinity;
    let targetX = proj.x, targetY = proj.y;
    for (const p of players) {
      if (p === attacker || !p.alive) continue;
      const dx = p.x - proj.x;
      const dy = (p.y - 4) - proj.y;  // aim at tank center
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        targetX = p.x;
        targetY = p.y - 4;
      }
    }
    if (bestDist < Infinity) {
      const dx = targetX - proj.x;
      const dy = targetY - proj.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1) {
        proj.vx += (dx / dist) * GUIDANCE_STRENGTH;
        proj.vy -= (dy / dist) * GUIDANCE_STRENGTH;  // screen y inverted
      }
    }
  }

  // Horizontal Guidance: eliminate horizontal drift
  if (attacker.inventory[GUIDANCE.HORZ] > 0) {
    // Store original aim direction on first call
    if (proj.guidanceOrigVx === undefined) {
      proj.guidanceOrigVx = proj.vx;
    }
    const drift = proj.vx - proj.guidanceOrigVx;
    proj.vx -= drift * GUIDANCE_STRENGTH * 2;
  }

  // Vertical Guidance: eliminate vertical drift
  if (attacker.inventory[GUIDANCE.VERT] > 0) {
    if (proj.guidanceOrigVy === undefined) {
      proj.guidanceOrigVy = proj.vy;
    }
    const drift = proj.vy - proj.guidanceOrigVy;
    proj.vy -= drift * GUIDANCE_STRENGTH * 2;
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
  proj.vx *= 0.93;
  proj.vy *= 0.93;

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
