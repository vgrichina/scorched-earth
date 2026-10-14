// Native dirt settling: 0x20CE7, column search 0x20C39. Each pass moves
// one pixel from the top to the bottom of each unsupported column segment.
import {config} from './config.js';
import {terrain,terrainBitmap,PLAYFIELD_TOP} from './terrain.js';
import {getPixel,getBackgroundColor} from './framebuffer.js';
import {writeWorldPixel} from './projectile-render.js';
import {random} from './utils.js';
import {players,drawTank} from './tank.js';
import {refreshShieldLowerPalette} from './shields.js';

let dirtyLeft=Infinity,dirtyRight=-Infinity;
let runs=null;
export function clearTerrainCollapse() {
  dirtyLeft=Infinity;dirtyRight=-Infinity;runs=null;
}
export function markTerrainCollapse(left,right) {
  dirtyLeft=Math.min(dirtyLeft,left);dirtyRight=Math.max(dirtyRight,right);
}
function nativePixel(x,y) {
  const c=getPixel(x,y);
  return c>=80&&c<110?c+40:c>=120&&c<150?c-40:c;
}
const solid=c=>c>=80&&c<=104;
function findRun(x,start) {
  const bottom=config.screenHeight-4;
  for(let top=start;top<bottom;top++) {
    if(!solid(nativePixel(x,top)))continue;
    let end=top+1;
    while(end<=bottom&&solid(nativePixel(x,end)))end++;
    if(end<=bottom&&nativePixel(x,end)>=105)return {x,top,end};
    top=end;
  }
  return null;
}
function updateHeight(x) {
  let y=PLAYFIELD_TOP;
  while(y<config.screenHeight&&!terrainBitmap[y*config.screenWidth+x])y++;
  terrain[x]=y;
}
// Returns true while a settling pass occupies this frame. Native executes the
// same passes synchronously; frame duration is not inferred from CPU speed.
export function stepTerrainCollapse() {
  const W=config.screenWidth,bottom=config.screenHeight-4;
  if(runs===null) {
    // Native 0x1CF06 redraws live tanks even if no dirt pass is needed.
    // These are world writes: they replace retained blast/ray erasures.
    for (const player of players) drawTank(player,false,writeWorldPixel);
    if(dirtyLeft>dirtyRight)return false;
    const left=Math.max(3,dirtyLeft-5),right=Math.min(W-4,dirtyRight+5);
    dirtyLeft=Infinity;dirtyRight=-Infinity;
    const chance=100-config.suspendDirt;
    if(chance<=0||(chance<100&&random(100)>=chance))return false;
    players.forEach(refreshShieldLowerPalette);
    runs=[];
    for(let x=left;x<=right;x++) {
      let start=PLAYFIELD_TOP;
      // Castle's upper solid layer is supported by the ceiling.
      if(config.landType===5) {
        while(start<=bottom&&nativePixel(x,start)<105)start++;
      }
      const run=findRun(x,start);
      if(run)runs.push(run);
    }
    if(runs.length)return true;
    runs=null;return false;
  }
  if(!runs.length){
    runs=null;
    for (const player of players) drawTank(player,false,writeWorldPixel);
    return false;
  }
  for(let i=0;i<runs.length;i++) {
    const run=runs[i];
    terrainBitmap[run.top*W+run.x]=0;
    writeWorldPixel(run.x,run.top,getBackgroundColor(run.top,run.x));
    run.top++;
    // Native 0x299C0 calls random(1) even with the one-color ground table.
    random(1);
    terrainBitmap[run.end*W+run.x]=120;
    writeWorldPixel(run.x,run.end,120);
    do {run.end++;} while(run.end<=bottom&&solid(nativePixel(run.x,run.end)));
    if(run.end>bottom||nativePixel(run.x,run.end)<=105) {
      const next=findRun(run.x,run.end);
      if(next)runs[i]=next;
      else {runs[i]=runs[runs.length-1];runs.pop();i--;}
    }
    updateHeight(run.x);
  }
  return true;
}
