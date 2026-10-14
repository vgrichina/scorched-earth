// Native final scoring paint callback 0x34CC6. Input is handled separately.
import {config} from './config.js';
import {fillRect,hline,vline,drawBox3DRaised} from './framebuffer.js';
import {drawText,drawTextEmbossed,measureText} from './font.js';
import {rankedPlayers,currency} from './rankings.js';
import {getPlayerColor,setPaletteRgb} from './palette.js';
import {AI_NAMES} from './ai.js';
import {UI_BACKGROUND,UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,
  UI_BRIGHT_BORDER,UI_HIGHLIGHT,UI_DEEP_SHADOW,UI_DARK_TEXT} from './constants.js';

export function finalScoringLayout(players) {
  const board=rankedPlayers(players),rowHeight=config.screenHeight<221?11:13;
  const bestScore=Math.max(0,...players.map(p=>p.score));
  // Native 0x336A0 reserves classification width for slots 1 onward.
  const classification=p=>p.aiType?AI_NAMES[p.aiType]:p.score<Math.trunc(bestScore/10)?'Sentient?':'Sentient';
  const nameWidth=Math.max(...players.map(p=>measureText(p.name)),
    ...players.slice(1).map(p=>measureText(classification(p))));
  const winsX=40+nameWidth,scoreX=winsX+25;
  const width=scoreX+Math.max(...board.map(p=>measureText(currency(p.score))))+10;
  const border=config.screenHeight>=400?3:2,buttonY=33+board.length*rowHeight+5;
  const height=buttonY+12+border+10;
  const labels=['~Quit','New ~Game'],buttonWidths=labels.map(label=>measureText(label)+11);
  const spare=width-buttonWidths.reduce((a,b)=>a+b,0),gap=Math.trunc(spare/3);
  const offset=Math.floor((spare-3*gap)/2);
  const buttons=labels.map((label,i)=>({label,x:offset+(i===0?gap:2*gap+buttonWidths[0]),
    y:buttonY-border,width:buttonWidths[i]+1,height:12+2*border+1}));
  return {board,rowHeight,winsX,scoreX,width,height,buttons,buttonY,
    x:Math.floor((config.screenWidth-1-width)/2),y:Math.floor((config.screenHeight-1-height)/2)};
}

export function drawFinalScoring(players,{phase=2}={}) {
  const l=finalScoringLayout(players),{x,y,width,height,board,rowHeight,winsX,scoreX,buttons,buttonY}=l;
  const rgb=board[0].displayColor??getPlayerColor(board[0].colorIndex);
  for(let i=0;i<40;i++) {
    const j=(i+phase)%40,factor=j<20?j+5:44-j;
    setPaletteRgb(180+i,...rgb.map(c=>Math.trunc(c*factor/24)));
  }
  fillRect(0,0,config.screenWidth-1,config.screenHeight-1,UI_HIGHLIGHT);
  for(let d=1;x-d>=0&&y-d>=0&&x+width+d<config.screenWidth&&y+height+d<config.screenHeight;d++) {
    const color=180+(d-1)%40;
    hline(x-d,x+width+d,y-d,color);hline(x-d,x+width+d,y+height+d,color);
    vline(x-d,y-d,y+height+d,color);vline(x+width+d,y-d,y+height+d,color);
  }
  drawBox3DRaised(x,y,width+1,height+1,UI_BACKGROUND,
    UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
  board.forEach((p,i)=>{
    const row=y+33+i*rowHeight;
    drawText(x+10,row,`#${i+1}`,UI_HIGHLIGHT);drawText(x+30,row,p.name,UI_HIGHLIGHT);
    drawText(x+winsX,row,String(p.wins),UI_HIGHLIGHT);drawText(x+scoreX,row,currency(p.score),UI_HIGHLIGHT);
  });
  for(const b of buttons) {
    drawBox3DRaised(x+b.x,y+b.y,b.width,b.height,UI_BACKGROUND,
      UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
    drawText(x+b.x+5,y+buttonY,b.label,UI_HIGHLIGHT);
  }
  drawTextEmbossed(Math.trunc((config.screenWidth-1-2*measureText('Final Scoring')-4)/2),y+5,
    'Final Scoring',[UI_DEEP_SHADOW,UI_BRIGHT_BORDER,UI_DARK_TEXT,UI_BACKGROUND,UI_DARK_BORDER]);
  return l;
}
