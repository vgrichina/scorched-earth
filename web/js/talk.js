// Scorched Earth - Talking Tanks System
// EXE source: comments.cpp — speech bubble display on fire/death events
// EXE: attack phrases from TALK1.CFG (54 entries)
// EXE: death phrases from TALK2.CFG (61 entries)
// EXE: pre-fire handler at 0x30668 loads string from DS:0xCC8E

import { config } from './config.js';
import { drawText, measureText, FONT_HEIGHT } from './font.js';
import { fillRect, hline, vline } from './framebuffer.js';
import { players } from './tank.js';
import { random } from './utils.js';
import { UI_DEEP_SHADOW, UI_DARK_BORDER } from './constants.js';

// All 54 attack phrases from earth/TALK1.CFG
const ATTACK_PHRASES = [
  'In times of trouble, go with what you know.',
  'Die!',
  'Eat my shorts!',
  "You're toast!",
  'Banzai!',
  "From Hell's heart I stab at thee...",
  "I didn't do it.  Nobody saw me do it.",
  'Take a hike!',
  "You're dead meat.",
  'Make my day.',
  'Charge!',
  'Attack!',
  "You're outta here.",
  'Wattsa matta you?',
  "Freeze, or I'll shoot!",
  'Ha ha ha.',
  'We come in peace - Shoot to kill!',
  'In your face!',
  'Die Commie Pig!',
  'I love the smell of Napalm in the morning.',
  'Victory!',
  'Show some respect.',
  'Just who do you think you are?',
  'Look out below!',
  'Knock, Knock.',
  'Look over there.',
  "Guess what's coming for dinner?",
  'Merry Christmas.',
  'Open wide!',
  'Here goes nothing...',
  "Don't worry, it isn't a live round.",
  'Blood, Pain, Violence!',
  'Take this, sissy!',
  'I shall flatten you!',
  'I shall smash your ugly tank!',
  'I wonder what this button does?',
  "Don't take this personally.",
  'Would this make you mad?',
  'I told you to leave my sister alone!',
  'I could spare you, but why?',
  'My bomb is bigger than yours.',
  "Don't forget about me!",
  'Hasta la vista, Baby!',
  'This is your brain on Scorch.',
  'Take this!',
  "This screen ain't big enough for the both of us.",
  'Die, Alien Swine!',
  'Say "Arrgghhhhh...."',
  'I shall oil my turret with your blood.',
  'Die, tank-scum!',
  "I'm gonna break your face!",
  'Mama said knock you out!',
  'I hope you enjoy pain!',
  'Parting is such sweet sorrow... Not!',
];

// All 61 death phrases from earth/TALK2.CFG
const DEATH_PHRASES = [
  'Ugh!',
  'Aargh!',
  'Aaagghhh!',
  "I'm melting!",
  'Oof..',
  'Oh!',
  'Eeek!',
  'Aacch!',
  'I hate it when that happens.',
  'One direct hit can ruin your whole day.',
  'Oh no!',
  'Not me!',
  'Ouch.',
  'Oh no, not again.',
  'Another one bites the dust.',
  'Goodbye.',
  'Help me!',
  'Farewell, cruel world.',
  'Remember the Alamo!',
  'Oh man!',
  'Doough!',
  'Another day, another bomb.',
  'This is the End, my only friend.',
  "It's all over.",
  'The fat lady sang.',
  'Why does everything happen to me?',
  "I'm going down.",
  "I've got a bad feeling about this.",
  'Crapola.',
  'Pow!',
  'Bif!',
  'Bam!',
  'Zonk!',
  "I should've listened to my mother...",
  'No... a Bud light!',
  'What was that noise?',
  "Mama said there'd be days like this.",
  'Its just one of those days...',
  'I see a bright light...',
  'Mommy? Is that you?',
  'I let you hit me!',
  'Sucker shot!',
  "I didn't want to live anyway.",
  '-<sob>-',
  'Was that as close as I think it was?',
  'Join the army, see the world they said.',
  "It wasn't just a job it was an adventure!",
  "I didn't like violence anyway!",
  'I thought you liked me?',
  "Such senseless violence!  I don't understand it.",
  "I think this guy's a little crazy.",
  "Somehow I don't feel like killing anymore.",
  "Hey!  Killin' ain't cool.",
  'Gee... thanks.',
  "I've fallen and I can't get up!",
  '911?',
  'Oh No!  Here I blow again!',
  "I'll be back...",
  "Hey - I've got lawyers.",
  'Time to call 1-888-SUE-TANK.',
  "It's all fun and games, until your mom gets pregnant.",
];

