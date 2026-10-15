import {config} from './config.js';
import {pixels,drawBox3DRaised} from './framebuffer.js';
import {drawText,measureText} from './font.js';
import {UI_BACKGROUND,UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,
  UI_BRIGHT_BORDER,UI_DEEP_SHADOW} from './constants.js';

// Native DS:DD4C is a special non-null pointer, not a living roster entry.
export const GUIDANCE_DUMMY_TARGET = Object.freeze({kind:'dummy'});

// 0x217B0..0x217F8 copies coordinates separately from the target far pointer.
// The pixel must be sampled after closing the overlay (0x1130B..0x11334).
export function captureGuidanceTarget(target, underlyingPixel) {
  return {
    point: {x:target.x,y:target.y},
    reference: target.index !== undefined ? target
      : underlyingPixel < 80 ? GUIDANCE_DUMMY_TARGET : null,
  };
}

// Native target selection helpers (0x11341 and 0x26491).
// Digit ordinals count living tanks from left to right, with roster order
// breaking equal-x ties. Selecting the shooter leaves the dialog open.
export function guidanceDigitTarget(roster, shooter, digit) {
  const ordered = roster.filter(p => p.alive).sort((a,b) => a.x-b.x);
  const target = ordered[digit-1];
  return target && target !== shooter ? target : null;
}

// Native distance is truncated to integer; ties retain the first live player
// in iteration order. Unlike digit selection, this path permits the shooter.
export function guidanceMouseTarget(roster, x, y) {
  let nearest = null, distance = 100;
  for (const player of roster) {
    if (!player.alive) continue;
    const current = Math.trunc(Math.sqrt((player.x-x)**2+(player.y-y)**2));
    if (current < distance) { nearest = player; distance = current; }
  }
  return nearest;
}

// 0x111F6..0x112D3 polls held buttons on every iteration. A press outside
// the playfield can become a selection when dragged inside without releasing.
// Any non-left button follows nearest-player selection; left takes priority.
export function guidancePointerTarget(roster, x, y, buttons) {
  x = Math.trunc(x); y = Math.trunc(y);
  if (!buttons || x < 3 || x > config.screenWidth-4 ||
      y < 38 || y > config.screenHeight-4) return null;
  return buttons & 1 ? {x,y} : guidanceMouseTarget(roster,x,y);
}

let savedTargetScreen = null;
export function drawGuidanceTarget() {
  if (!savedTargetScreen) savedTargetScreen = pixels.slice();
  const width = measureText('Choose Target') + 8;
  const x = Math.floor((config.screenWidth-1-width)/2), y = 38;
  drawBox3DRaised(x,y,width+1,28,UI_BACKGROUND,
    UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
  drawText(x+4,y+8,'Choose Target',UI_DEEP_SHADOW);
}
export function closeGuidanceTarget() {
  if (savedTargetScreen) pixels.set(savedTargetScreen);
  savedTargetScreen = null;
}
