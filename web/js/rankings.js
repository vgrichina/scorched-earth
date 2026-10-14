// Between-round Rankings dialog, native 0x33FC3.
import {getTeamScore,teamName} from './team-scoring.js';
import {config} from './config.js';
import {drawBox3DRaised,drawBox3DSunken,hline} from './framebuffer.js';
import {drawText,measureText} from './font.js';
import {playerRankingValue} from './ranking-value.js';
import {compareRoundPlayers,compareRankingEntries} from './turn-order.js';
import {drawRankingsWinnerName} from './hud.js';
import {resolvedSkyType,getPlayerColor,setPaletteRgb} from './palette.js';
import {isKeyDown,consumeKey,consumeClick,mouse} from './input.js';
import {UI_BACKGROUND,UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,
  UI_BRIGHT_BORDER,UI_HIGHLIGHT} from './constants.js';

export const rankingsInput={key:null,mouse:false,showTeams:false,pressed:0};
export function resetRankingsInput() {
  rankingsInput.key=null;rankingsInput.mouse=false;rankingsInput.showTeams=false;rankingsInput.pressed=0;
}

export function rankingsButtons(layout,showTeams=rankingsInput.showTeams) {
  const labels=config.teamMode===0?['~Go']:[showTeams?'~Players':'~Teams','~Go'];
  if(labels.length===1){const width=measureText('~Go')+12;return [{label:'~Go',x:layout.x+Math.floor((layout.width-width+2)/2),y:layout.y+layout.buttonY-layout.border,width,height:12+2*layout.border+1}];}
  const spans=labels.map(label=>measureText(label)+11);
  const spare=layout.width-spans.reduce((a,b)=>a+b,0),gap=Math.trunc(spare/(labels.length+1));
  const offset=Math.floor((spare-gap*(labels.length+1))/2);
  return labels.map((label,i)=>({label,x:layout.x+offset+(i+1)*gap+spans.slice(0,i).reduce((a,b)=>a+b,0),
    y:layout.y+layout.buttonY-layout.border,width:spans[i]+1,height:12+2*layout.border+1}));
}

