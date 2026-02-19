// Scorched Earth - Keyboard Input
// EXE: custom INT 9h keyboard handler at file 0x2898E
// EXE: main game loop key dispatch at file 0x2F78A
// EXE: key config values stored in DS offsets
// Web: tracks key state array, matches original DOS keyboard polling

const keys = {};

export function initInput() {
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    e.preventDefault();
  });
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
