// Scorched Earth - Weapon Data Table (from RE: DS:0x11F6, stride 52 bytes)
// 57 weapons: indices 0-56, struct starts at index 2
// Behavior types: 0x0021=standard, 0x0002=tracer, 0x0003=roller, 0x0004=disrupter,
//   0x0006=bounce, 0x0009=dirt, 0x000A=tunnel, 0x000D=plasma, 0x0021=standard,
//   0x0081=liquid, 0x013E=dirt_charge, 0x01A0=napalm, 0x0239=mirv, 0x03BD=riot

// Behavior type constants
export const BHV = {
  NONE:        0x0000,
  TRACER:      0x0002,
  ROLLER:      0x0003,
  DISRUPTER:   0x0004,
  BOUNCE:      0x0006,
  DIRT:        0x0009,
  TUNNEL:      0x000A,
  PLASMA:      0x000D,
  STANDARD:    0x0021,
  LIQUID:      0x0081,
  DIRT_CHARGE: 0x013E,
  NAPALM:      0x01A0,
  MIRV:        0x0239,
  RIOT:        0x03BD,
};

// Weapon categories for shop UI
export const CATEGORY = {
  WEAPON: 0,
  GUIDANCE: 1,
  DEFENSE: 2,
  ACCESSORY: 3,
};

