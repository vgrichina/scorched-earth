import { random } from './utils.js';

// Native 0x2D844 draws once from the 67-entry DS:53AE table.
// Preserve the original spelling and order.
const COMPUTER_NAMES = [
  "Bob",
  "Joe",
  "Ralph",
  "Fred",
  "Max",
  "George",
  "Wolfgang",
  "Pepe",
  "Ronald",
  "Arnold",
  "Chuck",
  "Doug",
  "Edward",
  "Hank",
  "Jacque",
  "Lou",
  "Norm",
  "Otto",
  "Ted",
  "Ajax",
  "Sam",
  "Frank",
  "Bubba",
  "Biff",
  "Leroy",
  "Newton",
  "Galileo",
  "Bach",
  "Mozart",
  "Gilligan",
  "Saddam",
  "Atilla",
  "Tito",
  "Castro",
  "Khadafi",
  "Amin",
  "Cleopatra",
  "Mussolini",
  "Napolean",
  "Juan",
  "Barbarella",
  "Antoinette",
  "Helen",
  "Elizabeth",
  "Mary",
  "Diane",
  "Zoe",
  "Persephone",
  "Esther",
  "Rose",
  "Mata Hari",
  "Moria",
  "Bethsheba",
  "Jezebel",
  "Guineverre",
  "Godiva",
  "Medusa",
  "Elvira",
  "Roseanne",
  "Sonja",
  "Charo",
  "Cher",
  "Madonna",
  "Grace",
  "Bubbles",
  "Tiffany",
  "Angie"
];

export function randomComputerName() {
  return COMPUTER_NAMES[random(COMPUTER_NAMES.length)];
}

// Native 0x26DC2..0x26E10 resolves computer duplicates after every editor
// has finished. Earlier players see later names; human names are unchanged.
export function resolveDuplicateComputerNames(roster) {
  const fold = name => name.replace(/[a-z]/g, c => c.toUpperCase());
  for (const player of roster) {
    if (player.aiType <= 0) continue;
    while (roster.some(other => other !== player && fold(other.name) === fold(player.name))) {
      player.name = randomComputerName();
    }
  }
}
