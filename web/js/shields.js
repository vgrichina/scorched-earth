// Scorched Earth - Shield System
// EXE source: shields.cpp (seg 0x31D8, file base 0x38780)
// EXE: shield config table at DS:0x616C, 6 entries × 16 bytes (None + 5 shields)
// EXE: flat 1:1 HP absorption model — shield absorbs damage point-for-point
// EXE: shield energy values: MagDeflector=55, Shield=100, Warp=100, Teleport=150, Flicker=200
// EXE: Warp/Teleport shields trigger tank repositioning on hit
// EXE: ALL shields use dispatch_type=1 (same handler) — no per-type special behavior
// EXE: Flicker Shield is a plain absorption shield despite its name (200 HP, orange)
// EXE: Force/Heavy/SuperMag weapons are OUTSIDE config range (corrupted data, not functional shields)

import { config } from './config.js';
import { setPixel, getPixel } from './framebuffer.js';
import { random } from './utils.js';
import { setPaletteRgb } from './palette.js';

// EXE: shield_draw_pixel_callback (0x38649) skips sky pixels (VGA 80-104 = 0x50-0x68)
// EXE: shield_draw_terrain_callback (0x3FC46) only draws where pixel >= 0x69 (terrain)
// Both prevent shield pixels from being drawn over sky background
const SKY_RANGE_START = 80;   // VGA 0x50
const SKY_RANGE_END = 104;    // VGA 0x68

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
  if (player.activeShield === SHIELD_TYPE.NONE || player.shieldEnergy <= 0) {
    return damage;
  }

  // Flat 1:1 absorption — all shield types use the same model (EXE verified)
  if (player.shieldEnergy >= damage) {
    player.shieldEnergy -= damage;
    return 0;  // fully absorbed
  } else {
    const remaining = damage - player.shieldEnergy;
    // EXE: trigger shield break animation when energy depleted
    const cfg = SHIELD_CONFIG[player.activeShield];
    if (cfg) {
      shieldBreak.active = true;
      shieldBreak.x = player.x;
      shieldBreak.y = player.y - 6;
      shieldBreak.radius = cfg.radius;
      shieldBreak.frame = 0;
      shieldBreak.playerIdx = player.index;
      shieldBreak.shieldType = player.activeShield;
    }
    player.shieldEnergy = 0;
    player.activeShield = SHIELD_TYPE.NONE;
    return remaining;  // excess passes through
  }
}

// EXE: Mag Deflector deflection is handled in physics.js (in-flight magnetic field),
// NOT via a per-hit shield check. Force/Heavy shields are not in the EXE config table.
// This function is a stub — Mag Deflector deflection uses a separate code path.
export function checkShieldDeflection(player, proj) {
  return false;
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

// EXE: VGA palette entries 210-219 = per-player dedicated shield color
// EXE: activation uses player*8+5 (shared), ongoing uses player+200 (dedicated)
// Web port maps player+200 → 210+playerIndex (200-208 used by 3D UI)
const SHIELD_PALETTE_BASE = 210;

// Draw shield circle around a tank
// EXE: update_shield_color at file 0x389DA — continuous fade formula
export function drawShield(player) {
  if (player.activeShield === SHIELD_TYPE.NONE || player.shieldEnergy <= 0) return;

  const cfg = SHIELD_CONFIG[player.activeShield];
  if (!cfg) return;

  const cx = player.x;
  const cy = player.y - 6;  // center on tank body
  const radius = cfg.radius;

  // EXE: continuous color = shieldEnergy × configColor / maxEnergy
  // Sets VGA palette entry (player+200) RGB based on current energy
  const paletteIdx = SHIELD_PALETTE_BASE + player.index;
  const r = Math.floor(player.shieldEnergy * cfg.r / cfg.energy);
  const g = Math.floor(player.shieldEnergy * cfg.g / cfg.energy);
  const b = Math.floor(player.shieldEnergy * cfg.b / cfg.energy);
  setPaletteRgb(paletteIdx, r, g, b);

  // Draw shield as circle outline using dedicated palette entry
  // EXE: all shield types render identically (no per-type visual effects)
  // EXE: shield_draw_pixel_callback (0x38649) skips sky pixels (VGA 80-104)
  for (let angle = 0; angle < 360; angle += 4) {
    const rad = angle * Math.PI / 180;
    const px = Math.round(cx + Math.cos(rad) * radius);
    const py = Math.round(cy + Math.sin(rad) * radius);
    if (px >= 0 && px < config.screenWidth && py >= 0 && py < config.screenHeight) {
      const existing = getPixel(px, py);
      // EXE: skip sky range 0x50-0x68 (VGA 80-104) — shield not drawn over sky
      if (existing >= SKY_RANGE_START && existing <= SKY_RANGE_END) continue;
      setPixel(px, py, paletteIdx);
    }
  }
}

// Draw shield break animation — EXE: 51-frame palette fade from full config color to ~17%
// EXE: no white flash, no ring expansion. VGA palette animation fades shield in-place.
// Formula: R = configR × (60-frame) / 60, same for G/B. Sound descends 6000→1100 Hz.
export function drawShieldBreak() {
  if (!shieldBreak.active) return;

  const cfg = SHIELD_CONFIG[shieldBreak.shieldType];
  if (!cfg) { shieldBreak.active = false; return; }

  const di = shieldBreak.frame;
  const paletteIdx = SHIELD_PALETTE_BASE + shieldBreak.playerIdx;

  // EXE: R = configR * (60 - di) / 60 — fade from full brightness to ~17%
  const r = Math.floor(cfg.r * (60 - di) / 60);
  const g = Math.floor(cfg.g * (60 - di) / 60);
  const b = Math.floor(cfg.b * (60 - di) / 60);
  setPaletteRgb(paletteIdx, Math.max(0, r), Math.max(0, g), Math.max(0, b));

  // Draw shield circle at original position using the fading palette entry
  // EXE: shield pixels only exist over terrain, not sky — fade happens in-place
  for (let angle = 0; angle < 360; angle += 4) {
    const rad = angle * Math.PI / 180;
    const px = Math.round(shieldBreak.x + Math.cos(rad) * shieldBreak.radius);
    const py = Math.round(shieldBreak.y + Math.sin(rad) * shieldBreak.radius);
    if (px >= 0 && px < config.screenWidth && py >= 0 && py < config.screenHeight) {
      const existing = getPixel(px, py);
      if (existing >= SKY_RANGE_START && existing <= SKY_RANGE_END) continue;
      setPixel(px, py, paletteIdx);
    }
  }

  shieldBreak.frame++;
  if (shieldBreak.frame >= shieldBreak.maxFrames) {
    shieldBreak.active = false;
  }
}
