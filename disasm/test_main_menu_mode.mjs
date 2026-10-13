// Exercise the application's real RAF loop without launching a browser.
import assert from 'node:assert/strict';
const listeners = new Map();
let nextFrame;
let ready;
const firstFrame = new Promise(resolve => { ready = resolve; });
const canvas = {
  addEventListener() {},
  getContext(kind) {
    if (kind !== '2d') return null;
    return {
      createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
      putImageData() {},
    };
  },
};
globalThis.window = {
  location: { search: '?seed=123' },
  addEventListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  },
};
globalThis.document = {
  getElementById() { return canvas; },
  documentElement: { style: { setProperty() {} } },
};
globalThis.localStorage = { getItem() { return null; } };
globalThis.fetch = async () => ({ ok: false });
globalThis.requestAnimationFrame = callback => { nextFrame = callback; ready(); };
await import('../web/js/main.js');
await firstFrame;
const { config } = await import('../web/js/config.js');
const { menu } = await import('../web/js/menu.js');
const { game, STATE } = await import('../web/js/game.js');
const { getWidth, getHeight } = await import('../web/js/framebuffer.js');
nextFrame();
assert.deepEqual([canvas.width, canvas.height, getWidth(), getHeight()], [360, 480, 360, 480]);

// Change Hardware's graphics-mode spinner through the actual menu input path.
menu.activeSubmenu = 'hardware';
menu.submenuSelected = 0;
assert.equal(config.graphicsMode, 4);
for (const listener of listeners.get('keydown'))
  listener({ code: 'ArrowRight', key: 'ArrowRight', preventDefault() {} });
nextFrame();
assert.equal(config.graphicsMode, 5);
assert.deepEqual([canvas.width, canvas.height, getWidth(), getHeight()], [640, 400, 640, 400]);
menu.activeSubmenu = null;
menu.screen = 'player_setup';
game.state = STATE.PLAYER_SETUP;
const { initPlayerSetup } = await import('../web/js/menu.js');
initPlayerSetup();
nextFrame();
assert.deepEqual([getWidth(), getHeight()], [640, 400], 'setup must retain the selected mode');
console.log('Application loop preserves menu/setup resolution and resizes on Hardware changes.');
