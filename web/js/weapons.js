// Scorched Earth - Weapon Data Table
// EXE: weapon struct array at file 0x056F76 (DS:0x11F6), stride 52 bytes, 57 entries
// EXE: struct layout per weapon (52 bytes):
//   +00: far ptr to name string (4 bytes)
//   +04: price (uint16)        +06: bundle qty (uint16)
//   +08: arms level (uint16)   +0A: BhvType code (uint16)
//   +0C: BhvSub / handler segment (uint16) — far function pointer
//   +0E: blast radius / param (int16, negative = dig direction)
//   +10-33: runtime fields (zeroed in binary)
// EXE: weapon dispatch at file 0x1C6C8 via lcall [weapon_idx * 52 + DS:0x1200]
// EXE: behavior handler segments verified from struct data + relocations:
//   0x3D1E = standard projectile    0x25D5 = MIRV/Death's Head
//   0x2FBD = roller                 0x26E6 = napalm/fire
//   0x2F76 = plasma/riot/laser      0x2382 = LeapFrog
//   0x151B = digger/sandhog         0x15A0 = dirt adding
//   0x1DCE = Funky Bomb             0x0000 = accessories (NULL)
// EXE: accessory boundary at DS:E4F0 = 33 (file 0x1D5D4 equipInit)
// EXE: last weapon index at DS:D548 = 32 (Earth Disrupter)

// Behavior type constants — these are the BhvType codes stored at struct +0A
// EXE: verified from weapon struct bytes at file 0x056F76+ (see disasm/weapon_structs.txt)
// EXE: BhvType is the low word of the far function pointer at +0A:+0C
export const BHV = {
  NONE:        0x0000,  // EXE: NULL handler (0x0000:0x0000) — accessories, shields, Funky Bomb
  TRACER:      0x0002,  // EXE: handler seg 0x3D1E (file 0x43BE0), no explosion
  ROLLER:      0x0003,  // EXE: handler seg 0x2FBD (file 0x365D0), two-phase flight+terrain-follow
  DISRUPTER:   0x0004,  // EXE: handler seg 0x2319 (file 0x29190), force dirt fall
  BOUNCE:      0x0006,  // EXE: handler seg 0x2382 (file 0x2A220), velocity reflection
  DIRT:        0x0009,  // EXE: handler seg 0x15A0 (file 0x1C400), add terrain pixels
  TUNNEL:      0x000A,  // EXE: handler seg 0x151B (file 0x1BBB0), dig up/down
  PLASMA:      0x000D,  // EXE: handler seg 0x2F76 (file 0x3616D), variable radius beam
  STANDARD:    0x0021,  // EXE: handler seg 0x3D1E (file 0x43BE0), simple blast
  LIQUID:      0x0081,  // EXE: handler seg 0x15A0 (file 0x1C400), napalm-style dirt
  DIRT_CHARGE: 0x013E,  // EXE: handler seg 0x162C (file 0x1CAC0), explosion + dirt fill
  NAPALM:      0x01A0,  // EXE: handler seg 0x26E6 (file 0x2D860), 99-slot particle pool
  MIRV:        0x0239,  // EXE: handler seg 0x25D5 (file 0x2C750), apogee velocity sign flip
  RIOT:        0x03BD,  // EXE: handler seg 0x2F76 (file 0x3651D), earth-moving explosion
};

// Weapon categories for shop UI
export const CATEGORY = {
  WEAPON: 0,
  GUIDANCE: 1,
  DEFENSE: 2,
  ACCESSORY: 3,
};