export function stepRankingsInput(players,round,rounds) {
  const state=rankingsInput;
  const activate=()=>{
    const toggle=config.teamMode!==0&&state.pressed===0;
    state.key=null;state.mouse=false;
    if(toggle)state.showTeams=!state.showTeams;
    return !toggle;
  };
  if(state.key)return isKeyDown(state.key)?false:activate();
  if(state.mouse)return mouse.buttons&1?false:activate();
  const layout=rankingsLayout(players,round,rounds),buttons=rankingsButtons(layout);
  if(consumeKey('Escape'))return true;
  for(const key of ['Enter','Space','KeyG',...(config.teamMode!==0?[state.showTeams?'KeyP':'KeyT']:[])]) {
    if(isKeyDown(key)){state.key=key;state.pressed=key==='KeyT'||key==='KeyP'?0:buttons.length-1;return false;}
  }
  if(consumeClick(0)) {
    if(mouse.x<layout.x||mouse.x>layout.x+layout.width||
       mouse.y<layout.y||mouse.y>layout.y+layout.height)return true;
    const i=buttons.findIndex(b=>mouse.x>=b.x&&mouse.x<b.x+b.width&&mouse.y>=b.y&&mouse.y<b.y+b.height);
    if(i>=0){state.pressed=i;state.mouse=!!(mouse.buttons&1);return state.mouse?false:activate();}
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
export function rankedTeams(players) {
  const compareTeams=compareRankingEntries;
  const teamBoard=[];
  for(const team of [...new Set(players.map(p=>p.team))].sort((a,b)=>a-b)) {
    teamBoard.push({...getTeamScore(team),team,name:teamName(team),members:players.filter(p=>p.team===team).length});
  }
  const sortedTeams=[];
  while(teamBoard.length){let best=0;for(let i=1;i<teamBoard.length;i++)if(compareTeams(teamBoard[best],teamBoard[i])<0)best=i;sortedTeams.push(teamBoard.splice(best,1)[0]);}
  return sortedTeams;
}
export const currency = score => '$'+String(Math.trunc(score)).replace(/\B(?=(\d{3})+(?!\d))/g,',');
export function rankingsLayout(players,round,rounds) {
  const board=rankedPlayers(players),rowHeight=config.screenHeight<221?11:13;
  const teams=config.teamMode!==0;
  const nameWidth=Math.max(...players.map(p=>measureText(p.name)),teams?measureText('9 tanks'):0);
  const teamWidth=teams?Math.max(...players.map(p=>measureText(teamName(p.team)))):0;
  const teamX=40+nameWidth,winsX=teamX+(teams?teamWidth+10:0);
  const scoreX=winsX+25;
  const remaining=rounds-round;
  const footer=remaining===1?'1 round remains.':`${remaining} rounds remain.`;
  const width=Math.max(scoreX+Math.max(...board.map(p=>measureText(currency(playerRankingValue(p))))),
    10+measureText(footer),measureText('Rankings'))+10;
  const buttonY=25+(board.length+1)*rowHeight+5;
  const border=config.screenHeight>=400?3:2;
  const height=buttonY+12+border+10;
  return {board,rowHeight,winsX,scoreX,teamX,teamWidth,footer,width,height,buttonY,border,
    x:Math.floor((config.screenWidth-1-width)/2),y:Math.floor((config.screenHeight-1-height)/2)};
}
export function drawRankings(players,round,rounds,{winnerName=true,pressed=!!rankingsInput.key||rankingsInput.mouse,showTeams=rankingsInput.showTeams}={}) {
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
  const title=config.teamMode===0?'Rankings':showTeams?'Team Rankings':'Player Rankings',barWidth=Math.floor((width-8-measureText(title))/2);
  const tied=board.length>1&&compareRoundPlayers(board[1],board[0])===0;
  const barColor=tied||showTeams?UI_BACKGROUND:board[0].colorIndex*8;
  for(const bx of [x+4,x+width-barWidth])
    drawBox3DSunken(bx,y+5,barWidth-3,12,barColor,
      UI_MED_BORDER,UI_BRIGHT_BORDER,UI_DARK_BORDER,UI_LIGHT_BORDER);
  hline(x+5,x+width-5,y+18,UI_LIGHT_BORDER);
  hline(x+5,x+width-5,y+19,UI_MED_BORDER);
  drawText(x+Math.floor((width-measureText(title)+1)/2),y+5,title,UI_HIGHLIGHT);
  let rank=1;
  const compareTeams=compareRankingEntries,sortedTeams=rankedTeams(players);
  if(showTeams)sortedTeams.forEach((p,i)=>{
    if(i&&compareTeams(p,sortedTeams[i-1])!==0)rank=i+1;
    const row=y+25+i*rowHeight;
    drawText(x+10,row,`#${rank}`,UI_HIGHLIGHT);
    drawText(x+30,row,p.name,UI_HIGHLIGHT);
    drawText(x+40+l.teamWidth,row,`${p.members} tank${p.members===1?'':'s'}`,UI_HIGHLIGHT);
    drawText(x+winsX,row,String(p.wins),UI_HIGHLIGHT);
    drawText(x+scoreX,row,currency(p.score),UI_HIGHLIGHT);
  });
  else board.forEach((p,i)=>{
    if(i&&compareRoundPlayers(p,board[i-1])!==0)rank=i+1;
    const row=y+25+i*rowHeight;
    drawText(x+10,row,`#${rank}`,UI_HIGHLIGHT);
    drawText(x+30,row,p.name,UI_HIGHLIGHT);
    if(config.teamMode!==0)drawText(x+l.teamX,row,teamName(p.team),UI_HIGHLIGHT);
    drawText(x+winsX,row,String(p.wins),UI_HIGHLIGHT);
    drawText(x+scoreX,row,currency(playerRankingValue(p)),UI_HIGHLIGHT);
  });
  drawText(x+Math.floor((width-measureText(footer)+1)/2),y+25+board.length*rowHeight,footer,UI_HIGHLIGHT);
  for(const [i,b] of rankingsButtons(l,showTeams).entries()) {
    const down=pressed&&i===rankingsInput.pressed;
    if(down)drawBox3DSunken(b.x,b.y,b.width,b.height,UI_BACKGROUND,
      UI_MED_BORDER,UI_BRIGHT_BORDER,UI_DARK_BORDER,UI_LIGHT_BORDER);
    else drawBox3DRaised(b.x,b.y,b.width,b.height,UI_BACKGROUND,
      UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
    drawText(b.x+5+(down?2:0),y+buttonY+(down?2:0),down?b.label.replace('~',''):b.label,UI_HIGHLIGHT);
  }
  return l;
}
