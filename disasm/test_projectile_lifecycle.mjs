import assert from 'node:assert/strict';
import {config} from '../web/js/config.js';
import {pixels,reinitFramebuffer} from '../web/js/framebuffer.js';
import {projectileDrawing} from '../web/js/projectile-render.js';
import {launchProjectile,projectiles,clearProjectiles} from '../web/js/physics.js';
import {prepareRoundBackground} from '../web/js/game.js';
import {addDirt,createCrater,startExplosion,stepExplosion} from '../web/js/explosions.js';
import {drawTerrain} from '../web/js/terrain.js';

Object.assign(config,{screenWidth:360,screenHeight:480,bombIcon:0,tracePaths:1,skyType:0,wallType:0});
reinitFramebuffer();prepareRoundBackground();pixels.fill(80);
launchProjectile(20,50,45,200,2,0);
const p=projectiles[0];
for(let i=0;i<250;i++){
  // World is repainted between frames; no historical projectile pixels remain.
  pixels.fill(80);p.x=4+i%32;p.y=40+Math.floor(i/32);
  projectileDrawing.advance(p);projectileDrawing.draw();
}
pixels.fill(80);clearProjectiles();projectileDrawing.draw();
assert.equal(projectiles.length,0);
assert.equal(projectileDrawing.states.size,0);
assert.equal(pixels.filter(c=>c===110).length,250);
pixels.fill(80);projectileDrawing.draw();
assert.equal(pixels.filter(c=>c===110).length,250,'trace survives another world repaint');
addDirt(5,41,1);projectileDrawing.draw();
assert.equal(pixels[41*360+5],120,'new dirt overwrites trace');
assert.equal(pixels[40*360+30],110,'unaffected trace survives dirt');
createCrater(5,41,1);pixels.fill(80);drawTerrain();projectileDrawing.draw();
assert.equal(pixels[41*360+5],80,'removed dirt does not resurrect trace');
startExplosion(20,43,3,0);stepExplosion();projectileDrawing.draw();
assert.notEqual(pixels[43*360+20],110,'explosion fire overwrites trace');
pixels.fill(80);drawTerrain();projectileDrawing.draw();
assert.equal(pixels[43*360+20],80,'trace stays erased after fire repaint');
assert.equal(pixels[40*360+30],110,'unaffected trace survives explosion');
prepareRoundBackground();pixels.fill(80);projectileDrawing.draw();
assert.equal(pixels.filter(c=>c===110).length,0,'new round clears trace pixels');
console.log('250 trace positions persist; dirt/craters/fire overwrite only affected traces; round setup clears them.');
