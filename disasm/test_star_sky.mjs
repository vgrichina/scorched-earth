import assert from 'node:assert/strict';
import {config} from '../web/js/config.js';
import {seedRandom, random} from '../web/js/utils.js';
import {initPalette} from '../web/js/palette.js';
import * as fb from '../web/js/framebuffer.js';
import {initSkyBackground, drawSky, terrainBitmap, reinitTerrainBuffers} from '../web/js/terrain.js';
import {createCrater} from '../web/js/explosions.js';
Object.assign(config, {screenWidth:360, screenHeight:480, extraDirt:0});
for (const skyType of [2, 3, 4]) {
fb.reinitFramebuffer();reinitTerrainBuffers();
seedRandom(42);initPalette(2, skyType);initSkyBackground();drawSky();
const sky = fb.pixels.slice();
assert(sky.some(p => p > 80 && p < 110));
seedRandom(123);
const next = random(65535);
seedRandom(123);
for (let frame = 0; frame < 100; frame++) drawSky();
assert.deepEqual(fb.pixels, sky, 'Sky must persist unchanged across redraws');
assert.equal(random(65535), next, 'Redraw must not consume gameplay RNG');
const index = sky.findIndex((p, i) => {
  const y = Math.trunc(i / config.screenWidth);
  return y >= 38 && y <= config.screenHeight - 4 &&
    (skyType === 4 ? p === 80 : skyType === 3 ? p >= 90 && p < 110 : p > 80 && p < 110);
});
assert(index >= 0, 'Expected a sky detail to cover and restore');
const x = index % config.screenWidth, y = Math.trunc(index / config.screenWidth);
terrainBitmap[index] = 120;fb.setPixel(x, y, 120);
createCrater(x, y, 1);
assert.equal(terrainBitmap[index], 0);
assert.equal(fb.pixels[index], sky[index], 'Crater must restore the exact sky pixel');
}
console.log('Stars, Storm and Sunset persist across 100 redraws without RNG and restore after crater erasure.');
