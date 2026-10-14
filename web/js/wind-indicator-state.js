// The native wind label lives in the playfield framebuffer. World writes can
// erase it; a clean-world repaint must not recreate those overwritten pixels.
const footprint = new Set();
const erased = new Set();
let identity = null;

export function resetWindIndicator() {
  footprint.clear();
  erased.clear();
  identity = null;
}

export function prepareWindIndicator(key) {
  if (identity !== key) {
    resetWindIndicator();
    identity = key;
  }
}

export function windPixelVisible(index) {
  footprint.add(index);
  return !erased.has(index);
}

export function overwriteWindPixel(index) {
  if (footprint.has(index)) erased.add(index);
}
