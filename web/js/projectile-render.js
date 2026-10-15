// EXE draw_small_bomb (0x228DB) / draw_big_bomb (0x22A14).
import { config } from './config.js';
import { getPixel, setPixel, getBackgroundColor } from './framebuffer.js';
import { PLAYFIELD_TOP } from './terrain.js';
import { UI_DARK_BORDER } from './constants.js';
import { overwriteWindPixel } from './wind-indicator-state.js';

// Preserve indexed projectile writes across the world's full-frame repaint.
// Completed shots release their state while their trace pixels remain.
export class ProjectileDrawingLayer {
  constructor(background = (x, y) => getBackgroundColor(y, x)) {
    this.background = background;
    this.writes = new Map();
    this.states = new Map();
    this.io = {
      getPixel: (x, y) => this.writes.get(y * config.screenWidth + x) ?? getPixel(x, y),
      setPixel: (x, y, color) => {
        if (x < 0 || x >= config.screenWidth || y < 0 || y >= config.screenHeight) return;
        const index = y * config.screenWidth + x;
        if (color === getPixel(x, y)) this.writes.delete(index);
        else this.writes.set(index, color);
      },
    };
  }
  advance(projectile, x = projectile.x, y = projectile.y) {
    if (projectile.isNapalmParticle) return;
    let state = this.states.get(projectile);
    if (!state) {
      state = { icon: config.bombIcon, traceColor: projectile.traceColor };
      this.states.set(projectile, state);
    }
    transitionProjectileHead(state, x, y,
      (x, y) => this.io.setPixel(x, y, this.background(x, y)), false, this.io);
  }
  finish(projectile) {
    const state = this.states.get(projectile);
    if (!state) return;
    transitionProjectileHead(state, 0, 0,
      (x, y) => this.io.setPixel(x, y, this.background(x, y)), true, this.io);
    this.states.delete(projectile);
  }
  draw() {
    for (const [index, color] of this.writes)
      setPixel(index % config.screenWidth, Math.floor(index / config.screenWidth), color);
  }
  clear() { this.writes.clear(); this.states.clear(); }
}

export const projectileDrawing = new ProjectileDrawingLayer();

// Native indexed writes that survive a clean-world repaint (for example the
// lower shield pixels left by its palette-specific erasure callback).
export function retainWorldPixel(x, y, color) {
  if (x < 0 || x >= config.screenWidth || y < 0 || y >= config.screenHeight) return;
  projectileDrawing.writes.set(y * config.screenWidth + x, color);
  setPixel(x, y, color);
}

// A world mutation replaces the native VGA pixel, including any trace there.
// Ordinary world repaint must continue to use framebuffer.setPixel directly.
export function writeWorldPixel(x, y, color) {
  if (x < 0 || x >= config.screenWidth || y < 0 || y >= config.screenHeight) return;
  overwriteWindPixel(y * config.screenWidth + x);
  projectileDrawing.writes.delete(y * config.screenWidth + x);
  setPixel(x, y, color);
}

// EXE 0x22DFA: tracking marks on the middle border. The production world
// repaint restores previous marks before drawing the current ones.
export function drawProjectileTrackingMarks(x, y, icon = config.bombIcon) {
  if (icon === 2) return;
  const markerX = Math.max(2, Math.min(config.screenWidth - 3, Math.trunc(x)));
  const markerY = Math.max(PLAYFIELD_TOP - 1, Math.trunc(y));
  setPixel(1, markerY, UI_DARK_BORDER);
  setPixel(config.screenWidth - 2, markerY, UI_DARK_BORDER);
  setPixel(markerX, PLAYFIELD_TOP - 2, UI_DARK_BORDER);
}

// The port relocates native sky and terrain palette entries.
export function nativeIndex(c) {
  if (c >= 80 && c < 110) return c + 40;
  if (c === 120) return 80;
  if (c === 127) return 87;
  if (c >= 128 && c <= 143) return c - 40;
  return c;
}

// Stateful native draw/erase kernel. restoreBackground supplies setTerrainPixel
// semantics; callers must preserve the indexed frame between transitions.
export function transitionProjectileHead(state, x, y, restoreBackground, eraseOnly = false, io = { getPixel, setPixel }) {
  x = Math.trunc(x); y = Math.trunc(y);
  const icon = state.icon;
  if (!eraseOnly && state.x === x && state.y === y) return;
  const restore = (px, py, center) => {
    if (center && state.traceColor != null) io.setPixel(px, py, state.traceColor);
    else restoreBackground(px, py);
  };
  if (icon === 0 || icon === 2) {
    if (!eraseOnly) drawProjectileHead(x, y, icon, io);
    if (state.visible) restore(state.x, state.y, true);
    if (!eraseOnly) state.visible = icon !== 2 && x >= 3 &&
      x <= config.screenWidth - 4 && y >= PLAYFIELD_TOP;
  } else {
    if (state.x !== undefined) {
      for (const [dx, dy] of [[0,0],[-1,0],[1,0],[0,-1],[0,1]]) {
        const px = state.x + dx, py = state.y + dy;
        if (px >= 3 && px <= config.screenWidth - 4 && py >= PLAYFIELD_TOP &&
            py <= config.screenHeight - 4 && io.getPixel(px, py) === 255)
          restore(px, py, dx === 0 && dy === 0);
      }
    }
    if (!eraseOnly) drawProjectileHead(x, y, icon, io);
  }
  if (!eraseOnly) { state.x = x; state.y = y; }
}

// Draw onto a restored world frame. Erasure/history belongs to the caller.
export function drawProjectileHead(x, y, icon = config.bombIcon, io = { getPixel, setPixel }) {
  if (icon === 2) return;
  x = Math.trunc(x); y = Math.trunc(y);
  if (icon === 0) {
    // Small bombs do not test the background or the lower playfield edge.
    if (x >= 3 && x <= config.screenWidth - 4 && y >= PLAYFIELD_TOP)
      io.setPixel(x, y, 255);
    return;
  }
  for (const [dx, dy] of [[0,0],[-1,0],[1,0],[0,-1],[0,1]]) {
    const px = x + dx, py = y + dy;
    if (px >= 3 && px <= config.screenWidth - 4 &&
        py >= PLAYFIELD_TOP && py <= config.screenHeight - 4 &&
        nativeIndex(io.getPixel(px, py)) > 119) io.setPixel(px, py, 255);
  }
}