// Speech bubble state
export const bubble = {
  active: false,
  text: '',
  x: 0,
  y: 0,
  frames: 0,
  maxFrames: 90,  // ~1.5 seconds at 60fps
};

// Trigger attack speech when a player fires
// EXE show_attack_comment at 0x181A1: 1-in-100 chance a random other player
// delivers the taunt instead (forces TALKING_TANKS=1 for the special case)
export function triggerAttackSpeech(player) {
  // Special case: 1% random-player taunt (EXE: random(100)==2)
  if (player.alive && random(100) === 2 && players.length > 0) {
    const randomPlayer = players[random(players.length)];
    bubble.active = true;
    bubble.text = ATTACK_PHRASES[random(ATTACK_PHRASES.length)];
    bubble.x = randomPlayer.x;
    bubble.y = randomPlayer.y - 19;
    bubble.frames = 0;
    return;
  }

  // EXE play.cpp 0x30661: TALKING_TANKS>1 (All) → always show;
  // TALKING_TANKS==1 (Computers) → only if player[+0x22] != 0 (AI type)
  if (!config.talkingTanks) return;
  if (config.talkingTanks === 1 && player.aiType === 0) return;
  if (random(100) >= config.talkProbability) return;

  bubble.active = true;
  bubble.text = ATTACK_PHRASES[random(ATTACK_PHRASES.length)];
  bubble.x = player.x;
  bubble.y = player.y - 19;
  bubble.frames = 0;
}

// Trigger death speech when a player is killed
// EXE show_die_comment (0x18155): no Computers-vs-All guard at caller;
// display_talk_bubble checks TALKING_TANKS!=0 — death speech shows for all players
export function triggerDeathSpeech(player) {
  if (!config.talkingTanks) return;
  if (random(100) >= config.talkProbability) return;

  bubble.active = true;
  bubble.text = DEATH_PHRASES[random(DEATH_PHRASES.length)];
  bubble.x = player.x;
  bubble.y = player.y - 19;
  bubble.frames = 0;
}

// Step the speech bubble timer
export function stepSpeechBubble() {
  if (!bubble.active) return;
  bubble.frames++;
  if (bubble.frames >= bubble.maxFrames) {
    bubble.active = false;
  }
}

// Draw the speech bubble as an overlay
// EXE: display_talk_bubble at 0x182FD — draws bordered rectangle via draw_border (0x1826C)
// EXE draw_border: 4 edge lines in EF2C (deep shadow/black), interior fill in EF26 (white)
// EXE: text rendered in EF2C (black) at (si, tank.Y-19)
// EXE: box spans (si-3, tank.Y-20) to (si+textW+2, tank.Y-7) — 14px tall for 12px font
export function drawSpeechBubble() {
  if (!bubble.active) return;

  const text = bubble.text;
  const textWidth = measureText(text);

  // EXE: si = tank.X - textWidth/2 (center text on tank)
  // EXE: clamps X to screen bounds: left = EF42+5, right = EF3C - textWidth - 11
  const sw = config.screenWidth;
  let tx = Math.round(bubble.x - textWidth / 2);
  if (tx < 5) tx = 5;
  if (tx + textWidth > sw - 11) tx = sw - 11 - textWidth;

  // EXE: text Y = tank.Y - 19 (bubble.y is already set to player.y - 19)
  const ty = Math.max(1, bubble.y);

  // EXE draw_border: box from (tx-3, ty-1) to (tx+textW+2, ty+FONT_HEIGHT)
  const bx1 = tx - 3;
  const by1 = ty - 1;
  const bx2 = tx + textWidth + 2;
  const by2 = ty + FONT_HEIGHT;

  // Interior fill in EF26 = UI_DARK_BORDER (white, 63,63,63)
  fillRect(bx1 + 1, by1 + 1, bx2 - 1, by2 - 1, UI_DARK_BORDER);

  // 4 border edges in EF2C = UI_DEEP_SHADOW (black)
  // Left edge: vline(bx1, by1+1, by2-1)
  vline(bx1, by1 + 1, by2 - 1, UI_DEEP_SHADOW);
  // Right edge: vline(bx2, by1+1, by2-1)
  vline(bx2, by1 + 1, by2 - 1, UI_DEEP_SHADOW);
  // Top edge: hline(bx1+1, bx2-1, by1)
  hline(bx1 + 1, bx2 - 1, by1, UI_DEEP_SHADOW);
  // Bottom edge: hline(bx1+1, bx2-1, by2)
  hline(bx1 + 1, bx2 - 1, by2, UI_DEEP_SHADOW);

  // Text in EF2C = UI_DEEP_SHADOW (black)
  drawText(tx, ty, text, UI_DEEP_SHADOW);
}
