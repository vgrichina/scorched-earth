import {teamName} from './team-scoring.js';
import {playerRankingValue} from './ranking-value.js';
// Native final scoring dialog: paint 0x34CC6, build 0x34F2F.
import {config,getUIBorderHeight,getUIButtonHeight} from './config.js';
import {fillRect,hline,vline,drawBox3DRaised,drawBox3DSunken} from './framebuffer.js';
import {drawText,drawTextEmbossed,measureText} from './font.js';
import {rankedPlayers,rankedTeams,currency} from './rankings.js';
import {getPlayerColor,setPaletteRgb} from './palette.js';
import {isKeyDown,consumeKey,consumeClick,mouse} from './input.js';
import {AI_NAMES} from './ai.js';
import {UI_BACKGROUND,UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,
  UI_BRIGHT_BORDER,UI_HIGHLIGHT,UI_DEEP_SHADOW,UI_DARK_TEXT} from './constants.js';

export const finalScoringInput={key:null,mouse:false,pressed:-1,redrawn:-1,showTeams:false,showTypes:false,namesRestored:false,phase:2};
export function resetFinalScoringInput() {
  Object.assign(finalScoringInput,{key:null,mouse:false,pressed:-1,redrawn:-1,showTeams:false,showTypes:false,namesRestored:false,phase:2});
}

// Returns the native action (0 Quit, 1 New Game), or null while open.
export function stepFinalScoringInput(players) {
  const state=finalScoringInput;
  const activate=()=>{
    const action=state.pressed;state.pressed=-1;state.key=null;state.mouse=false;
    if(action>=2)return null;
    return action;
  };
  if(state.key)return isKeyDown(state.key)?null:activate();
  if(state.mouse)return mouse.buttons&1?null:activate();
  state.phase=(state.phase+1)%40;
  if(consumeKey('Escape'))return 0;
  const layout=finalScoringLayout(players,{showTypes:state.showTypes,showTeams:state.showTeams});
  const keys=layout.buttons.map(b=>b.action==='quit'?'KeyQ':b.action==='new'?'KeyG':b.action==='teams'?(state.showTeams?'KeyP':'KeyT'):(state.showTypes?'KeyN':config.teamMode!==0?'KeyY':'KeyT'));
  const press=i=>{
    state.pressed=i;state.redrawn=i;
    if(layout.buttons[i].action==='type'){state.namesRestored=state.showTypes;state.showTypes=!state.showTypes;}
    if(layout.buttons[i].action==='teams'){state.showTeams=!state.showTeams;state.namesRestored=false;}
  };
  for(let i=0;i<layout.buttons.length;i++) {
    if(!layout.buttons[i].disabled&&isKeyDown(keys[i])){
      press(i);
      state.key=keys[i];return null;
    }
  }
  if(consumeClick(0)) {
    if(mouse.x<layout.x||mouse.x>layout.x+layout.width||
       mouse.y<layout.y||mouse.y>layout.y+layout.height)return 0;
    const i=layout.buttons.findIndex(b=>!b.disabled&&mouse.x>=layout.x+b.x&&mouse.x<layout.x+b.x+b.width&&
      mouse.y>=layout.y+b.y&&mouse.y<layout.y+b.y+b.height);
    if(i>=0){press(i);state.mouse=!!(mouse.buttons&1);if(!state.mouse)return activate();}
  }
  return null;
}

export function finalScoringLayout(players,{showTypes=false,showTeams=false}={}) {
  const board=rankedPlayers(players),rowHeight=config.screenHeight<221?11:13;
  const bestScore=Math.max(0,...players.map(playerRankingValue));
  // Native 0x336A0 reserves classification width for slots 1 onward.
  const classification=p=>p.aiType?AI_NAMES[p.aiType]:playerRankingValue(p)<Math.trunc(bestScore/10)?'Sentient?':'Sentient';
  const teams=config.teamMode!==0;
  const nameWidth=Math.max(teams?measureText('9 tanks'):0,...players.map(p=>measureText(p.name)),
    ...players.slice(1).map(p=>measureText(classification(p))));
  const teamWidth=teams?Math.max(...players.map(p=>measureText(teamName(p.team)))):0;
  const teamX=40+nameWidth,winsX=teamX+(teams?teamWidth+10:0),scoreX=winsX+25;
  const width=scoreX+Math.max(...board.map(p=>measureText(currency(playerRankingValue(p)))))+10;
  const border=getUIBorderHeight(),buttonY=33+board.length*rowHeight+5;
  const height=buttonY-border+getUIButtonHeight()-1+10;
  const typeLabel=teams?'T~ype':'~Type';
  const labels=['~Quit','New ~Game'],actions=['quit','new'];
  if(players.some(p=>p.aiType)){labels.push(showTypes?'~Name':typeLabel);actions.push('type');}
  if(teams){labels.push(showTeams?'~Players':'~Teams');actions.push('teams');}
  // Toggling the label preserves the original button geometry.
  const buttonWidths=labels.map((label,i)=>measureText(actions[i]==='type'?typeLabel:actions[i]==='teams'?'~Players':label)+11);
  const spare=width-buttonWidths.reduce((a,b)=>a+b,0),gap=Math.trunc(spare/(labels.length+1));
  const offset=Math.floor((spare-(labels.length+1)*gap)/2);
  const buttons=labels.map((label,i)=>({label,action:actions[i],disabled:actions[i]==='type'&&showTeams,x:offset+(i+1)*gap+buttonWidths.slice(0,i).reduce((a,b)=>a+b,0),
    y:buttonY-border,width:buttonWidths[i]+1,height:getUIButtonHeight()}));
  return {classifications:board.map(classification),board,rowHeight,winsX,scoreX,teamX,teamWidth,width,height,buttons,buttonY,
    x:Math.floor((config.screenWidth-1-width)/2),y:Math.floor((config.screenHeight-1-height)/2)};
}

