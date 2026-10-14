// Scorched Earth - Input System (Keyboard + Mouse)
// EXE: custom INT 9h keyboard handler at file 0x2898E
// EXE: main game loop key dispatch at file 0x2F78A
// EXE: mouse via Fastgraph V4.02 API (fg_mousepos, fg_mousebut)
// EXE: MOUSE_RATE (DS:0x6BF8) = 0.50 default, scales mouse delta to angle/power
// Web: tracks key state array + mouse position/buttons/delta

const keys = {};
const keyText = {};

import { config } from './config.js';

// Mouse state — coordinates in game pixels (W×H), not CSS pixels
export const mouse = {
  x: 0, y: 0,           // current position in game coords
  dx: 0, dy: 0,         // delta since last frame (consumed by getMouseDelta)
  buttons: 0,           // bitmask: 1=left, 2=right, 4=middle
  clicked: 0,           // one-shot click bitmask (consumed by consumeClick)
  over: false,          // mouse is over the canvas
};

let canvasEl = null;     // reference to canvas for coordinate mapping

export function initInput(canvas) {
  canvasEl = canvas || document.getElementById('screen');

  window.addEventListener('keydown', (e) => {
    // Native S/E/Minus dispatch waits for release before another press.
    if (e.repeat && (e.code === 'KeyS' || e.code === 'KeyE' || e.code === 'Minus')) {
      e.preventDefault();
      return;
    }
    keys[e.code] = true;
    keyText[e.code] = e.key;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    e.preventDefault();
  });

  // Mouse events on canvas — map CSS coords to game coords (resolution-dependent)
  canvasEl.addEventListener('mousemove', (e) => {
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = config.screenWidth / rect.width;
    const scaleY = config.screenHeight / rect.height;
    const nx = (e.clientX - rect.left) * scaleX;
    const ny = (e.clientY - rect.top) * scaleY;
    mouse.dx += nx - mouse.x;
    mouse.dy += ny - mouse.y;
    mouse.x = nx;
    mouse.y = ny;
  });

  canvasEl.addEventListener('mousedown', (e) => {
    const btn = 1 << e.button; // 0→1(left), 1→4(middle), 2→2(right)
    mouse.buttons |= btn;
    mouse.clicked |= btn;
    e.preventDefault();
  });

  canvasEl.addEventListener('mouseup', (e) => {
    mouse.buttons &= ~(1 << e.button);
    e.preventDefault();
  });

  canvasEl.addEventListener('mouseenter', () => { mouse.over = true; });
  canvasEl.addEventListener('mouseleave', () => {
    mouse.over = false;
    mouse.buttons = 0;
  });

  // Prevent context menu on right-click
  canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function isKeyDown(code) {
  return !!keys[code];
}

// Consume a key press (returns true once, then false until re-pressed)
export function consumeKey(code) {
  if (keys[code]) {
    keys[code] = false;
    return true;
  }
  return false;
}

// Use the character produced by the keyboard, preserving Shift/Caps Lock.
// Only currently pending keys are consumed, so gameplay input cannot leave
// stale characters waiting for a later text field.
export function consumeTextInput() {
  let text = '';
  for (const code in keys) {
    const value = keyText[code];
    if (keys[code] && value?.length === 1 && value.charCodeAt(0) >= 32 &&
        value.charCodeAt(0) < 127) {
      text += value;
      keys[code] = false;
    }
  }
  return text;
}

// Consume ANY key press — returns true if any key was down and clears it
// EXE: fg_getkey() at round-over/game-over waits for ANY key, not just specific ones
export function consumeAnyKey() {
  for (const code in keys) {
    if (keys[code]) {
      keys[code] = false;
      return true;
    }
  }
  return false;
}

// Consume mouse click (returns true once per click)
export function consumeClick(button) {
  const mask = button === undefined ? 1 : (1 << button);
  if (mouse.clicked & mask) {
    mouse.clicked &= ~mask;
    return true;
  }
  return false;
}

// Get and reset mouse delta since last call
export function getMouseDelta() {
  const dx = mouse.dx;
  const dy = mouse.dy;
  mouse.dx = 0;
  mouse.dy = 0;
  return { dx, dy };
}
