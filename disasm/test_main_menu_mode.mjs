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
const stored = new Map();
globalThis.localStorage = { getItem(key) { return stored.get(key) ?? null; }, setItem(key,value) { stored.set(key,value); } };
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
  listener({ code: 'KeyG', key: 'KeyG', preventDefault() {} });
nextFrame();
assert.equal(config.graphicsMode, 4, 'Hardware edits stay pending until dismissal');
assert.deepEqual([canvas.width, canvas.height], [360, 480]);
for (const listener of listeners.get('keyup'))
  listener({ code: 'KeyG', key: 'KeyG', preventDefault() {} });
for (const listener of listeners.get('keydown'))
  listener({ code: 'Escape', key: 'Escape', preventDefault() {} });
nextFrame();
assert.equal(config.graphicsMode, 5);
assert.deepEqual([canvas.width, canvas.height, getWidth(), getHeight()], [360, 480, 360, 480], 'Committing mode does not resize the active native menu');
menu.activeSubmenu = null;
menu.screen = 'player_setup';
game.state = STATE.PLAYER_SETUP;
const { initPlayerSetup } = await import('../web/js/menu.js');
initPlayerSetup();
nextFrame();
assert.deepEqual([getWidth(), getHeight()], [360, 480], 'player setup retains the active resolution');
function press(code, key=code) {
  for(const listener of listeners.get('keydown')) listener({code,key,preventDefault(){}});
  nextFrame();
  for(const listener of listeners.get('keyup')) listener({code,key,preventDefault(){}});
}
for(const name of ['A','B']) {
  press('Key'+name,name);press('Enter');press('KeyD','d');
}
assert.equal(game.state,STATE.SHOP);
assert.deepEqual([getWidth(),getHeight()],[360,480],'game entry retains active resolution');
const {getActiveGraphicsMode,saveConfig}=await import('../web/js/config.js');
assert.equal(getActiveGraphicsMode().displayAspect,0.55,'game geometry uses active pixel aspect');
saveConfig();
const fresh=await import('../web/js/config.js?fresh-mode-test');
assert.deepEqual([fresh.config.screenWidth,fresh.config.screenHeight],[640,400],'fresh session applies saved graphics mode');
console.log('Hardware selection preserves menu/player/shop resolution and aspect; a fresh session applies the saved mode.');
