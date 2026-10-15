import assert from 'node:assert/strict';
import {config} from '../web/js/config.js';
import {createPlayers,players} from '../web/js/tank.js';
import {game,gameTick,STATE} from '../web/js/game.js';
import {initInput,mouse} from '../web/js/input.js';
import {projectiles,clearProjectiles} from '../web/js/physics.js';
import {pixels} from '../web/js/framebuffer.js';
import {drawGuidanceTarget} from '../web/js/guidance-target.js';
import {WPN} from '../web/js/weapons.js';
const listeners={};globalThis.window={addEventListener:(name,f)=>listeners[name]=f};
initInput({addEventListener(){}});
const key=(type,code)=>listeners[type]({code,key:code,preventDefault(){}});
for(const guidance of [WPN.HORZ_GUIDANCE,WPN.VERT_GUIDANCE,WPN.LAZY_BOY]) {
 for(const method of ['digit','left','right','drag-left','drag-right']) {
  Object.assign(config,{numPlayers:2,playMode:0,talkingTanks:0});createPlayers(2);clearProjectiles();
  const shooter=players[0],enemy=players[1];
  Object.assign(shooter,{x:80,y:300,angle:45,power:500,guidanceWeapon:guidance,selectedWeapon:WPN.MISSILE,contactTriggerArmed:true});
  Object.assign(enemy,{x:240,y:200});
  shooter.inventory[guidance]=2;shooter.inventory[WPN.MISSILE]=3;shooter.inventory[WPN.CONTACT_TRIGGER]=2;
  Object.assign(mouse,{buttons:0,clicked:0,over:true,x:240,y:200});
  Object.assign(game,{state:STATE.AIM,currentPlayer:0});
  key('keydown','Space');gameTick();
  assert.equal(game.state,STATE.GUIDANCE_TARGET);assert.equal(projectiles.length,0);
  assert.equal(shooter.inventory[guidance],1);assert.equal(shooter.inventory[WPN.MISSILE],2);
  assert.equal(shooter.inventory[WPN.CONTACT_TRIGGER],1);assert.equal(shooter.guidanceWeapon,guidance);
  pixels.fill(87);const before=pixels.slice();drawGuidanceTarget();
  gameTick();assert.equal(game.state,STATE.GUIDANCE_TARGET); // held firing key
  key('keyup','Space');gameTick();
  key('keydown','Escape');gameTick();assert.equal(game.state,STATE.GUIDANCE_TARGET);
  key('keyup','Escape');gameTick();
  key('keydown','Digit1');gameTick();assert.equal(game.state,STATE.GUIDANCE_TARGET); // self invalid
  key('keyup','Digit1');gameTick();
  if(method==='digit') key('keydown','Digit2');
  else {
    mouse.buttons=method.endsWith('left')?1:4;
    if(method.startsWith('drag')) {
      mouse.x=2;gameTick();assert.equal(game.state,STATE.GUIDANCE_TARGET);
      mouse.x=240; // still held; no new click event
    }
  }
  gameTick();
  if(method==='digit') {
    assert.equal(game.state,STATE.GUIDANCE_TARGET);
    assert.equal(projectiles.length,0);
    key('keyup','Digit2');gameTick();
  }
  assert.equal(game.state,STATE.FLIGHT);assert.equal(projectiles.length,1);
  assert.equal(shooter.inventory[guidance],1);assert.equal(shooter.inventory[WPN.MISSILE],2);
  assert.equal(shooter.inventory[WPN.CONTACT_TRIGGER],1);assert.equal(shooter.guidanceWeapon,WPN.LASER);
  assert.equal(projectiles[0].guidanceType,guidance);
  assert.equal(projectiles[0].guidanceTarget.x,240);assert.equal(projectiles[0].guidanceTarget.y,200);
  assert.equal(projectiles[0].guidanceTargetReference===enemy,!method.endsWith('left'));
  enemy.x=250;enemy.y=210;
  assert.deepEqual(projectiles[0].guidanceTarget,{x:240,y:200});
  assert.deepEqual(pixels,before);
  key('keyup','Digit2');
 }
}
console.log('15 guidance firing flows pass release waits, invalid/self input, target transfer, ammo accounting and screen restoration.');