// Full weapon table from RE binary
// EXE: 57 entries starting at file 0x056F76 (DS:0x11F6), 52 bytes each
// Fields: name, price, bundle, arms (level 0-4), bhv (behavior type), param (radius/bounces/etc),
//         category, ammoDefault (starting ammo, -1 = infinite for Baby Missile)
export const WEAPONS = [
  // idx 0-1: special items (no real struct in binary — precede weapon table)
  { name: 'Jump Jets',     price: 0,     bundle: 1,  arms: 0, bhv: BHV.NONE,     param: 0,   category: CATEGORY.ACCESSORY },
  { name: 'Popcorn Bomb',  price: 0,     bundle: 1,  arms: 0, bhv: BHV.NONE,     param: 0,   category: CATEGORY.WEAPON },

  // idx 2-5: standard projectiles — EXE: handler seg 0x3D1E (file 0x43BE0)
  // EXE struct: Baby Missile at 0x056F7C: [bundle=0A, arms=00, bhv=0021, seg=3D1E, param=0A]
  { name: 'Baby Missile',  price: 400,   bundle: 10, arms: 0, bhv: BHV.STANDARD, param: 10,  category: CATEGORY.WEAPON },
  // EXE struct: Missile at 0x056FB0: [bundle=05, arms=00, bhv=0021, seg=3D1E, param=14]
  { name: 'Missile',       price: 1875,  bundle: 5,  arms: 0, bhv: BHV.STANDARD, param: 20,  category: CATEGORY.WEAPON },
  // EXE struct: Baby Nuke at 0x056FE4: [bundle=03, arms=00, bhv=0021, seg=3D1E, param=28]
  { name: 'Baby Nuke',     price: 10000, bundle: 3,  arms: 0, bhv: BHV.STANDARD, param: 40,  category: CATEGORY.WEAPON },
  // EXE struct: Nuke at 0x057018: [bundle=01, arms=01, bhv=0021, seg=3D1E, param=4B]
  { name: 'Nuke',          price: 12000, bundle: 1,  arms: 1, bhv: BHV.STANDARD, param: 75,  category: CATEGORY.WEAPON },

  // idx 6: bouncing — EXE: handler seg 0x2382 (file 0x2A220)
  // EXE struct: LeapFrog at 0x05704C: [bundle=02, arms=03, bhv=0006, seg=2382, param=03]
  { name: 'LeapFrog',      price: 10000, bundle: 2,  arms: 3, bhv: BHV.BOUNCE,   param: 3,   category: CATEGORY.WEAPON },

  // idx 7: scatter/funky — EXE: handler seg 0x1DCE (file 0x246E0), 5-10 sub-bombs
  // EXE struct: Funky Bomb at 0x057080: [bundle=02, arms=04, bhv=0000, seg=1DCE, param=50]
  { name: 'Funky Bomb',    price: 7000,  bundle: 2,  arms: 4, bhv: BHV.NONE,     param: 80,  category: CATEGORY.WEAPON },

  // idx 8-9: MIRV/splitting — EXE: handler seg 0x25D5 (file 0x2C750), apogee vy sign flip
  // EXE struct: MIRV at 0x0570B4: [bundle=03, arms=02, bhv=0239, seg=25D5, param=00]
  { name: 'MIRV',          price: 10000, bundle: 3,  arms: 2, bhv: BHV.MIRV,     param: 0,   category: CATEGORY.WEAPON },
  // EXE struct: Death's Head at 0x0570E8: [bundle=01, arms=04, bhv=0239, seg=25D5, param=01]
  { name: "Death's Head",  price: 20000, bundle: 1,  arms: 4, bhv: BHV.MIRV,     param: 1,   category: CATEGORY.WEAPON },

  // idx 10-11: napalm/fire — EXE: handler seg 0x26E6 (file 0x2D860), 99-slot particle pool
  // EXE struct: Napalm at 0x05711C: [bundle=0A, arms=02, bhv=01A0, seg=26E6, param=0F]
  { name: 'Napalm',        price: 10000, bundle: 10, arms: 2, bhv: BHV.NAPALM,   param: 15,  category: CATEGORY.WEAPON },
  // EXE struct: Hot Napalm at 0x057150: [bundle=02, arms=04, bhv=01A0, seg=26E6, param=14]
  { name: 'Hot Napalm',    price: 20000, bundle: 2,  arms: 4, bhv: BHV.NAPALM,   param: 20,  category: CATEGORY.WEAPON },

  // idx 12-13: tracers — EXE: handler seg 0x3D1E (shared with standard), no explosion
  // EXE struct: Tracer at 0x057184: [bundle=14, arms=00, bhv=0002, seg=3D1E, param=00]
  { name: 'Tracer',        price: 10,    bundle: 20, arms: 0, bhv: BHV.TRACER,   param: 0,   category: CATEGORY.WEAPON },
  // EXE struct: Smoke Tracer at 0x0571B8: [bundle=0A, arms=00, bhv=0002, seg=3D1E, param=01]
  { name: 'Smoke Tracer',  price: 500,   bundle: 10, arms: 0, bhv: BHV.TRACER,   param: 1,   category: CATEGORY.WEAPON },

  // idx 14-16: rollers — EXE: handler seg 0x2FBD (file 0x365D0)
  //   on_impact at file 0x365D3 (seg 0x2FBD:0x0003), per_frame at file 0x3684B (0x2FBD:0x027B)
  // EXE struct: Baby Roller at 0x0571EC: [bundle=0A, arms=02, bhv=0003, seg=2FBD, param=0A]
  { name: 'Baby Roller',   price: 5000,  bundle: 10, arms: 2, bhv: BHV.ROLLER,   param: 10,  category: CATEGORY.WEAPON },
  // EXE struct: Roller at 0x057220: [bundle=05, arms=02, bhv=0003, seg=2FBD, param=14]
  { name: 'Roller',        price: 6000,  bundle: 5,  arms: 2, bhv: BHV.ROLLER,   param: 20,  category: CATEGORY.WEAPON },
  // EXE struct: Heavy Roller at 0x057254: [bundle=02, arms=03, bhv=0003, seg=2FBD, param=2D]
  { name: 'Heavy Roller',  price: 6750,  bundle: 2,  arms: 3, bhv: BHV.ROLLER,   param: 45,  category: CATEGORY.WEAPON },

  // idx 17-18: plasma — EXE: handler seg 0x2F76 (file 0x3616D, plasma_blast_handler)
  // EXE struct: Plasma Blast at 0x057288: [bundle=0A, arms=02, bhv=000D, seg=2F76, param=00]
  { name: 'Plasma Blast',  price: 2000,  bundle: 10, arms: 2, bhv: BHV.PLASMA,   param: 0,   category: CATEGORY.WEAPON },
  // EXE struct: Riot Charge at 0x0572BC: [bundle=05, arms=03, bhv=000D, seg=2F76, param=01]
  { name: 'Riot Charge',   price: 5000,  bundle: 5,  arms: 3, bhv: BHV.PLASMA,   param: 1,   category: CATEGORY.WEAPON },

  // idx 19-20: riot — EXE: handler seg 0x2F76 (file 0x3651D, riot_blast_handler)
  // EXE struct: Riot Blast at 0x0572F0: [bundle=05, arms=03, bhv=03BD, seg=2F76, param=1E]
  { name: 'Riot Blast',    price: 5000,  bundle: 5,  arms: 3, bhv: BHV.RIOT,     param: 30,  category: CATEGORY.WEAPON },
  // EXE struct: Riot Bomb at 0x057324: [bundle=02, arms=03, bhv=03BD, seg=2F76, param=2D]
  { name: 'Riot Bomb',     price: 4750,  bundle: 2,  arms: 3, bhv: BHV.RIOT,     param: 45,  category: CATEGORY.WEAPON },

  // idx 21-26: tunneling — EXE: handler seg 0x151B (file 0x1BBB0)
  //   negative param (+0E as signed int16) = dig down, positive = dig up
  // EXE struct: Heavy Riot Bomb at 0x057358: [bhv=000A, seg=151B, param=FFF6 (-10)]
  { name: 'Heavy Riot Bomb', price: 3000, bundle: 10, arms: 0, bhv: BHV.TUNNEL, param: -10, category: CATEGORY.WEAPON },
  // EXE struct: Baby Digger at 0x05738C: [bhv=000A, seg=151B, param=FFEC (-20)]
  { name: 'Baby Digger',   price: 2500,  bundle: 5,  arms: 0, bhv: BHV.TUNNEL,   param: -20, category: CATEGORY.WEAPON },
  // EXE struct: Digger at 0x0573C0: [bhv=000A, seg=151B, param=FFDD (-35)]
  { name: 'Digger',        price: 6750,  bundle: 2,  arms: 1, bhv: BHV.TUNNEL,   param: -35, category: CATEGORY.WEAPON },
  // EXE struct: Heavy Digger at 0x0573F4: [bhv=000A, seg=151B, param=0A (+10)]
  { name: 'Heavy Digger',  price: 10000, bundle: 10, arms: 0, bhv: BHV.TUNNEL,   param: 10,  category: CATEGORY.WEAPON },
  // EXE struct: Baby Sandhog at 0x057428: [bhv=000A, seg=151B, param=14 (+20)]
  { name: 'Baby Sandhog',  price: 16750, bundle: 5,  arms: 0, bhv: BHV.TUNNEL,   param: 20,  category: CATEGORY.WEAPON },
  // EXE struct: Sandhog at 0x05745C: [bhv=000A, seg=151B, param=23 (+35)]
  { name: 'Sandhog',       price: 25000, bundle: 2,  arms: 1, bhv: BHV.TUNNEL,   param: 35,  category: CATEGORY.WEAPON },

  // idx 27-29: dirt adding — EXE: handler seg 0x15A0 (file 0x1C400)
  { name: 'Heavy Sandhog', price: 5000,  bundle: 10, arms: 0, bhv: BHV.DIRT,     param: 20,  category: CATEGORY.WEAPON },
  { name: 'Dirt Clod',     price: 5000,  bundle: 5,  arms: 0, bhv: BHV.DIRT,     param: 35,  category: CATEGORY.WEAPON },
  { name: 'Dirt Ball',     price: 6750,  bundle: 2,  arms: 1, bhv: BHV.DIRT,     param: 70,  category: CATEGORY.WEAPON },

  // idx 30: Ton of Dirt — napalm variant with negative param (dirt particles)
  // EXE: uses napalm handler seg 0x26E6, param=-20 means isDirtParticle
  { name: 'Ton of Dirt',   price: 5000,  bundle: 5,  arms: 2, bhv: BHV.NAPALM,   param: -20, category: CATEGORY.WEAPON },

  // idx 31: liquid dirt variant — EXE: handler seg 0x15A0 (file 0x1C400)
  { name: 'Liquid Dirt',   price: 5000,  bundle: 10, arms: 1, bhv: BHV.LIQUID,   param: 0,   category: CATEGORY.WEAPON },

  // idx 32: dirt charge — EXE: handler seg 0x162C (file 0x1CAC0)
  { name: 'Dirt Charge',   price: 5000,  bundle: 10, arms: 0, bhv: BHV.DIRT_CHARGE, param: 0, category: CATEGORY.WEAPON },

  // idx 33: dirt tower (vertical dirt) — EXE: handler seg 0x2770 (file 0x2DF00)
  { name: 'Dirt Tower',    price: 9000,  bundle: 5,  arms: 3, bhv: BHV.DIRT,     param: 0,   category: CATEGORY.WEAPON },

  // idx 34: earth disrupter — EXE: handler seg 0x2319 (file 0x29190)
  // EXE: DS:D548 = 32 = last weapon index (this is struct index 32, weapon index 34)
  { name: 'Earth Disrupter', price: 5000, bundle: 5, arms: 2, bhv: BHV.DISRUPTER, param: 0,  category: CATEGORY.WEAPON },

  // --- Accessories (idx 35+): no projectile behavior, handler = NULL (0x0000:0x0000) ---
  // EXE: DS:E4F0 = 33 = first accessory index (set in equipInit at file 0x1D5D4)

  // idx 35-36: laser sights — EXE: NOT fireable weapons; provide visual targeting lines
  // EXE: draw_laser_sight function at file 0x36321 (seg 0x2F76:0x01C1)
  // EXE: Laser struct at DS:0x18AA (file 0x5762A): bhv=0000, seg=0000 (NULL)
  //   color=0x78 (green), erase_mask=0xFE, 6 uses/buy, arms=2
  // EXE: Plasma Laser struct at DS:0x18DE (file 0x5765E): bhv=0000, seg=0000 (NULL)
  //   color=0xFE (white), erase_mask=-1 (overwrites all), 2 uses/buy, arms=2
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
// EXE: weapon cycling (file 0x30910) wraps at DS:E4F0 (=33) for last weapon
// EXE: DS:D548 = 32 (Earth Disrupter = last fireable weapon struct index)
export const WPN = {
  BABY_MISSILE: 2,        // EXE struct at file 0x056F7C
  MISSILE: 3,             // EXE struct at file 0x056FB0
  BABY_NUKE: 4,           // EXE struct at file 0x056FE4
  NUKE: 5,                // EXE struct at file 0x057018
  LEAPFROG: 6,            // EXE struct at file 0x05704C
  FUNKY_BOMB: 7,          // EXE struct at file 0x057080
  MIRV: 8,                // EXE struct at file 0x0570B4
  DEATHS_HEAD: 9,         // EXE struct at file 0x0570E8
  NAPALM: 10,             // EXE struct at file 0x05711C
  TRACER: 12,             // EXE struct at file 0x057184
  BABY_ROLLER: 14,        // EXE struct at file 0x0571EC
  DIRT_CLOD: 28,
  EARTH_DISRUPTER: 34,    // EXE: last weapon (DS:D548)
  LASER: 35,              // EXE: first accessory (DS:E4F0), struct at DS:0x18AA
  PLASMA_LASER: 36,       // EXE: struct at DS:0x18DE
  LAST_WEAPON: 34,        // EXE: DS:D548 boundary
  FIRST_ACCESSORY: 35,    // EXE: DS:E4F0 boundary (set in equipInit at file 0x1D5D4)
};

// Get list of weapons available at a given arms level
// EXE: arms level check at struct +08, gated in shop (equip.cpp, file 0x16BC0+)
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
// EXE: weapon_cycle at file 0x30910 — wraps at DS:E4F0 (accessory boundary)
// EXE VERIFIED: wrapping at LAST_WEAPON (34) matches EXE DS:E4F0 boundary.
// EXE: accessories (laser, guidance, shields) cannot be selected via cycling.
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
