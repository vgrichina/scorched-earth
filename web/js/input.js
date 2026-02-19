// Scorched Earth - Keyboard Input
// Tracks key state array, matches original DOS keyboard polling

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
