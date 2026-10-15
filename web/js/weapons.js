// Scorched Earth v1.50 weapon records: 48 entries, DS:11F6, file 0x56F76,
// stride 52. Names come from the initialized far pointers in the emulator.
// Web indices reserve two legacy internal slots; EXE index = web index - 2.
// bhv is the handler offset, NOT a unique behavior ID: Plasma Blast and dirt
// share offset 9 but have different segments. Gameplay dispatch still needs
// a full far-pointer audit; handlerSegment preserves that distinction here.
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

// Slots 0-1 are internal; they are not purchasable EXE records.
export const WEAPONS = [
  { name: 'Jump Jets', price: 0, bundle: 1, arms: 0, bhv: 0, param: 0, category: CATEGORY.ACCESSORY },
  { name: 'Popcorn Bomb', price: 0, bundle: 1, arms: 0, bhv: 0, param: 0, category: CATEGORY.WEAPON },
  { name: "Baby Missile", price: 400, bundle: 10, arms: 0, bhv: 0x0021, handlerSegment: 0x3d1e, param: 10, category: CATEGORY.WEAPON },
  { name: "Missile", price: 1875, bundle: 5, arms: 0, bhv: 0x0021, handlerSegment: 0x3d1e, param: 20, category: CATEGORY.WEAPON },
  { name: "Baby Nuke", price: 10000, bundle: 3, arms: 0, bhv: 0x0021, handlerSegment: 0x3d1e, param: 40, category: CATEGORY.WEAPON },
  { name: "Nuke", price: 12000, bundle: 1, arms: 1, bhv: 0x0021, handlerSegment: 0x3d1e, param: 75, category: CATEGORY.WEAPON },
  { name: "LeapFrog", price: 10000, bundle: 2, arms: 3, bhv: 0x0006, handlerSegment: 0x2382, param: 3, category: CATEGORY.WEAPON },
  { name: "Funky Bomb", price: 7000, bundle: 2, arms: 4, bhv: 0x0000, handlerSegment: 0x1dce, param: 80, category: CATEGORY.WEAPON },
  { name: "MIRV", price: 10000, bundle: 3, arms: 2, bhv: 0x0239, handlerSegment: 0x25d5, param: 0, category: CATEGORY.WEAPON },
  { name: "Death's Head", price: 20000, bundle: 1, arms: 4, bhv: 0x0239, handlerSegment: 0x25d5, param: 1, category: CATEGORY.WEAPON },
  { name: "Napalm", price: 10000, bundle: 10, arms: 2, bhv: 0x01a0, handlerSegment: 0x26e6, param: 15, category: CATEGORY.WEAPON },
  { name: "Hot Napalm", price: 20000, bundle: 2, arms: 4, bhv: 0x01a0, handlerSegment: 0x26e6, param: 20, category: CATEGORY.WEAPON },
  { name: "Tracer", price: 10, bundle: 20, arms: 0, bhv: 0x0002, handlerSegment: 0x3d1e, param: 0, category: CATEGORY.WEAPON },
  { name: "Smoke Tracer", price: 500, bundle: 10, arms: 0, bhv: 0x0002, handlerSegment: 0x3d1e, param: 1, category: CATEGORY.WEAPON },
  { name: "Baby Roller", price: 5000, bundle: 10, arms: 2, bhv: 0x0003, handlerSegment: 0x2fbd, param: 10, category: CATEGORY.WEAPON },
  { name: "Roller", price: 6000, bundle: 5, arms: 2, bhv: 0x0003, handlerSegment: 0x2fbd, param: 20, category: CATEGORY.WEAPON },
  { name: "Heavy Roller", price: 6750, bundle: 2, arms: 3, bhv: 0x0003, handlerSegment: 0x2fbd, param: 45, category: CATEGORY.WEAPON },
  { name: "Riot Charge", price: 2000, bundle: 10, arms: 2, bhv: 0x000d, handlerSegment: 0x2f76, param: 0, category: CATEGORY.WEAPON },
  { name: "Riot Blast", price: 5000, bundle: 5, arms: 3, bhv: 0x000d, handlerSegment: 0x2f76, param: 1, category: CATEGORY.WEAPON },
  { name: "Riot Bomb", price: 5000, bundle: 5, arms: 3, bhv: 0x03bd, handlerSegment: 0x2f76, param: 30, category: CATEGORY.WEAPON },
  { name: "Heavy Riot Bomb", price: 4750, bundle: 2, arms: 3, bhv: 0x03bd, handlerSegment: 0x2f76, param: 45, category: CATEGORY.WEAPON },
  { name: "Baby Digger", price: 3000, bundle: 10, arms: 0, bhv: 0x000a, handlerSegment: 0x151b, param: -10, category: CATEGORY.WEAPON },
  { name: "Digger", price: 2500, bundle: 5, arms: 0, bhv: 0x000a, handlerSegment: 0x151b, param: -20, category: CATEGORY.WEAPON },
  { name: "Heavy Digger", price: 6750, bundle: 2, arms: 1, bhv: 0x000a, handlerSegment: 0x151b, param: -35, category: CATEGORY.WEAPON },
  { name: "Baby Sandhog", price: 10000, bundle: 10, arms: 0, bhv: 0x000a, handlerSegment: 0x151b, param: 10, category: CATEGORY.WEAPON },
  { name: "Sandhog", price: 16750, bundle: 5, arms: 0, bhv: 0x000a, handlerSegment: 0x151b, param: 20, category: CATEGORY.WEAPON },
  { name: "Heavy Sandhog", price: 25000, bundle: 2, arms: 1, bhv: 0x000a, handlerSegment: 0x151b, param: 35, category: CATEGORY.WEAPON },
  { name: "Dirt Clod", price: 5000, bundle: 10, arms: 0, bhv: 0x0009, handlerSegment: 0x15a0, param: 20, category: CATEGORY.WEAPON },
  { name: "Dirt Ball", price: 5000, bundle: 5, arms: 0, bhv: 0x0009, handlerSegment: 0x15a0, param: 35, category: CATEGORY.WEAPON },
  { name: "Ton of Dirt", price: 6750, bundle: 2, arms: 1, bhv: 0x0009, handlerSegment: 0x15a0, param: 70, category: CATEGORY.WEAPON },
  { name: "Liquid Dirt", price: 5000, bundle: 5, arms: 2, bhv: 0x01a0, handlerSegment: 0x26e6, param: -20, category: CATEGORY.WEAPON },
  { name: "Dirt Charge", price: 5000, bundle: 10, arms: 1, bhv: 0x0081, handlerSegment: 0x15a0, param: 0, category: CATEGORY.WEAPON },
  { name: "Earth Disrupter", price: 5000, bundle: 10, arms: 0, bhv: 0x013e, handlerSegment: 0x162c, param: 0, category: CATEGORY.WEAPON },
  { name: "Plasma Blast", price: 9000, bundle: 5, arms: 3, bhv: 0x0009, handlerSegment: 0x2770, param: 0, category: CATEGORY.WEAPON },
  { name: "Laser", price: 5000, bundle: 5, arms: 2, bhv: 0x0004, handlerSegment: 0x2319, param: 0, category: CATEGORY.WEAPON },
  { name: "Heat Guidance", price: 10000, bundle: 6, arms: 2, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.GUIDANCE },
  { name: "Bal Guidance", price: 10000, bundle: 2, arms: 2, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.GUIDANCE },
  { name: "Horz Guidance", price: 15000, bundle: 5, arms: 1, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.GUIDANCE },
  { name: "Vert Guidance", price: 20000, bundle: 5, arms: 1, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.GUIDANCE },
  { name: "Lazy Boy", price: 20000, bundle: 2, arms: 3, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.ACCESSORY },
  { name: "Parachute", price: 10000, bundle: 8, arms: 2, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.ACCESSORY },
  { name: "Battery", price: 5000, bundle: 10, arms: 2, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.ACCESSORY },
  { name: "Mag Deflector", price: 10000, bundle: 2, arms: 2, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.DEFENSE },
  { name: "Shield", price: 20000, bundle: 3, arms: 3, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.DEFENSE },
  { name: "Force Shield", price: 25000, bundle: 3, arms: 3, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.DEFENSE },
  { name: "Heavy Shield", price: 30000, bundle: 2, arms: 4, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.DEFENSE },
  { name: "Super Mag", price: 40000, bundle: 2, arms: 4, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.DEFENSE },
  { name: "Auto Defense", price: 1500, bundle: 1, arms: 3, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.DEFENSE },
  { name: "Fuel Tank", price: 10000, bundle: 10, arms: 3, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.ACCESSORY },
  { name: "Contact Trigger", price: 1000, bundle: 25, arms: 3, bhv: 0x0000, handlerSegment: 0x0000, param: 0, category: CATEGORY.DEFENSE },
];

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
  HOT_NAPALM: 11,
  TRACER: 12,
  SMOKE_TRACER: 13,
  BABY_ROLLER: 14,
  ROLLER: 15,
  HEAVY_ROLLER: 16,
  RIOT_CHARGE: 17,
  RIOT_BLAST: 18,
  RIOT_BOMB: 19,
  HEAVY_RIOT_BOMB: 20,
  BABY_DIGGER: 21,
  DIGGER: 22,
  HEAVY_DIGGER: 23,
  BABY_SANDHOG: 24,
  SANDHOG: 25,
  HEAVY_SANDHOG: 26,
  DIRT_CLOD: 27,
  DIRT_BALL: 28,
  TON_OF_DIRT: 29,
  LIQUID_DIRT: 30,
  DIRT_CHARGE: 31,
  EARTH_DISRUPTER: 32,
  PLASMA_BLAST: 33,
  LASER: 34,
  HEAT_GUIDANCE: 35,
  BAL_GUIDANCE: 36,
  HORZ_GUIDANCE: 37,
  VERT_GUIDANCE: 38,
  LAZY_BOY: 39,
  PARACHUTE: 40,
  BATTERY: 41,
  MAG_DEFLECTOR: 42,
  SHIELD: 43,
  FORCE_SHIELD: 44,
  HEAVY_SHIELD: 45,
  SUPER_MAG: 46,
  AUTO_DEFENSE: 47,
  FUEL_TANK: 48,
  CONTACT_TRIGGER: 49,
  LAST_WEAPON: 34,
  FIRST_ACCESSORY: 35,
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
  inv[WPN.BABY_MISSILE] = 99;  // Native quantity; firing never decrements Baby Missiles.
  return inv;
}

// Get the next weapon with ammo in inventory, cycling forward
// EXE: weapon_cycle at file 0x30910 — wraps at DS:E4F0 (accessory boundary)
// EXE VERIFIED: wrapping at LAST_WEAPON (34) matches EXE DS:E4F0 boundary.
// EXE: accessories (guidance, shields) cannot be selected via cycling.
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
