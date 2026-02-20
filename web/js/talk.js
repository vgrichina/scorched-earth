// Scorched Earth - Talking Tanks System
// EXE source: comments.cpp — speech bubble display on fire/death events
// EXE: attack phrases from TALK1.CFG (54 entries)
// EXE: death phrases from TALK2.CFG (61 entries)
// EXE: pre-fire handler at 0x30668 loads string from DS:0xCC8E

import { config } from './config.js';
import { drawText } from './font.js';
import { fillRect } from './framebuffer.js';
import { random } from './utils.js';

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
export function triggerAttackSpeech(player) {
  if (!config.talkingTanks) return;
  if (random(100) >= config.talkProbability) return;

  bubble.active = true;
  bubble.text = ATTACK_PHRASES[random(ATTACK_PHRASES.length)];
  bubble.x = player.x;
  bubble.y = player.y - 20;
  bubble.frames = 0;
}

// Trigger death speech when a player is killed
export function triggerDeathSpeech(player) {
  if (!config.talkingTanks) return;

  bubble.active = true;
  bubble.text = DEATH_PHRASES[random(DEATH_PHRASES.length)];
  bubble.x = player.x;
  bubble.y = player.y - 20;
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
export function drawSpeechBubble() {
  if (!bubble.active) return;

  // Truncate long text to fit on screen
  const maxChars = 35;
  const text = bubble.text.length > maxChars ? bubble.text.substring(0, maxChars) + '..' : bubble.text;
  const textWidth = text.length * 8;

  // Position bubble above tank, clamped to screen
  let bx = Math.max(2, Math.min(318 - textWidth - 4, bubble.x - textWidth / 2));
  let by = Math.max(16, bubble.y - 8);

  // Background box
  fillRect(bx - 1, by - 1, bx + textWidth + 2, by + 9, 0);
  fillRect(bx, by, bx + textWidth + 1, by + 8, 199);

  // Text
  drawText(bx + 1, by + 1, text, 0);
}
