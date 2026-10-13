import assert from 'node:assert/strict';
import {config} from '../web/js/config.js';
import {game,gameTick,STATE} from '../web/js/game.js';
import {players,createPlayer} from '../web/js/tank.js';
import {createProjectile,projectiles,clearProjectiles} from '../web/js/physics.js';
import {pixels,setPixel,setBackground,reinitFramebuffer} from '../web/js/framebuffer.js';
import {reinitTerrainBuffers} from '../web/js/terrain.js';
import {shieldBreak,drawShieldBreak} from '../web/js/shields.js';
import {projectileDrawing} from '../web/js/projectile-render.js';
Object.assign(config,{screenWidth:360,screenHeight:480,gravity:0,viscosity:0,wallType:0,tunneling:0});
reinitFramebuffer();reinitTerrainBuffers();setBackground(new Uint8Array(480).fill(80));pixels.fill(80);
clearProjectiles();projectileDrawing.clear();
const target=createPlayer(0,'Target'),attacker=createPlayer(1,'Attacker');
Object.assign(target,{x:100,y:100,activeShield:2,shieldEnergy:10});
Object.assign(attacker,{x:300,y:400});players.splice(0,players.length,target,attacker);
Object.assign(game,{state:STATE.FLIGHT,currentPlayer:1,wind:0});
const moving=createProjectile(200,100,100,0,2,1);
const impact=createProjectile(100,100,100,0,2,1);
projectiles.push(moving,impact);setPixel(100,100,5);
gameTick();
assert(shieldBreak.active,'impact should start a shield break');
assert.equal(projectiles.includes(impact),false,'consumed shot must finish before the fade');
assert.equal(moving.x,200,'later projectiles must wait in the initiating tick');
for(let frame=0;frame<51;frame++){
 assert(shieldBreak.active);
 const state=game.state;
 gameTick();
 assert.equal(moving.x,200,'flight advanced during shield break');
 assert.equal(game.state,state,'gameplay state advanced during shield break');
 drawShieldBreak();
}
assert.equal(shieldBreak.active,false);
pixels.fill(80);gameTick();
assert(moving.x>200,'flight must resume after the fade');
console.log('Shield contact pauses remaining shots in the same tick and all gameplay ticks through the fade, then flight resumes.');
// A break triggered by the explosion completion callback must also keep the
// state machine from starting terrain fall or the next turn during its fade.
const {startExplosion}=await import('../web/js/explosions.js');
const {applyShieldDamage}=await import('../web/js/shields.js');
clearProjectiles();Object.assign(config,{fallingTanks:0});
Object.assign(target,{activeShield:2,shieldEnergy:10});
game.state=STATE.EXPLOSION;
startExplosion(100,100,1,1,()=>applyShieldDamage(target,10));
gameTick();gameTick();
assert(shieldBreak.active);
assert.equal(game.state,STATE.EXPLOSION,'completion callback must not advance aftermath during break');
for(let i=0;i<51;i++){gameTick();assert.equal(game.state,STATE.EXPLOSION);drawShieldBreak();}
gameTick();assert.equal(game.state,STATE.NEXT_TURN);
console.log('Explosion completion also waits for shield breaking before advancing aftermath.');
