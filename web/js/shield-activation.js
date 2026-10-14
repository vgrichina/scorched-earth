// Native E-key wrapper 0x38765. Advance only over the retained gameplay frame;
// normal world/HUD repaint and input are suspended until the wrapper returns.
import {SHIELD_CONFIG,walkShieldShape,eraseMovingShield} from './shields.js';
import {WPN} from './weapons.js';
import {getPixel} from './framebuffer.js';
import {writeWorldPixel,retainWorldPixel} from './projectile-render.js';
import {setPaletteRgb,palette6} from './palette.js';
import {drawHudShield} from './hud.js';
import {config} from './config.js';
import {playShieldActivationSound} from './sound.js';

export const shieldActivation = {active:false,sequence:null,frame:-1};

export function activateShield(player,kind=player.selectedShield??player.activeShield) {
  if (shieldActivation.active || !SHIELD_CONFIG[kind]) return false;
  const item=WPN.MAG_DEFLECTOR+kind-1;
  if (kind && !(player.inventory[item]>0)) return false;
  shieldActivation.active=true;
  shieldActivation.frame=-1;
  shieldActivation.nextAt=undefined;
  shieldActivation.sequence=activate(player,kind,item);
  return true;
}

function* activate(player,kind,item) {
  if (kind) player.inventory[item]--;
  if (player.shieldEnergy>0 && player.activeShield!==kind) {
    const erased=[],color=(player.colorIndex??player.index)*8+5;
    walkShieldShape(player,(x,y)=>{if(getPixel(x,y)===color)erased.push([x,y]);});
    eraseMovingShield(player);
    // Unlike movement, activation does not redraw the tank behind erased
    // shield pixels. Retain those sky writes across the main world's repaint.
    for (const [x,y] of erased) retainWorldPixel(x,y,getPixel(x,y));
    player.shieldEnergy=0;
  }
  player.activeShield=kind;
  if (kind) {
    const cfg=SHIELD_CONFIG[kind],color=(player.colorIndex??player.index)*8+5;
    player.shieldEnergy=cfg.energy;
    player.shieldContactHoles=null;
    // This wrapper paints the main palette slot on both halves. Lower-half
    // recoloring is a separate native call, not part of E-key activation.
    player.shieldLowerColor={key:`${player.x},${player.y},${kind}`,
      // Old lower pixels may survive the switch. Native does not recolor
      // their dedicated entry here, even after the new main-slot fade.
      rgb:Array.from(palette6.slice((200+player.index)*3,(201+player.index)*3)),redrawn:true};
    setPaletteRgb(color,0,0,0);
    walkShieldShape(player,(x,y)=>{
      const under=getPixel(x,y);
      if (!(under>=120 && under<=144)) writeWorldPixel(x,y,color);
    });
    for (let frame=0;frame<=50;frame++) {
      const intensity=Math.trunc(frame*63/50);
      setPaletteRgb(color,...[cfg.r,cfg.g,cfg.b].map(c=>Math.trunc(c*intensity/63)));
      shieldActivation.frame=frame;
      yield;
    }
  }
  player.hudShieldEnergy=undefined;
  if (config.statusBar) drawHudShield(player);
}

export function stepShieldActivation() {
  if (!shieldActivation.active) return false;
  if (shieldActivation.sequence.next().done) {
    shieldActivation.active=false;
    shieldActivation.sequence=null;
  }
  return shieldActivation.active;
}

// Native sound(freq,20) waits 20 ms BEFORE each palette upload. The first
// upload is black, identical to the outline's initial palette. Sound-off
// dispatch returns immediately. Catch up after delayed display callbacks.
export function advanceShieldActivation(now=performance.now()) {
  if (!shieldActivation.active) return false;
  if (shieldActivation.nextAt===undefined) {
    stepShieldActivation(); // Initial black outline, also fade frame zero.
    if (!shieldActivation.active) return false;
    if (!config.soundEnabled) {
      while(shieldActivation.active) stepShieldActivation();
      return false;
    }
    playShieldActivationSound();
    shieldActivation.nextAt=now+40; // Frame 1 follows two 20 ms tones.
  }
  while(shieldActivation.active && now>=shieldActivation.nextAt) {
    stepShieldActivation();
    shieldActivation.nextAt+=20;
    // Native updates the HUD immediately after the last palette upload.
    if(shieldActivation.frame===50) stepShieldActivation();
  }
  return shieldActivation.active;
}