export function drawFinalScoring(players,{phase=finalScoringInput.phase,showTypes=finalScoringInput.showTypes,showTeams=finalScoringInput.showTeams,pressed=finalScoringInput.pressed,redrawn=finalScoringInput.redrawn,namesRestored=finalScoringInput.namesRestored}={}) {
  const l=finalScoringLayout(players,{showTypes,showTeams}),{x,y,width,height,board,rowHeight,winsX,scoreX,buttons,buttonY}=l;
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
  if(showTeams)rankedTeams(players).forEach((p,i)=>{
    const row=y+33+i*rowHeight;
    drawText(x+10,row,`#${i+1}`,UI_HIGHLIGHT);drawText(x+30,row,p.name,UI_HIGHLIGHT);
    drawText(x+40+l.teamWidth,row,`${p.members} tank${p.members===1?'':'s'}`,UI_HIGHLIGHT);
    drawText(x+winsX,row,String(p.wins),UI_HIGHLIGHT);drawText(x+scoreX,row,currency(p.score),UI_HIGHLIGHT);
  });
  else board.forEach((p,i)=>{
    const row=y+33+i*rowHeight;
    drawText(x+10,row,`#${i+1}`,UI_HIGHLIGHT);drawText(x+30,row,p.name,UI_HIGHLIGHT);
    if(config.teamMode!==0)drawText(x+l.teamX,row,teamName(p.team),UI_HIGHLIGHT);
    drawText(x+winsX,row,String(p.wins),UI_HIGHLIGHT);drawText(x+scoreX,row,currency(playerRankingValue(p)),UI_HIGHLIGHT);
  });
  // Native toggling erases the old glyphs, including any overlap into wins.
  // Rebuilding whole rows would incorrectly restore those covered pixels.
  if(!showTeams&&(showTypes||namesRestored))board.forEach((p,i)=>{
    const row=y+33+i*rowHeight;
    drawText(x+30,row,showTypes?p.name:l.classifications[i],UI_BACKGROUND);
    drawText(x+30,row,showTypes?l.classifications[i]:p.name,UI_HIGHLIGHT);
  });
  // Adjacent inclusive button spans can share a border pixel. Native redraws
  // the activated button last, preserving that edge over its neighbor.
  const buttonOrder=[...buttons.keys()].filter(i=>i!==redrawn);
  if(redrawn>=0&&redrawn<buttons.length)buttonOrder.push(redrawn);
  for(const i of buttonOrder) {
    const b=buttons[i];
    // Returning to Players repaints all widgets immediately, including this
    // button's raised face while the initiating key/mouse is still held.
    const down=i===pressed&&!(b.action==='teams'&&!showTeams);
    const label=down&&b.action==='type'?(showTypes?(config.teamMode!==0?'T~ype':'~Type'):'~Name'):down&&b.action==='teams'?(showTeams?'~Teams':'~Players'):b.label;
    if(down)drawBox3DSunken(x+b.x,y+b.y,b.width,b.height,UI_BACKGROUND,
      UI_MED_BORDER,UI_BRIGHT_BORDER,UI_DARK_BORDER,UI_LIGHT_BORDER);
    else drawBox3DRaised(x+b.x,y+b.y,b.width,b.height,UI_BACKGROUND,
      UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
    const tx=x+b.x+(b.action==='teams'?5:Math.floor((b.width-1-measureText(label))/2))+(down?2:0),ty=y+buttonY+(down?2:0);
    if(b.disabled){
      drawText(tx+1,ty,label.replace('~',''),UI_LIGHT_BORDER);
      drawText(tx,ty,label.replace('~',''),UI_DARK_TEXT);
    } else drawText(tx,ty,down?label.replace('~',''):label,UI_HIGHLIGHT);
  }
  drawTextEmbossed(Math.trunc((config.screenWidth-1-2*measureText('Final Scoring')-4)/2),y+5,
    'Final Scoring',[UI_DEEP_SHADOW,UI_BRIGHT_BORDER,UI_DARK_TEXT,UI_BACKGROUND,UI_DARK_BORDER]);
  return l;
}