// Full weapon table from RE binary
// Fields: name, price, bundle, arms (level 0-4), bhv (behavior type), param (radius/bounces/etc),
//         category, ammoDefault (starting ammo, -1 = infinite for Baby Missile)
export const WEAPONS = [
  // idx 0-1: special items (no struct in binary)
  { name: 'Jump Jets',     price: 0,     bundle: 1,  arms: 0, bhv: BHV.NONE,     param: 0,   category: CATEGORY.ACCESSORY },
  { name: 'Popcorn Bomb',  price: 0,     bundle: 1,  arms: 0, bhv: BHV.NONE,     param: 0,   category: CATEGORY.WEAPON },

  // idx 2-5: standard projectiles
  { name: 'Baby Missile',  price: 400,   bundle: 10, arms: 0, bhv: BHV.STANDARD, param: 10,  category: CATEGORY.WEAPON },
  { name: 'Missile',       price: 1875,  bundle: 5,  arms: 0, bhv: BHV.STANDARD, param: 20,  category: CATEGORY.WEAPON },
  { name: 'Baby Nuke',     price: 10000, bundle: 3,  arms: 0, bhv: BHV.STANDARD, param: 40,  category: CATEGORY.WEAPON },
  { name: 'Nuke',          price: 12000, bundle: 1,  arms: 1, bhv: BHV.STANDARD, param: 75,  category: CATEGORY.WEAPON },

  // idx 6: bouncing
  { name: 'LeapFrog',      price: 10000, bundle: 2,  arms: 3, bhv: BHV.BOUNCE,   param: 3,   category: CATEGORY.WEAPON },

  // idx 7: scatter/funky
  { name: 'Funky Bomb',    price: 7000,  bundle: 2,  arms: 4, bhv: BHV.NONE,     param: 80,  category: CATEGORY.WEAPON },

  // idx 8-9: MIRV/splitting
  { name: 'MIRV',          price: 10000, bundle: 3,  arms: 2, bhv: BHV.MIRV,     param: 0,   category: CATEGORY.WEAPON },
  { name: "Death's Head",  price: 20000, bundle: 1,  arms: 4, bhv: BHV.MIRV,     param: 1,   category: CATEGORY.WEAPON },

  // idx 10-11: napalm/fire
  { name: 'Napalm',        price: 10000, bundle: 10, arms: 2, bhv: BHV.NAPALM,   param: 15,  category: CATEGORY.WEAPON },
  { name: 'Hot Napalm',    price: 20000, bundle: 2,  arms: 4, bhv: BHV.NAPALM,   param: 20,  category: CATEGORY.WEAPON },

  // idx 12-13: tracers
  { name: 'Tracer',        price: 10,    bundle: 20, arms: 0, bhv: BHV.TRACER,   param: 0,   category: CATEGORY.WEAPON },
  { name: 'Smoke Tracer',  price: 500,   bundle: 10, arms: 0, bhv: BHV.TRACER,   param: 1,   category: CATEGORY.WEAPON },

  // idx 14-16: rollers
  { name: 'Baby Roller',   price: 5000,  bundle: 10, arms: 2, bhv: BHV.ROLLER,   param: 10,  category: CATEGORY.WEAPON },
  { name: 'Roller',        price: 6000,  bundle: 5,  arms: 2, bhv: BHV.ROLLER,   param: 20,  category: CATEGORY.WEAPON },
  { name: 'Heavy Roller',  price: 6750,  bundle: 2,  arms: 3, bhv: BHV.ROLLER,   param: 45,  category: CATEGORY.WEAPON },

  // idx 17-18: plasma
  { name: 'Plasma Blast',  price: 2000,  bundle: 10, arms: 2, bhv: BHV.PLASMA,   param: 0,   category: CATEGORY.WEAPON },
  { name: 'Riot Charge',   price: 5000,  bundle: 5,  arms: 3, bhv: BHV.PLASMA,   param: 1,   category: CATEGORY.WEAPON },

  // idx 19-20: riot
  { name: 'Riot Blast',    price: 5000,  bundle: 5,  arms: 3, bhv: BHV.RIOT,     param: 30,  category: CATEGORY.WEAPON },
  { name: 'Riot Bomb',     price: 4750,  bundle: 2,  arms: 3, bhv: BHV.RIOT,     param: 45,  category: CATEGORY.WEAPON },

  // idx 21-26: tunneling (negative param = dig down, positive = dig up)
  { name: 'Heavy Riot Bomb', price: 3000, bundle: 10, arms: 0, bhv: BHV.TUNNEL, param: -10, category: CATEGORY.WEAPON },
  { name: 'Baby Digger',   price: 2500,  bundle: 5,  arms: 0, bhv: BHV.TUNNEL,   param: -20, category: CATEGORY.WEAPON },
  { name: 'Digger',        price: 6750,  bundle: 2,  arms: 1, bhv: BHV.TUNNEL,   param: -35, category: CATEGORY.WEAPON },
  { name: 'Heavy Digger',  price: 10000, bundle: 10, arms: 0, bhv: BHV.TUNNEL,   param: 10,  category: CATEGORY.WEAPON },
  { name: 'Baby Sandhog',  price: 16750, bundle: 5,  arms: 0, bhv: BHV.TUNNEL,   param: 20,  category: CATEGORY.WEAPON },
  { name: 'Sandhog',       price: 25000, bundle: 2,  arms: 1, bhv: BHV.TUNNEL,   param: 35,  category: CATEGORY.WEAPON },

  // idx 27-29: dirt adding
  { name: 'Heavy Sandhog', price: 5000,  bundle: 10, arms: 0, bhv: BHV.DIRT,     param: 20,  category: CATEGORY.WEAPON },
  { name: 'Dirt Clod',     price: 5000,  bundle: 5,  arms: 0, bhv: BHV.DIRT,     param: 35,  category: CATEGORY.WEAPON },
  { name: 'Dirt Ball',     price: 6750,  bundle: 2,  arms: 1, bhv: BHV.DIRT,     param: 70,  category: CATEGORY.WEAPON },

  // idx 30: liquid dirt (napalm variant with negative param)
  { name: 'Ton of Dirt',   price: 5000,  bundle: 5,  arms: 2, bhv: BHV.NAPALM,   param: -20, category: CATEGORY.WEAPON },

  // idx 31: liquid dirt variant
  { name: 'Liquid Dirt',   price: 5000,  bundle: 10, arms: 1, bhv: BHV.LIQUID,   param: 0,   category: CATEGORY.WEAPON },

  // idx 32: dirt charge
  { name: 'Dirt Charge',   price: 5000,  bundle: 10, arms: 0, bhv: BHV.DIRT_CHARGE, param: 0, category: CATEGORY.WEAPON },

  // idx 33: dirt tower (vertical dirt)
  { name: 'Dirt Tower',    price: 9000,  bundle: 5,  arms: 3, bhv: BHV.DIRT,     param: 0,   category: CATEGORY.WEAPON },

  // idx 34: earth disrupter
  { name: 'Earth Disrupter', price: 5000, bundle: 5, arms: 2, bhv: BHV.DISRUPTER, param: 0,  category: CATEGORY.WEAPON },

  // --- Accessories (idx 35+): no projectile behavior ---

  // idx 35-36: laser sights
  { name: 'Laser',         price: 10000, bundle: 6,  arms: 2, bhv: BHV.NONE,     param: 0,   category: CATEGORY.ACCESSORY },
  { name: 'Plasma Laser',  price: 10000, bundle: 2,  arms: 2, bhv: BHV.NONE,     param: 0,   category: CATEGORY.ACCESSORY },

  // idx 37-40: guidance systems
  { name: 'Heat Guidance', price: 15000, bundle: 5,  arms: 1, bhv: BHV.NONE,     param: 0,   category: CATEGORY.GUIDANCE },
  { name: 'Bal Guidance',  price: 20000, bundle: 5,  arms: 1, bhv: BHV.NONE,     param: 0,   category: CATEGORY.GUIDANCE },
  { name: 'Horz Guidance', price: 20000, bundle: 2,  arms: 3, bhv: BHV.NONE,     param: 0,   category: CATEGORY.GUIDANCE },
  { name: 'Vert Guidance', price: 10000, bundle: 8,  arms: 2, bhv: BHV.NONE,     param: 0,   category: CATEGORY.GUIDANCE },

  // idx 41-42: utility accessories
  { name: 'Lazy Boy',      price: 5000,  bundle: 10, arms: 2, bhv: BHV.NONE,     param: 0,   category: CATEGORY.ACCESSORY },
  { name: 'Parachute',     price: 10000, bundle: 2,  arms: 2, bhv: BHV.NONE,     param: 0,   category: CATEGORY.ACCESSORY },

  // idx 43-44: batteries
  { name: 'Battery',       price: 20000, bundle: 3,  arms: 3, bhv: BHV.NONE,     param: 0,   category: CATEGORY.DEFENSE },
  { name: 'Batteries:',    price: 25000, bundle: 3,  arms: 3, bhv: BHV.NONE,     param: 0,   category: CATEGORY.DEFENSE },

  // idx 45: mag deflector
  { name: 'Mag Deflector', price: 30000, bundle: 2,  arms: 4, bhv: BHV.NONE,     param: 0,   category: CATEGORY.DEFENSE },

  // idx 46-52: shields
  { name: 'Shield',        price: 40000, bundle: 2,  arms: 4, bhv: BHV.NONE,     param: 0,   category: CATEGORY.DEFENSE },
  { name: 'Warp Shield',   price: 1500,  bundle: 1,  arms: 3, bhv: BHV.NONE,     param: 0,   category: CATEGORY.DEFENSE },
  { name: 'Teleport Shield', price: 10000, bundle: 10, arms: 3, bhv: BHV.NONE,   param: 0,   category: CATEGORY.DEFENSE },
  { name: 'Flicker Shield', price: 1000,  bundle: 25, arms: 3, bhv: BHV.NONE,    param: 0,   category: CATEGORY.DEFENSE },
  { name: 'Force Shield',  price: 25000, bundle: 3,  arms: 4, bhv: BHV.NONE,     param: 0,   category: CATEGORY.DEFENSE },
  { name: 'Heavy Shield',  price: 30000, bundle: 2,  arms: 4, bhv: BHV.NONE,     param: 0,   category: CATEGORY.DEFENSE },
  { name: 'Super Mag',     price: 40000, bundle: 2,  arms: 4, bhv: BHV.NONE,     param: 0,   category: CATEGORY.DEFENSE },

  // idx 53-56: corrupted items (prices from manual)
  { name: 'Patriot Missiles', price: 0,  bundle: 1,  arms: 4, bhv: BHV.NONE,     param: 0,   category: CATEGORY.DEFENSE },
  { name: 'Auto Defense',  price: 1500,  bundle: 1,  arms: 2, bhv: BHV.NONE,     param: 0,   category: CATEGORY.DEFENSE },
  { name: 'Fuel Tank',     price: 10000, bundle: 10, arms: 2, bhv: BHV.NONE,     param: 0,   category: CATEGORY.ACCESSORY },
  { name: 'Contact Trigger', price: 1000, bundle: 25, arms: 1, bhv: BHV.NONE,    param: 0,   category: CATEGORY.DEFENSE },
];

