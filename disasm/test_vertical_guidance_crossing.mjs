import assert from 'node:assert/strict';
import {config} from '../web/js/config.js';
import {createProjectile,stepSingleProjectile,setResolvedWallType,WALL} from '../web/js/physics.js';
import {terrainBitmap} from '../web/js/terrain.js';
import {createPlayers} from '../web/js/tank.js';
import {applyGuidance} from '../web/js/behaviors.js';
import {WPN} from '../web/js/weapons.js';
Object.assign(config,{numPlayers:2,gravity:0,airViscosity:0});createPlayers(2);terrainBitmap.fill(0);setResolvedWallType(WALL.CONCRETE);
for(const tx of [102,105,110,111,112]) {
 const p=createProjectile(100,100,500,0,WPN.BABY_MISSILE,0);
 p.guidanceType=WPN.VERT_GUIDANCE;p.guidanceTarget={x:tx,y:100};
 applyGuidance(p);assert.equal(p.guidanceType,WPN.VERT_GUIDANCE);
 assert.equal(stepSingleProjectile(p,()=>120,0),'flying');
 assert.equal(p.guidanceType,tx<=110?0:WPN.VERT_GUIDANCE,`target column ${tx}`);
 if(tx<=110) {assert.equal(p.guidanceCorrX,0);assert.equal(p.guidanceCorrY,1);}
}
console.log('Vertical guidance triggers on crossed target columns and does not activate in adjacent columns.');

const attracted={x:100,y:90,vx:0,vy:0,guidanceTarget:{x:100,y:100},guidanceAttraction:true,guidanceCorrX:0,guidanceCorrY:-1};
assert.equal(applyGuidance(attracted),undefined);assert.ok(attracted.vy < -1);
attracted.y=101;const before={vx:attracted.vx,vy:attracted.vy};
assert.equal(applyGuidance(attracted),'explode');assert.equal(attracted.vx,before.vx);assert.equal(attracted.vy,before.vy);
console.log('Live vertical attraction accelerates toward the target and requests impact on overshoot.');
