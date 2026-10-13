// Scorched Earth - Shield System
// EXE source: shields.cpp (seg 0x31D8, file base 0x38780)
// EXE: shield config table at DS:0x616C, 6 entries × 16 bytes (None + 5 shields)
// EXE: flat 1:1 HP absorption model — shield absorbs damage point-for-point
// EXE: shield energy values: MagDeflector=55, Shield=100, Warp=100, Teleport=150, Flicker=200
// EXE: Warp/Teleport shields trigger tank repositioning on hit
// EXE: ALL shields use dispatch_type=1 (same handler) — no per-type special behavior
// EXE: Flicker Shield is a plain absorption shield despite its name (200 HP, orange)
// EXE: Force/Heavy/SuperMag weapons are OUTSIDE config range (corrupted data, not functional shields)

import { config, GRAPHICS_MODES } from './config.js';
import { getEffectiveWallType, WALL } from './physics.js';
import { setPixel, getPixel, getBackgroundColor } from './framebuffer.js';
import { writeWorldPixel, retainWorldPixel } from './projectile-render.js';
import { random } from './utils.js';
import { setPaletteRgb } from './palette.js';

// Shield type constants (matches EXE config entry indices)
// EXE config mapping: weapon_index - DS:D558(=45) + 1
// Weapons 50-52 (Force/Heavy/SuperMag) are outside config range, not functional shields
export const SHIELD_TYPE = {
  NONE:     0,
  MAG_DEFLECTOR: 1,  // weapon 45, config 1
  SHIELD:   2,       // weapon 46, config 2
  WARP:     3,       // weapon 47, config 3
  TELEPORT: 4,       // weapon 48, config 4
  FLICKER:  5,       // weapon 49, config 5 — plain absorption, no flicker behavior
};

// EXE: shield config table at DS:0x616C, 16 bytes per entry
// Fields: energy (max HP), radius (visual), r/g/b (VGA 6-bit), +0x0C (dialog nav), +0x0E (dispatch-1)
export const SHIELD_CONFIG = [
  { name: 'None',            energy: 0,   radius: 0,  r: 0,  g: 0,  b: 0  },  // config 0
  { name: 'Mag Deflector',   energy: 55,  radius: 16, r: 63, g: 63, b: 23 },  // config 1, weapon 45
  { name: 'Shield',          energy: 100, radius: 15, r: 63, g: 63, b: 63 },  // config 2, weapon 46
  { name: 'Warp Shield',     energy: 100, radius: 15, r: 63, g: 23, b: 63 },  // config 3, weapon 47
  { name: 'Teleport Shield', energy: 150, radius: 16, r: 63, g: 63, b: 63 },  // config 4, weapon 48
  { name: 'Flicker Shield',  energy: 200, radius: 16, r: 63, g: 53, b: 33 },  // config 5, weapon 49
];

// Shield break animation state — exported for main.js to render
// EXE: 51-frame palette fade from full config color to ~17% brightness (no white flash)
export const shieldBreak = { active: false, x: 0, y: 0, radius: 0, frame: 0, maxFrames: 51, playerIdx: 0, shieldType: 0 };

// Activate a shield on a player
export function activateShield(player, shieldType) {
  player.shieldContactHoles = null;
  player.shieldLowerColor = null;
  const cfg = SHIELD_CONFIG[shieldType];
  if (!cfg || shieldType === SHIELD_TYPE.NONE) {
    player.activeShield = SHIELD_TYPE.NONE;
    player.shieldEnergy = 0;
    return;
  }
  player.activeShield = shieldType;
  player.shieldEnergy = cfg.energy;
}

// Apply damage to shield, returns remaining damage that passes through
export function applyShieldDamage(player, damage) {
  if (player.shieldEnergy === 0 || damage === 0) {
    return damage;
  }

  // Flat 1:1 absorption — all shield types use the same model (EXE verified)
  if (player.shieldEnergy > damage) {
    player.shieldEnergy -= damage;
    const cfg = SHIELD_CONFIG[player.activeShield];
    if (cfg?.energy) setPaletteRgb((player.colorIndex ?? player.index) * 8 + 5,
      ...[cfg.r,cfg.g,cfg.b].map(c => Math.trunc(player.shieldEnergy * c / cfg.energy)));
    return 0;  // fully absorbed
  } else {
    const remaining = damage - player.shieldEnergy;
    // EXE: trigger shield break animation when energy depleted
    const cfg = SHIELD_CONFIG[player.activeShield];
    if (cfg) {
      shieldBreak.active = true;
      shieldBreak.x = player.x;
      shieldBreak.y = player.y;
      shieldBreak.radius = cfg.radius;
      shieldBreak.frame = 0;
      shieldBreak.playerIdx = player.index;
      shieldBreak.colorIndex = player.colorIndex ?? player.index;
      shieldBreak.shieldType = player.activeShield;
      const key = `${player.x},${player.y},${player.activeShield}`;
      shieldBreak.contactHoles = player.shieldContactHoles?.key === key
        ? new Set(player.shieldContactHoles.pixels) : new Set();
    }
    player.shieldEnergy = 0;
    return remaining;  // excess passes through
  }
}

