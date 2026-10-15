import assert from 'node:assert/strict';
import {stepLazyBoyProjectile} from '../web/js/game.js';
import {projectileDrawing} from '../web/js/projectile-render.js';
import {pixels,setBackground} from '../web/js/framebuffer.js';
import {config} from '../web/js/config.js';
import {terrainBitmap} from '../web/js/terrain.js';
config.bombIcon=0;setBackground(new Uint8Array(config.screenHeight).fill(80));
const setup=()=>{projectileDrawing.clear();pixels.fill(80);terrainBitmap.fill(0);return {x:100,y:100,vx:100,vy:100,attackerIdx:0,guidanceTarget:{x:120,y:100},guidanceTargetReference:null,active:true};};
let p=setup();assert.equal(stepLazyBoyProjectile(p),'flying');assert.equal(p.x,110);assert.equal(p.y,100);
assert.equal(p.vx,1);assert.ok(p.vy===0);
assert.equal(stepLazyBoyProjectile(p),'hit_terrain');assert.equal(p.x,120);assert.equal(p.y,100);
p=setup();p.guidanceTarget={x:100,y:103};
// Native terrain index 80 is web index 120. Dig must clear the bitmap.
for(let y=101;y<=103;y++){pixels[y*config.screenWidth+100]=120;terrainBitmap[y*config.screenWidth+100]=1;}
assert.equal(stepLazyBoyProjectile(p),'hit_terrain');
for(let y=101;y<=103;y++)assert.equal(terrainBitmap[y*config.screenWidth+100],0);
p=setup();pixels[100*config.screenWidth+101]=8;pixels[99*config.screenWidth+100]=8;
assert.equal(stepLazyBoyProjectile(p),'hit_tank');assert.equal(p.hitPixel,8);
assert.equal(p.x,100);assert.equal(p.y,100);
console.log('Live Lazy Boy adapter passes straight flight, arrival, terrain digging and blocked tank collision.');
