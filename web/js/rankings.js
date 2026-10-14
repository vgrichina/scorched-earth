// Standard between-round Rankings dialog, native 0x33FC3.
import {config} from './config.js';
import {drawBox3DRaised,drawBox3DSunken,hline} from './framebuffer.js';
import {drawText,measureText} from './font.js';
import {compareRoundPlayers} from './turn-order.js';
import {drawRankingsWinnerName} from './hud.js';
import {resolvedSkyType,getPlayerColor,setPaletteRgb} from './palette.js';
import {isKeyDown,consumeKey,consumeClick,mouse} from './input.js';
import {UI_BACKGROUND,UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,
  UI_BRIGHT_BORDER,UI_HIGHLIGHT} from './constants.js';

export const rankingsInput={key:null,mouse:false};
export function resetRankingsInput() {
  rankingsInput.key=null;rankingsInput.mouse=false;
}

function goButton(layout) {
  const width=measureText('~Go')+12;
  return {x:layout.x+Math.floor((layout.width-width+2)/2),
    y:layout.y+layout.buttonY-layout.border,width,height:12+2*layout.border+1};
}

export function stepRankingsInput(players,round,rounds) {
  if(rankingsInput.key) {
    if(isKeyDown(rankingsInput.key))return false;
    rankingsInput.key=null;return true;
  }
  const layout=rankingsLayout(players,round,rounds),b=goButton(layout);
  const inside=mouse.x>=b.x&&mouse.x<b.x+b.width&&mouse.y>=b.y&&mouse.y<b.y+b.height;
  if(rankingsInput.mouse) {
    if(mouse.buttons&1)return false;
    rankingsInput.mouse=false;return true;
  }
  if(consumeKey('Escape'))return true;
  for(const key of ['Enter','Space','KeyG']) {
    if(isKeyDown(key)){rankingsInput.key=key;return false;}
  }
  if(consumeClick(0)) {
    // Native dialog_poll_input treats an outside click like Escape.
    if(mouse.x<layout.x||mouse.x>layout.x+layout.width||
       mouse.y<layout.y||mouse.y>layout.y+layout.height)return true;
    if(inside) {
      rankingsInput.mouse=!!(mouse.buttons&1);
      return !rankingsInput.mouse;
    }
  }
  return false;
}

export function rankedPlayers(players) {
  const result=[],used=new Set();
  for(let i=0;i<players.length;i++) {
    let best=-1;
    for(let j=0;j<players.length;j++)
      if(!used.has(j)&&(best<0||compareRoundPlayers(players[best],players[j])<0))best=j;
    used.add(best);result.push(players[best]);
  }
  return result;
}
export const currency = score => '$'+String(Math.trunc(score)).replace(/\B(?=(\d{3})+(?!\d))/g,',');
export function rankingsLayout(players,round,rounds) {
  const board=rankedPlayers(players),rowHeight=config.screenHeight<221?11:13;
  const winsX=40+Math.max(...players.map(p=>measureText(p.name)));
  const scoreX=winsX+25;
  const remaining=rounds-round;
  const footer=remaining===1?'1 round remains.':`${remaining} rounds remain.`;
  const width=Math.max(scoreX+Math.max(...board.map(p=>measureText(currency(p.score)))),
    10+measureText(footer),measureText('Rankings'))+10;
  const buttonY=25+(board.length+1)*rowHeight+5;
  const border=config.screenHeight>=400?3:2;
  const height=buttonY+12+border+10;
  return {board,rowHeight,winsX,scoreX,footer,width,height,buttonY,border,
    x:Math.floor((config.screenWidth-1-width)/2),y:Math.floor((config.screenHeight-1-height)/2)};
}
export function drawRankings(players,round,rounds,{winnerName=true,pressed=!!rankingsInput.key||rankingsInput.mouse}={}) {
  if(winnerName)drawRankingsWinnerName(players);
  // Native 0x3412E restores player DAC entries after death palette effects.
  for(const player of players) {
    const rgb=player.displayColor??getPlayerColor(player.colorIndex);
    for(let slot=0;slot<8;slot++)setPaletteRgb(player.colorIndex*8+slot,
      ...(resolvedSkyType===6?[0,0,0]:slot===5?[63,63,63]:slot===7?[30,30,30]:rgb));
  }
  const l=rankingsLayout(players,round,rounds);
  const {x,y,width,height,board,rowHeight,winsX,scoreX,footer,buttonY,border}=l;
  drawBox3DRaised(x,y,width+1,height+1,UI_BACKGROUND,
    UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
  const title='Rankings',barWidth=Math.floor((width-8-measureText(title))/2);
  const tied=board.length>1&&compareRoundPlayers(board[1],board[0])===0;
  const barColor=tied?UI_BACKGROUND:board[0].colorIndex*8;
  for(const bx of [x+4,x+width-barWidth])
    drawBox3DSunken(bx,y+5,barWidth-3,12,barColor,
      UI_MED_BORDER,UI_BRIGHT_BORDER,UI_DARK_BORDER,UI_LIGHT_BORDER);
  hline(x+5,x+width-5,y+18,UI_LIGHT_BORDER);
  hline(x+5,x+width-5,y+19,UI_MED_BORDER);
  drawText(x+Math.floor((width-measureText(title)+1)/2),y+5,title,UI_HIGHLIGHT);
  let rank=1;
  board.forEach((p,i)=>{
    if(i&&compareRoundPlayers(p,board[i-1])!==0)rank=i+1;
    const row=y+25+i*rowHeight;
    drawText(x+10,row,`#${rank}`,UI_HIGHLIGHT);
    drawText(x+30,row,p.name,UI_HIGHLIGHT);
    drawText(x+winsX,row,String(p.wins),UI_HIGHLIGHT);
    drawText(x+scoreX,row,currency(p.score),UI_HIGHLIGHT);
  });
  drawText(x+Math.floor((width-measureText(footer)+1)/2),y+25+board.length*rowHeight,footer,UI_HIGHLIGHT);
  const buttonWidth=measureText('~Go')+12,bx=x+Math.floor((width-buttonWidth+2)/2);
  if(pressed) {
    drawBox3DSunken(bx,y+buttonY-border,buttonWidth,12+2*border+1,UI_BACKGROUND,
      UI_MED_BORDER,UI_BRIGHT_BORDER,UI_DARK_BORDER,UI_LIGHT_BORDER);
    drawText(bx+7,y+buttonY+2,'Go',UI_HIGHLIGHT);
  } else {
    drawBox3DRaised(bx,y+buttonY-border,buttonWidth,12+2*border+1,UI_BACKGROUND,
      UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
    drawText(bx+5,y+buttonY,'~Go',UI_HIGHLIGHT);
  }
  return l;
}