// Native 0x23327: reflect in world coordinates, charge speed/100 shield HP,
// then retain 70% velocity. Outgoing shots erase the contact pixel but do not
// reflect or consume energy when both component signs match the displacement.
export function reflectShieldVelocity(vx, vy, dx, dy) {
  if (Math.sign(dx) === Math.sign(vx) && Math.sign(dy) === Math.sign(vy))
    return {vx,vy,damage:0,reflected:false};
  const angle = 2 * (Math.atan2(vy,vx) - Math.atan2(dy,dx));
  const c = Math.cos(angle), s = Math.sin(angle);
  const rx = c * -vx + s * -vy;
  const ry = c * -vy - s * -vx;
  return {vx:rx*.7,vy:ry*.7,damage:Math.trunc(Math.sqrt(rx*rx+ry*ry)/100),reflected:true};
}

export function eraseShieldContact(player, x, y) {
  const key = `${player.x},${player.y},${player.activeShield}`;
  if (player.shieldContactHoles?.key !== key)
    player.shieldContactHoles = {key,pixels:new Set()};
  player.shieldContactHoles.pixels.add(y * config.screenWidth + x);
  writeWorldPixel(x,y,getBackgroundColor(y,x));
}

export function checkShieldDeflection(player, proj) {
  // Native collision dispatch tests config +0x0C bit 1, which is Warp Shield.
  // Body pixels and unactivated inventory do not reflect shots.
  if (player.activeShield !== SHIELD_TYPE.WARP || proj.hitPixel % 8 !== 5 ||
      player.index === proj.attackerIdx) return false;
  eraseShieldContact(player,proj.x,proj.y);
  const velocity = proj.hitVelocity ?? proj;
  const result = reflectShieldVelocity(velocity.vx,velocity.vy,proj.x-player.x,player.y-proj.y);
  if (result.reflected) {
    applyShieldDamage(player,result.damage);
    // Native wrap handling returns before copying the reflected velocity back.
    if (getEffectiveWallType() !== WALL.WRAP) {
      proj.vx = result.vx; proj.vy = result.vy;
    }
  }
  if (getEffectiveWallType() !== WALL.WRAP) {
    proj.bounceCount++;
    // CE9A=3 does not multiply either component by this scale, but still
    // advances it for subsequent ordinary wall bounces.
    if (proj.bounceCount > 6) proj.wallBounceScale *= .8;
  }
  return true;
}

// Handle special shield effects on hit
export function handleShieldHit(player) {
  switch (player.activeShield) {
    case SHIELD_TYPE.WARP:
      // Teleport to random position
      warpTank(player);
      return true;
    case SHIELD_TYPE.TELEPORT:
      // Teleport when triggered
      warpTank(player);
      return true;
    default:
      return false;
  }
}

// Warp tank to random position on terrain
function warpTank(player) {
  const margin = 20;
  const newX = random(config.screenWidth - margin * 2) + margin;
  player.x = newX;
  // Will be adjusted to terrain in next redraw cycle
  player.falling = true;
  player.fallStartY = player.y;
  player.fallDamageAccum = 0;
}

// EXE 0x4336F / 0x4325C: outline circle, signed fixed-point aspect scaling.
export function walkShieldCircle(cx, cy, radius, visit) {
  const aspect = GRAPHICS_MODES[config.graphicsMode].displayAspect;
  const sx = aspect < 1 ? Math.trunc(aspect * 65536) : 65536;
  const sy = aspect > 1 ? Math.trunc(65536 / aspect) : 65536;
  const left = 3, right = config.screenWidth - 4;
  const point = (dx, dy) => {
    let x = cx + Math.floor(dx * sx / 65536);
    const y = cy + Math.floor(dy * sy / 65536);
    if (y < 38 || y > config.screenHeight - 4) return;
    if (x < left || x > right) {
      if (getEffectiveWallType() !== WALL.WRAP) return;
      x += x < left ? right - left + 1 : -(right - left + 1);
    }
    visit(x, y);
  };
  const mirror = (x, y) => {
    for (const [dx, dy] of [[x,y],[-x,y],[x,-y],[-x,-y],
                           [y,x],[-y,x],[y,-x],[-y,-x]]) point(dx, dy);
  };
  let x = 0, y = 2 * radius, decision = 0;
  while (x <= y) {
    if (!(x & 1)) mirror(x >> 1, (y + 1) >> 1);
    decision += 2 * x + 1;
    x++;
    if (decision > 0) { decision -= 2 * y - 1; y--; }
  }
  mirror(x >> 1, (y + 1) >> 1);
}