// Index constants for commonly referenced weapons
export const WPN = {
  BABY_MISSILE: 2,
  MISSILE: 3,
  BABY_NUKE: 4,
  NUKE: 5,
  LEAPFROG: 6,
  FUNKY_BOMB: 7,
  MIRV: 8,
  DEATHS_HEAD: 9,
  NAPALM: 10,
  TRACER: 12,
  BABY_ROLLER: 14,
  DIRT_CLOD: 28,
  EARTH_DISRUPTER: 34,
  LASER: 35,
  PLASMA_LASER: 36,
  LAST_WEAPON: 34,   // last true projectile weapon
  FIRST_ACCESSORY: 35,
};

// Get list of weapons available at a given arms level
export function getAvailableWeapons(armsLevel) {
  return WEAPONS.filter((w, i) =>
    i >= 2 && i <= WPN.LAST_WEAPON && w.arms <= armsLevel
  );
}

// Create initial inventory for a player (Baby Missile = infinite)
export function createInventory() {
  const inv = new Array(WEAPONS.length).fill(0);
  inv[WPN.BABY_MISSILE] = -1;  // infinite ammo
  return inv;
}

// Get the next weapon with ammo in inventory, cycling forward
export function cycleWeapon(inventory, currentIdx, direction) {
  const start = currentIdx;
  let idx = currentIdx;
  do {
    idx += direction;
    if (idx > WPN.LAST_WEAPON) idx = 2;
    if (idx < 2) idx = WPN.LAST_WEAPON;
    if (inventory[idx] !== 0) return idx;
  } while (idx !== start);
  return currentIdx;
}