// Native shape dispatch at 0x404C9, including the Mag Deflector arc filter.
export function walkShieldShape(player, visit) {
  const cfg = SHIELD_CONFIG[player.activeShield];
  if (!cfg) return;
  const mag = player.activeShield === SHIELD_TYPE.MAG_DEFLECTOR;
  const radii = mag ? [13,16] :
    player.activeShield >= SHIELD_TYPE.TELEPORT ? [cfg.radius,cfg.radius-1] : [cfg.radius];
  for (const radius of radii) walkShieldCircle(player.x, player.y, radius, (x,y) => {
    if (!mag || (x > player.x - 5 && x < player.x + 5 && y < player.y)) visit(x,y);
  });
}

// Native 0x38649 excludes terrain indices 80..104, not sky. Translate the
// port's relocated terrain colors; other indexed pixels remain drawable.
function shieldPixelAllowed(x, y) {
  const c = getPixel(x,y);
  return !(c === 120 || c === 127 || (c >= 128 && c <= 144));
}

const SHIELD_PALETTE_BASE = 200;

export function drawShield(player) {
  if (!player.shieldEnergy) return;
  const cfg = SHIELD_CONFIG[player.activeShield];
  if (!cfg || !cfg.energy) return;
  const color = (player.colorIndex ?? player.index) * 8 + 5;
  const rgb = [cfg.r,cfg.g,cfg.b].map(c => Math.trunc(player.shieldEnergy * c / cfg.energy));
  setPaletteRgb(color, ...rgb);
  const key = `${player.x},${player.y},${player.activeShield}`;
  if (player.shieldLowerColor?.key !== key) player.shieldLowerColor = {key,rgb};
  // Native absorption updates the shared upper slot, not the dedicated lower
  // slot installed by update_shield_color. World repaint must retain that RGB.
  setPaletteRgb(SHIELD_PALETTE_BASE + player.index, ...player.shieldLowerColor.rgb);
  walkShieldShape(player, (x,y) => {
    if (player.shieldContactHoles?.key === key &&
        player.shieldContactHoles.pixels.has(y * config.screenWidth + x)) return;
    if (shieldPixelAllowed(x,y))
      setPixel(x,y,y > player.y ? SHIELD_PALETTE_BASE + player.index : color);
  });
}

// Draw shield break animation — EXE: 51-frame palette fade from full config color to ~17%
// EXE: no white flash, no ring expansion. VGA palette animation fades shield in-place.
// Formula: R = configR × (60-frame) / 60, same for G/B. Sound descends 6000→1100 Hz.
export function drawShieldBreak() {
  if (!shieldBreak.active) return;

  const cfg = SHIELD_CONFIG[shieldBreak.shieldType];
  if (!cfg) { shieldBreak.active = false; return; }

  const di = shieldBreak.frame;
  const paletteIdx = shieldBreak.colorIndex * 8 + 5;

  // EXE: R = configR * (60 - di) / 60 — fade from full brightness to ~17%
  const r = Math.floor(cfg.r * (60 - di) / 60);
  const g = Math.floor(cfg.g * (60 - di) / 60);
  const b = Math.floor(cfg.b * (60 - di) / 60);
  setPaletteRgb(paletteIdx, Math.max(0, r), Math.max(0, g), Math.max(0, b));

  // Repaint the upper shield using the same native shape as activation.
  // The lower, dedicated palette entry is not changed by native break fading.
  walkShieldShape({x:shieldBreak.x,y:shieldBreak.y,activeShield:shieldBreak.shieldType}, (x,y) => {
    if (shieldBreak.contactHoles?.has(y * config.screenWidth + x)) return;
    if (shieldPixelAllowed(x,y)) {
      const lower = y > shieldBreak.y;
      const color = lower ? SHIELD_PALETTE_BASE + shieldBreak.playerIdx : paletteIdx;
      if (lower && di === shieldBreak.maxFrames - 1) retainWorldPixel(x,y,color);
      else setPixel(x,y,color);
    }
  });

  shieldBreak.frame++;
  if (shieldBreak.frame >= shieldBreak.maxFrames) {
    shieldBreak.active = false;
  }
}
