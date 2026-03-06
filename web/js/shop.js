// Scorched Earth - Shop System
// EXE source: equip.cpp (seg 0x16BC, file base 0x1D5C0)
//
// EXE functions:
//   equipInit()        — file 0x1D5D4 (16BC:0014) — map 16 category boundaries via findWeaponByName()
//   shopScreen()       — file 0x1DBB5 (171B:0005) — AI auto-buy dispatch (12-case jump table)
//   shopDialogBuild()  — file 0x15AF6 (0F0B:0046) — human player shop dialog construction
//   paint callback     — file 0x1580D (0DBC:124D) — player-colored selection highlight
//   palette tick       — file 0x14E34 (0DBC:0874) — animated UI accent palette cycling
//   item click handler — file 0x1503B (0DBC:0A7B) — buy/sell on item row click
//   tab dispatch       — file 0x152E9 (0DBC:0D29) — tab buttons + player prev/next
//   cash display       — file 0x16A7C (1000:007C) — "Cash Left:" and "Earned interest"
//
// EXE layout:
//   Uses full dialog system (seg 0x3F19) with 3D beveled boxes, scrollable lists, tab buttons.
//   Dialog created via dialog_alloc(screenW, screenH, 0, 0) — full screen modal.
//   Three callbacks: paint (0DBC:124D), tick (0DBC:18F2), palette anim (0DBC:0874).
//   Left item panel: 200px wide (0xC8), 14-15 visible rows.
//   Resolution check: if screenH >= 0x190 (400px), adds 5px extra spacing.
//
// EXE tabs (bottom of screen, NOT the web port's 4 categories):
//   "Score"         — DS:0x226C → DS:0x2C3B (file 0x589BB) — player scores
//   "Weapons"       — DS:0x2270 → DS:0x2C41 (file 0x589C1) — projectile weapons
//   "Miscellaneous" — DS:0x2274 → DS:0x2C49 (file 0x589C9) — accessories/shields/guidance
//   "~Done"         — DS:0x2278 → DS:0x2C57 (file 0x589D7) — exit shop
//
// EXE Miscellaneous sub-categories:
//   "~Parachutes" DS:0x2E5B, "~Triggers" DS:0x2E67, "~Guidance" DS:0x2E71,
//   "Shields" DS:0x2EFE, "~Inventory" DS:0x2EEF
//
// EXE sell dialog strings:
//   "Sell Equipment" DS:0x2EB0, "Description" DS:0x2E7B, "Amount in stock" DS:0x2E87,
//   "~Quantity to sell:" DS:0x2E97, "Offer" DS:0x2EAA,
//   "~Accept" DS:0x2EBF, "~Reject" DS:0x2EC7
//
// EXE other strings:
//   "Cash Left:"          — DS:0x22F8 (file 0x58B5D)
//   "Earned interest"     — DS:0x235C (file 0x58C5F)
//   "NO KIBITZING!!"      — DS:0x231C (file 0x58BAA) — anti-peek for hotseat
//   "Preparing Next Level..." — DS:0x2314 (file 0x58B8E)
//
// EXE category boundaries (set by equipInit via findWeaponByName):
//   DS:0xD546 = first purchasable weapon (Smoke Tracer)
//   DS:0xD548 = last free weapon (D546-1)
//   DS:0xD54A = Heat Guidance (start of guidance items)
//   DS:0xD552 = Lazy Boy (start of accessories)
//   DS:0xD554 = Parachute, DS:0xD556 = Battery, DS:0xD558 = Mag Deflector
//
// EXE colors:
//   DS:0xEF22 = bright highlight (selected items, weapon names)
//   DS:0xEF24 = dark text (depleted/unselected, ammo==0 check at file 0x30452)
//   DS:0xEF28 = background fill
//   Player color: player_struct+0x1A, selection highlight = player_color+4 (lighter shade)
//
// EXE palette animation (palette tick at file 0x14E34, DS:0x00EC counter):
//   Three effects: (1) VGA 2 pulsing red/orange triangle wave (100-frame period),
//   (2) VGA 8-11 accent cycling entries 1-4 every 8 frames (4-step rotation),
//   (3) VGA 14-18 gray gradient cycling every 2 frames (5 levels: 0,15,30,45,60)
//
// NOTE: Web port uses simplified flat categories vs EXE's tabbed dialog system.
// The EXE shop is significantly more complex (dialog widgets, scrollbar, sell sub-dialog,
// palette animation, per-player name switching, "NO KIBITZING!!" privacy guard).

import { config } from './config.js';
import { fillRect, hline, vline, setPixel, drawBox3DRaised, drawBox3DSunken } from './framebuffer.js';
import { drawText, drawTextShadow, measureText } from './font.js';
import { BLACK, saveAccentPalette, restoreAccentPalette, tickAccentPalette } from './palette.js';
import { WEAPONS, WPN, CATEGORY } from './weapons.js';
import { consumeKey, consumeClick, isKeyDown, mouse } from './input.js';
import { random } from './utils.js';
import { isAI } from './ai.js';
import { SHIELD_TYPE, activateShield } from './shields.js';
import { players } from './tank.js';
import { getLeaderboard } from './score.js';
import { COLOR_HUD_TEXT, COLOR_HUD_HIGHLIGHT,
         PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL,
         UI_HIGHLIGHT, UI_DARK_TEXT, UI_DARK_BORDER, UI_BACKGROUND,
         UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER } from './constants.js';

// === Dynamic Market Pricing (EXE: SCORCH.MKT, mkt_update at file 0x2BB5E) ===
// EXE constants: DS:0x5260=alpha(0.7), DS:0x5190=sensitivity(0.05), DS:0x5298=signal_div(10.0)
// DS:0x5268=MKT_INIT(0.1) — default EMA value and minimum price ratio
const MKT_ALPHA        = 0.7;
const MKT_SENSITIVITY  = 0.05;
const MKT_SIGNAL_DIV   = 10.0;
const MKT_INIT         = 0.1;

// Per-weapon market state (mirrors EXE weapon struct fields +0x1A..+0x2C)
// Indexed by weapon index (same as WEAPONS array)
const market = [];

// Initialize market state for all weapons (EXE: mkt_init_defaults at file 0x2B80A)
export function initMarket() {
  market.length = 0;
  for (let i = 0; i < WEAPONS.length; i++) {
    market.push({
      mktCost: WEAPONS[i].price,        // +0x1A: current market price (starts at base)
      soldQty: 0,                        // +0x1E: units sold this round
      unsoldRounds: 0,                   // +0x22: consecutive rounds with zero sales
      priceSignal: MKT_INIT,             // +0x24: EMA of squared price ratio
      demandAvg: MKT_INIT,              // +0x2C: EMA of normalized sales rate
    });
  }
}

// Get effective price for a weapon (mkt_cost when free market enabled, base price otherwise)
export function getWeaponPrice(weaponIdx) {
  if (config.freeMarket && market[weaponIdx]) {
    return market[weaponIdx].mktCost;
  }
  return WEAPONS[weaponIdx].price;
}

// Track a purchase (EXE: inc [bx+0x1214] at file 0x14A2A)
function trackPurchase(weaponIdx) {
  if (market[weaponIdx]) {
    market[weaponIdx].soldQty++;
  }
}

// EXE buy logic (buy_weapon at file 0x14924):
// 1. If qty >= 99 → reject  2. If can't afford → reject
// 3. Deduct price, add bundle  4. If qty > 99 → clip to 99, refund excess
const MAX_WEAPON_QTY = 99; // EXE: 0x63
function buyWeapon(player, weaponIdx) {
  if (player.inventory[weaponIdx] >= MAX_WEAPON_QTY) return false;
  const price = getWeaponPrice(weaponIdx);
  if (player.cash < price) return false;
  const bundle = WEAPONS[weaponIdx].bundle;
  player.cash -= price;
  player.inventory[weaponIdx] += bundle;
  trackPurchase(weaponIdx);
  // EXE overflow refund (0x14A83): if qty > 99, refund excess proportionally
  if (player.inventory[weaponIdx] > MAX_WEAPON_QTY) {
    const excess = player.inventory[weaponIdx] - MAX_WEAPON_QTY;
    player.inventory[weaponIdx] = MAX_WEAPON_QTY;
    player.cash += Math.floor(excess * price / bundle);
  }
  return true;
}

// Per-round market update (EXE: mkt_update at file 0x2BB5E)
// Called at end of each round when FREE_MARKET is enabled
export function mktUpdate() {
  if (!config.freeMarket) return;
  const numPlayers = players.length;
  for (let i = 0; i < WEAPONS.length; i++) {
    const m = market[i];
    if (!m || WEAPONS[i].price === 0) continue;  // skip non-purchasable (price=0)

    // Track unsold duration
    if (m.soldQty === 0) {
      m.unsoldRounds++;
    } else {
      m.unsoldRounds = 0;
    }

    // Update demand EMA (normalized by player count)
    m.demandAvg = m.demandAvg * MKT_ALPHA
      + m.soldQty * (1 - MKT_ALPHA) / numPlayers;

    // Update price signal EMA (tracks squared price ratio)
    const priceRatio = m.mktCost / WEAPONS[i].price;
    const signalUpdate = priceRatio * priceRatio * (1 - MKT_ALPHA) / MKT_SIGNAL_DIV;
    m.priceSignal = m.priceSignal * MKT_ALPHA + signalUpdate;

    // Adjust market price
    const factor = 1.0 + (m.demandAvg - m.priceSignal) * MKT_SENSITIVITY;
    m.mktCost = Math.trunc(m.mktCost * factor);

    // Clamp to [base×0.1, base×100] (EXE: validation on load)
    const basePrice = WEAPONS[i].price;
    const minPrice = Math.max(1, Math.trunc(basePrice * 0.1));
    const maxPrice = basePrice * 100;
    if (m.mktCost < minPrice) m.mktCost = minPrice;
    if (m.mktCost > maxPrice) m.mktCost = maxPrice;

    // Reset per-round purchase counter
    m.soldQty = 0;
  }
}

// EXE tab indices: "Score" (0), "Weapons" (1), "Miscellaneous" (2)
// EXE tab strings at DS:0x2C3B/0x2C41/0x2C49 (Score/Weapons/Miscellaneous)
const TAB_SCORE   = 0;
const TAB_WEAPONS = 1;
const TAB_MISC    = 2;
const TAB_NAMES   = ['Score', 'Weapons', 'Miscellaneous'];
const NUM_TABS    = 3;

// Shop state
const shop = {
  active: false,
  playerIdx: 0,
  category: TAB_WEAPONS, // default to Weapons tab (Score is view-only)
  selectedItem: 0,
  scrollOffset: 0,
  items: [],
  kibitz: false,      // EXE: "NO KIBITZING!!" anti-peek screen between hotseat players
  selling: false,     // EXE: "Sell Equipment" sub-dialog active
  sellQty: 1,         // EXE: "~Quantity to sell:" field value
  frame: 0,           // frame counter for palette animation
  scrollDrag: false,  // scrollbar thumb drag state
  scrollDragY: 0,     // mouse Y at drag start
  scrollDragOff: 0,   // scroll offset at drag start
  roundsLeft: 10,     // rounds remaining (set on openShop)
};

// Layout constants (EXE: left panel = 200px / 0xC8)
const PANEL_W_MAX = 200;
const PANEL_X = 4;
const PANEL_Y = 30;    // below header (icon row + cash bar row)
// Scrollbar: EXE dialog system (seg 0x3F19) — sunken track, raised thumb, arrow buttons
const SB_W    = 12;   // scrollbar width (EXE: ~14px at 640, scaled proportionally)

// EXE: right-side buttons at X=0xFA=250 (shopDialogBuild at file 0x15AF6)
// Scaled proportionally for other resolutions
function getRightBtnX() { return Math.floor(config.screenWidth * 250 / 320); }
function getRightBtnW() { return config.screenWidth - getRightBtnX() - 6; }
// EXE: resolution check at file 0x15D37: cmp [FG_MAXY], 0x190 → di=0 or 5
function getExtraSpacing() { return config.screenHeight >= 400 ? 5 : 0; }

// EXE: constant 20px row stride (file 0x16219, no hi-res variation)
function getRowH() { return 20; }

// Items visible per page: EXE formula: stride=20, loop exits at FG_MAXY-20
function getItemsPerPage() {
  const listY = PANEL_Y + 16;
  const bottom = config.screenHeight - 20;
  return Math.min(44, Math.max(1, Math.floor((bottom - listY) / 20)));
}

// Open shop for a player
// EXE: called from between-rounds loop at file 0x232E5 (play.cpp)
// EXE: checks player.cash > 0 (32-bit compare at player+0xA2/+0xA4) before opening
export function openShop(playerIdx, roundsLeft) {
  shop.active = true;
  shop.playerIdx = playerIdx;
  shop.category = TAB_WEAPONS;
  shop.selectedItem = 0;
  shop.scrollOffset = 0;
  shop.selling = false;
  shop.sellQty = 1;
  shop.frame = 0;
  shop.roundsLeft = roundsLeft || 10;
  // EXE: "NO KIBITZING!!" shown before each non-first human player's shop (DS:0x231C)
  shop.kibitz = playerIdx > 0 && !isAI(players[playerIdx]);
  // EXE: palette tick saves and animates palette entries 8-11 during shop
  saveAccentPalette();
  updateItemList();
}

export function closeShop() {
  shop.active = false;
  // EXE: restore player-1 palette entries 8-11 after shop animation
  restoreAccentPalette();
}

export function isShopActive() {
  return shop.active;
}

// EXE Miscellaneous sub-category groups (DS:0x2E5B, 0x2E67, 0x2E71, 0x2EFE, 0x2EEF)
// Each group has a header string and set of weapon indices.
// Items are displayed grouped by sub-category with non-selectable header rows.
const MISC_GROUPS = [
  { header: '~Guidance',   indices: [37, 38, 39, 40] },                   // Heat, Bal, Horz, Vert Guidance
  { header: '~Parachutes', indices: [41, 42] },                           // Lazy Boy, Parachute
  { header: '~Triggers',   indices: [56] },                               // Contact Trigger
  { header: 'Shields',     indices: [46, 47, 48, 49, 50, 51, 52] },      // Shield through Super Mag
  { header: '~Inventory',  indices: [35, 36, 43, 44, 45, 53, 54, 55] },  // Laser, Battery, Fuel Tank, etc.
];

// Update filtered item list based on current tab
// EXE: Score tab = view-only (no items); Weapons tab = CATEGORY.WEAPON only;
//      Miscellaneous = Guidance + Defense + Accessories (everything else)
// EXE: arms level gating via weapon_struct+0x08 <= config.armsLevel
// EXE: category boundaries set by equipInit() at file 0x1D5D4 via findWeaponByName()
function updateItemList() {
  shop.items = [];
  if (shop.category === TAB_SCORE) return; // Score tab is view-only

  if (shop.category === TAB_MISC) {
    // EXE: Misc tab groups items under 5 sub-category headers with hline separators
    for (const group of MISC_GROUPS) {
      const groupItems = [];
      for (const idx of group.indices) {
        const w = WEAPONS[idx];
        if (w && w.arms <= config.armsLevel) {
          groupItems.push({ idx, weapon: w });
        }
      }
      if (groupItems.length > 0) {
        shop.items.push({ isHeader: true, header: group.header });
        for (const item of groupItems) {
          shop.items.push(item);
        }
      }
    }
  } else {
    // Weapons tab: only CATEGORY.WEAPON items
    for (let i = 2; i < WEAPONS.length; i++) {
      const w = WEAPONS[i];
      if (w.category !== CATEGORY.WEAPON) continue;
      if (w.arms <= config.armsLevel) {
        shop.items.push({ idx: i, weapon: w });
      }
    }
  }
  // Ensure selectedItem lands on a selectable row (skip headers)
  shop.selectedItem = Math.min(shop.selectedItem, Math.max(0, shop.items.length - 1));
  adjustSelectionPastHeader(1);
}

// Skip header rows when navigating: move selectedItem in the given direction until it lands on a non-header
function adjustSelectionPastHeader(dir) {
  while (shop.selectedItem >= 0 && shop.selectedItem < shop.items.length &&
         shop.items[shop.selectedItem] && shop.items[shop.selectedItem].isHeader) {
    shop.selectedItem += dir;
  }
  if (shop.selectedItem < 0) shop.selectedItem = 0;
  if (shop.selectedItem >= shop.items.length) shop.selectedItem = Math.max(0, shop.items.length - 1);
  // If still on header (edge case: all items are headers), do nothing
}

// AI auto-purchase
// EXE: shopScreen() at file 0x1DBB5 — 12-case jump table for AI buy decisions
// EXE: random(0x0B) selects action 0-10; case 11 = display inventory (fall-through)
// EXE: if DS:0x50D8 (castle terrain) && action==8, re-roll (skip guidance in mountain mode)
// EXE jump table at file 0x1DF4D:
//   0: NO-OP (thinking_anim+sound)  4: NO-OP (funky display)    8: buy guidance
//   1: buy weapon + guidance         5: buy shields              9: buy mountain gear
//   2: buy weapon + item + guidance  6: buy defense items       10: sell equipment
//   3: buy weapon + item + accessory 7: NO-OP (show equipment)  11: NO-OP (show inventory)
export function aiAutoPurchase(player) {
  // EXE: random(0x0B) at file 0x1DCA4
  let action = random(11);
  // EXE: re-roll if castle terrain and action==8 (guidance) — file 0x1DCAF..0x1DCBA
  if ((config.landType === 3 || config.landType === 5) && action === 8) {
    action = random(11);
  }

  switch (action) {
    case 0: // NO-OP: thinking animation + draw callback + sound (EXE: file 0x1DCCE)
      break;
    case 1: // Buy weapon + guidance
      aiBuyRandomWeapon(player);
      aiBuyRandomFromCategory(player, CATEGORY.GUIDANCE);
      break;
    case 2: // Buy weapon + specific item + guidance
      aiBuyRandomWeapon(player);
      aiBuyRandomFromCategory(player, CATEGORY.ACCESSORY);
      aiBuyRandomFromCategory(player, CATEGORY.GUIDANCE);
      break;
    case 3: // Buy weapon + specific item + accessory
      aiBuyRandomWeapon(player);
      aiBuyRandomFromCategory(player, CATEGORY.ACCESSORY);
      aiBuyRandomFromCategory(player, CATEGORY.DEFENSE);
      break;
    case 4: // Display money — no purchase (EXE: file 0x1DD95)
      break;
    case 5: // Buy shields (EXE: file 0x1DDB0, near call 0x1E0F3)
      aiBuyRandomShield(player);
      break;
    case 6: // Buy defense items (EXE: file 0x1DDC9)
      aiBuyRandomFromCategory(player, CATEGORY.DEFENSE);
      break;
    case 7: // Show equipment summary — no purchase (EXE: file 0x1DDEE)
      break;
    case 8: // Buy guidance (EXE: file 0x1DE12)
      aiBuyRandomFromCategory(player, CATEGORY.GUIDANCE);
      break;
    case 9: // Buy mountain gear — fuel/battery (EXE: file 0x1DE20)
      aiBuyRandomMountainGear(player);
      break;
    case 10: // Sell equipment (EXE: file 0x1DE29, near call 0x1E3CB)
      aiSellRandom(player);
      break;
    default:
      break;
  }
}

// Helper: buy 1 bundle of a random affordable weapon (idx 2..LAST_WEAPON)
// EXE: buy_weapon_scroll animation at 0x1DF65 selects random weapon via UI scroll
function aiBuyRandomWeapon(player) {
  const available = [];
  for (let i = 2; i <= WPN.LAST_WEAPON; i++) {
    const w = WEAPONS[i];
    if (w.arms <= config.armsLevel && w.price > 0) {
      const price = getWeaponPrice(i);
      if (player.cash >= price) {
        available.push(i);
      }
    }
  }
  if (available.length === 0) return;
  const idx = available[random(available.length)];
  buyWeapon(player, idx);
}

// Helper: buy 1 bundle of a random affordable item from a category
// EXE: cases 1-3, 6, 8 call buy_specific_item via 0x3D1E:0x015A
function aiBuyRandomFromCategory(player, category) {
  const available = [];
  for (let i = WPN.FIRST_ACCESSORY; i < WEAPONS.length; i++) {
    const w = WEAPONS[i];
    if (w.category === category && w.arms <= config.armsLevel && w.price > 0) {
      const price = getWeaponPrice(i);
      if (player.cash >= price) {
        available.push(i);
      }
    }
  }
  if (available.length === 0) return;
  const idx = available[random(available.length)];
  buyWeapon(player, idx);
}

// Helper: buy 1 bundle of a random affordable shield (idx 46-52)
// EXE: buy_shields at near call 0x1E0F3 — scrolls through shield list with sine wave anim
function aiBuyRandomShield(player) {
  const available = [];
  for (let i = 46; i <= 52; i++) {
    const w = WEAPONS[i];
    if (w.arms <= config.armsLevel && w.price > 0) {
      const price = getWeaponPrice(i);
      if (player.cash >= price) {
        available.push(i);
      }
    }
  }
  if (available.length === 0) return;
  const idx = available[random(available.length)];
  buyWeapon(player, idx);
}

// Helper: buy mountain gear — fuel tank (55) or battery (43)
// EXE: case 9 at 0x1DE20, call far 0x3451:0x016F
function aiBuyRandomMountainGear(player) {
  const candidates = [55, 43]; // Fuel Tank, Battery
  const available = candidates.filter(i => {
    const w = WEAPONS[i];
    return w.arms <= config.armsLevel && w.price > 0 && player.cash >= getWeaponPrice(i);
  });
  if (available.length === 0) return;
  const idx = available[random(available.length)];
  buyWeapon(player, idx);
}

// Helper: sell a random inventory item
// EXE: case 10 at 0x1DE29, sell_dialog at near call 0x1E3CB
// EXE refund: floor(qty × price × factor / bundle), factor = 0.8 (or 0.65 free market)
function aiSellRandom(player) {
  const owned = [];
  for (let i = 2; i < WEAPONS.length; i++) {
    if (player.inventory[i] > 0 && i !== WPN.BABY_MISSILE) {
      owned.push(i);
    }
  }
  if (owned.length === 0) return;
  const idx = owned[random(owned.length)];
  const qty = Math.min(player.inventory[idx], WEAPONS[idx].bundle);
  const factor = config.freeMarket ? 0.65 : 0.8;
  const refund = Math.floor(qty * getWeaponPrice(idx) * factor / WEAPONS[idx].bundle);
  player.inventory[idx] -= qty;
  player.cash += refund;
}

// Handle shop input, returns true when shop is done
// EXE: keyboard handled via tab_dispatch at file 0x152E9 (6-case jump table)
// EXE keys: Left=prev player, Right=next player, Home=first, End=last, Enter=accept
// EXE: hotkey system — ~Done = 'D', ~Update = 'U', ~Inventory = 'I'
export function shopTick(player) {
  if (!shop.active) return true;

  if (isAI(player)) {
    aiAutoPurchase(player);
    shop.active = false;
    return true;
  }

  // EXE: palette tick at file 0x14E34 — animate accent colors every 8 frames
  shop.frame++;
  tickAccentPalette(shop.frame);

  // EXE: "NO KIBITZING!!" — wait for any key/click before showing shop
  if (shop.kibitz) {
    const anyKey = ['Enter','Space','Escape','ArrowDown','ArrowUp',
                    'ArrowLeft','ArrowRight','Tab','Backspace'].some(k => consumeKey(k));
    if (anyKey || consumeClick(0)) {
      shop.kibitz = false;
    }
    return false;
  }

  // EXE: "Sell Equipment" sub-dialog — handle separately before normal shop input
  // EXE: dialog at file 0x152E9, strings at DS:0x234C-0x2354
  if (shop.selling) {
    const item = shop.items[shop.selectedItem];
    const maxQty = item ? player.inventory[item.idx] : 0;
    if (consumeKey('ArrowUp') && shop.sellQty > 1) shop.sellQty--;
    if (consumeKey('ArrowDown') && shop.sellQty < maxQty) shop.sellQty++;
    // Accept (EXE: "~Accept" hotkey 'A')
    // EXE: refund = floor(qty × price × factor / bundle); factor = 0.8 normal, 0.65 free market
    if (consumeKey('Enter') || consumeKey('KeyA')) {
      if (item && maxQty > 0) {
        const qty = Math.min(shop.sellQty, maxQty);
        const sellFactor = config.freeMarket ? 0.65 : 0.8;
        const refund = Math.floor(qty * getWeaponPrice(item.idx) / item.weapon.bundle * sellFactor);
        player.cash += refund;
        player.inventory[item.idx] -= qty;
        shop.sellQty = 1;
      }
      shop.selling = false;
    }
    // Reject (EXE: "~Reject" hotkey 'R')
    if (consumeKey('Escape') || consumeKey('KeyR')) {
      shop.selling = false;
    }
    // Mouse: click Accept/Reject buttons in sell dialog
    if (mouse.over && consumeClick(0)) {
      const SW = config.screenWidth, SH = config.screenHeight;
      const dlgW = Math.min(240, SW - 20);
      const dlgH = 106;
      const dlgX = Math.floor((SW - dlgW) / 2);
      const dlgY = Math.floor((SH - dlgH) / 2);
      const btnW = 60, btnH = 15;
      const acceptX = dlgX + Math.floor((dlgW - btnW * 2 - 20) / 2);
      const rejectX = acceptX + btnW + 20;
      const btnY = dlgY + 77;
      const mx = mouse.x, my = mouse.y;
      if (my >= btnY && my < btnY + btnH) {
        if (mx >= acceptX && mx < acceptX + btnW) {
          // Accept — EXE: refund = floor(qty × price × factor / bundle)
          if (item && maxQty > 0) {
            const qty = Math.min(shop.sellQty, maxQty);
            const sellFactor = config.freeMarket ? 0.65 : 0.8;
            player.cash += Math.floor(qty * getWeaponPrice(item.idx) / item.weapon.bundle * sellFactor);
            player.inventory[item.idx] -= qty;
            shop.sellQty = 1;
          }
          shop.selling = false;
        } else if (mx >= rejectX && mx < rejectX + btnW) {
          shop.selling = false;  // Reject
        }
      }
    }
    return false;
  }

  const perPage = getItemsPerPage();
  const SW = config.screenWidth, SH = config.screenHeight;
  const panelW = Math.min(PANEL_W_MAX, SW - 8);

  // Tab switching (EXE: Left/Right cycle Score→Weapons→Miscellaneous)
  if (consumeKey('ArrowLeft')) {
    shop.category = (shop.category + NUM_TABS - 1) % NUM_TABS;
    shop.selectedItem = 0;
    shop.scrollOffset = 0;
    updateItemList();
  }
  if (consumeKey('ArrowRight')) {
    shop.category = (shop.category + 1) % NUM_TABS;
    shop.selectedItem = 0;
    shop.scrollOffset = 0;
    updateItemList();
  }

  // Item selection (skip header rows)
  if (consumeKey('ArrowUp')) {
    shop.selectedItem = Math.max(0, shop.selectedItem - 1);
    adjustSelectionPastHeader(-1);
    if (shop.selectedItem < shop.scrollOffset) shop.scrollOffset = shop.selectedItem;
  }
  if (consumeKey('ArrowDown')) {
    shop.selectedItem = Math.min(shop.items.length - 1, shop.selectedItem + 1);
    adjustSelectionPastHeader(1);
    if (shop.selectedItem >= shop.scrollOffset + perPage) {
      shop.scrollOffset = shop.selectedItem - perPage + 1;
    }
  }

  // Buy (EXE: item_click_handler at file 0x1503B — calls dialog_select_item 0x3F19:0x5260)
  if (consumeKey('Enter') || consumeKey('Space')) {
    const item = shop.items[shop.selectedItem];
    if (item && !item.isHeader) {
      buyWeapon(player, item.idx);
    }
  }

  // Sell — EXE: opens "Sell Equipment" sub-dialog (DS:0x234C) on Backspace
  if (consumeKey('Backspace') || consumeKey('Delete')) {
    const item = shop.items[shop.selectedItem];
    if (item && !item.isHeader && player.inventory[item.idx] > 0) {
      shop.selling = true;
      shop.sellQty = 1;
    }
  }

  // Done — EXE: "~Done" hotkey 'D' at DS:0x2278
  if (consumeKey('Escape') || consumeKey('Tab') || consumeKey('KeyD')) {
    shop.active = false;
    return true;
  }

  // Scrollbar thumb drag (continuous — check every frame while button held)
  const hasSbTick = shop.category !== TAB_SCORE && shop.items.length > perPage;
  if (shop.scrollDrag) {
    if (mouse.buttons & 1) {
      const panelHTick = SH - PANEL_Y - 4;
      const listYTick  = PANEL_Y + 16;
      const btnHTick   = SB_W;
      const bTick      = 1;
      const trkTopTick = listYTick + btnHTick + bTick;
      const trkBotTick = PANEL_Y + panelHTick - 3 - btnHTick - bTick;
      const innerHTick = trkBotTick - trkTopTick;
      const thumbHTick = Math.max(8, Math.floor(innerHTick * perPage / shop.items.length));
      const trackRange = innerHTick - thumbHTick;
      const maxScroll  = shop.items.length - perPage;
      if (trackRange > 0 && maxScroll > 0) {
        const dy = mouse.y - shop.scrollDragY;
        const newOff = Math.round(shop.scrollDragOff + dy * maxScroll / trackRange);
        shop.scrollOffset = Math.max(0, Math.min(maxScroll, newOff));
      }
    } else {
      shop.scrollDrag = false;
    }
  }

  // Mouse clicks
  if (mouse.over && consumeClick(0)) {
    const mx = mouse.x, my = mouse.y;
    const listY = PANEL_Y + 16;
    const rowH = getRowH();
    const rbX = getRightBtnX(), rbW = getRightBtnW();
    const di = getExtraSpacing();
    const btnH = 15;

    // Right-side buttons: Score, Weapons, Misc, Update, Inventory, Done
    if (mx >= rbX && mx < rbX + rbW) {
      // Tab buttons (Score/Weapons/Misc) at Y=di+50, di*2+70, di*3+90
      // Simplified: stacked at top of right panel
      const tabBtnY = [PANEL_Y + 2, PANEL_Y + 2 + btnH + 4, PANEL_Y + 2 + (btnH + 4) * 2];
      for (let t = 0; t < NUM_TABS; t++) {
        if (my >= tabBtnY[t] && my < tabBtnY[t] + btnH && shop.category !== t) {
          shop.category = t;
          shop.selectedItem = 0;
          shop.scrollOffset = 0;
          updateItemList();
          break;
        }
      }
      // Update button
      const updateY = tabBtnY[2] + btnH + 8;
      if (my >= updateY && my < updateY + btnH) {
        updateItemList(); // refresh
      }
      // Inventory button
      const invY = updateY + btnH + 4;
      if (my >= invY && my < invY + btnH) {
        shop.category = TAB_MISC;
        shop.selectedItem = 0;
        shop.scrollOffset = 0;
        updateItemList();
      }
      // Done button
      const doneY = invY + btnH + 4;
      if (my >= doneY && my < doneY + btnH) {
        shop.active = false;
        return true;
      }
    }
    // Scrollbar interaction
    else if (hasSbTick) {
      const sbX    = PANEL_X + panelW - SB_W - 3;
      const panelHSb = SH - PANEL_Y - 4;
      const sbBot  = PANEL_Y + panelHSb - 3;
      const btnHSb = SB_W;
      const trkTop = listY + btnHSb;
      const trkBot = sbBot - btnHSb;
      const maxScroll = shop.items.length - perPage;

      if (mx >= sbX && mx < sbX + SB_W) {
        if (my >= listY && my < listY + btnHSb) {
          shop.scrollOffset = Math.max(0, shop.scrollOffset - 1);
        } else if (my >= trkBot && my < trkBot + btnHSb) {
          shop.scrollOffset = Math.min(maxScroll, shop.scrollOffset + 1);
        } else if (my >= trkTop && my < trkBot) {
          const b = 1;
          const innerH = (trkBot - trkTop) - 2 * b;
          const thumbH = Math.max(8, Math.floor(innerH * perPage / shop.items.length));
          const thumbY = trkTop + b + (maxScroll > 0
            ? Math.floor((innerH - thumbH) * shop.scrollOffset / maxScroll) : 0);
          if (my >= thumbY && my < thumbY + thumbH) {
            shop.scrollDrag = true;
            shop.scrollDragY = mouse.y;
            shop.scrollDragOff = shop.scrollOffset;
          } else if (my < thumbY) {
            shop.scrollOffset = Math.max(0, shop.scrollOffset - perPage);
          } else {
            shop.scrollOffset = Math.min(maxScroll, shop.scrollOffset + perPage);
          }
        }
      }
      // Item list click (exclude scrollbar)
      else if (mx >= PANEL_X + 2 && mx < sbX && my >= listY) {
        handleItemListClick(player, mx, my, listY, rowH);
      }
    }
    // Item list (no scrollbar)
    else if (shop.category !== TAB_SCORE &&
             mx >= PANEL_X + 2 && mx < PANEL_X + panelW - 2 && my >= listY) {
      handleItemListClick(player, mx, my, listY, rowH);
    }
  }

  return false;
}

// Shared item list click handler
function handleItemListClick(player, mx, my, listY, rowH) {
  const perPage = getItemsPerPage();
  const clickedRow = Math.floor((my - listY) / rowH) + shop.scrollOffset;
  if (clickedRow >= 0 && clickedRow < shop.items.length) {
    const clickedItem = shop.items[clickedRow];
    if (clickedItem && clickedItem.isHeader) return;
    if (clickedRow === shop.selectedItem) {
      const item = shop.items[shop.selectedItem];
      if (item && !item.isHeader) {
        buyWeapon(player, item.idx);
      }
    } else {
      shop.selectedItem = clickedRow;
      if (clickedRow < shop.scrollOffset) shop.scrollOffset = clickedRow;
      if (clickedRow >= shop.scrollOffset + perPage)
        shop.scrollOffset = clickedRow - perPage + 1;
    }
  }
}

// Draw shop UI into framebuffer
// EXE: uses dialog system (seg 0x3F19) with 3D beveled boxes and scrollable list widgets
// EXE: dialog_alloc(screenW, screenH, 0, 0) creates full-screen modal at file 0x15AF6
// Web port: 3D raised outer frame, sunken left item panel, right info panel, bottom tabs
export function drawShop(player) {
  if (!shop.active) return;

  const SW = config.screenWidth;
  const SH = config.screenHeight;

  // EXE: "NO KIBITZING!!" — DS:0x231C — full-screen privacy guard between hotseat turns
  if (shop.kibitz) {
    fillRect(0, 0, SW - 1, SH - 1, BLACK);
    const msg = 'NO KIBITZING!!';
    const mw = measureText(msg);
    drawText(Math.floor((SW - mw) / 2), Math.floor(SH / 2) - 6, msg, COLOR_HUD_HIGHLIGHT);
    const sub = `${player.name}'s turn — press any key`;
    const sw = measureText(sub);
    drawText(Math.floor((SW - sw) / 2), Math.floor(SH / 2) + 10, sub, COLOR_HUD_TEXT);
    return;
  }

  const baseColor = player.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
  const selFill = baseColor;

  // Full-screen 3D raised box (EXE: dialog_alloc creates full-screen modal)
  drawBox3DRaised(0, 0, SW, SH, UI_BACKGROUND,
    UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);

  // === Header row 1 (EXE: cash_display at file 0x16A7C) ===
  // EXE: player initial icon at top-left via player+0x1A color
  // EXE: "Cash: $N" (DS:0x275D "Cash") centered, "%s rounds remain" (DS:0x2C1A) right
  const initial = player.name.charAt(0).toUpperCase();
  drawText(6, 4, initial, baseColor);

  const cashStr = `Cash: $${player.cash.toLocaleString()}`;
  const cashTxtX = Math.floor((SW - measureText(cashStr)) / 2);
  drawText(cashTxtX, 4, cashStr, COLOR_HUD_HIGHLIGHT);

  // EXE: "%s rounds remain" DS:0x2C1A / "1 round remains" DS:0x2C2B
  const roundsStr = shop.roundsLeft === 1 ? '1 round remains' : `${shop.roundsLeft} rounds remain`;
  drawText(SW - measureText(roundsStr) - 6, 4, roundsStr, UI_DARK_TEXT);

  // === Header row 2 (EXE: cash_display, DS:0xCC7E=CASH_LABEL_X=5) ===
  // EXE: "Cash Left:" DS:0x2DDD at X=5, bar at CASH_LABEL_X+textW+10
  // EXE: bar width = NUM_PLAYERS * 6, "Earned interest" DS:0x235C at CASH_BAR_X+0x48
  const hdr2Y = 16;
  const cashLabelStr = 'Cash Left:';
  const cashLabelX = 5; // EXE: DS:0xCC7E = 5
  drawText(cashLabelX, hdr2Y, cashLabelStr, UI_HIGHLIGHT);
  const barX = cashLabelX + measureText(cashLabelStr) + 10; // EXE: DS:0xCC80
  const barW = players.length * 6; // EXE: NUM_PLAYERS * 6
  const barH = 10;
  const cashRatio = config.startCash > 0 ? Math.min(1, player.cash / config.startCash) : 0;
  const fillW = Math.floor(barW * cashRatio);
  drawBox3DSunken(barX, hdr2Y, barW, barH, BLACK,
    UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);
  if (fillW > 0) fillRect(barX + 1, hdr2Y + 1, barX + fillW, hdr2Y + barH - 2, baseColor);

  const intLabelStr = 'Earned interest';
  const intLabelX = barX + barW + 8; // EXE: DS:0xCC82 = CASH_BAR_X + 0x48
  drawText(intLabelX, hdr2Y, intLabelStr, UI_HIGHLIGHT);
  if (player.earnedInterest > 0) {
    const intBarX = intLabelX + measureText(intLabelStr) + 10; // EXE: DS:0xCC84
    const intRatio = config.startCash > 0 ? Math.min(1, player.earnedInterest / config.startCash) : 0;
    const intFillW = Math.floor(barW * intRatio);
    drawBox3DSunken(intBarX, hdr2Y, barW, barH, BLACK,
      UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);
    if (intFillW > 0) fillRect(intBarX + 1, hdr2Y + 1, intBarX + intFillW, hdr2Y + barH - 2, baseColor);
  }

  hline(4, SW - 5, PANEL_Y - 2, UI_MED_BORDER);

  // Layout: left item panel (200px) + right-side buttons (EXE: no bottom tab bar)
  const panelW = Math.min(PANEL_W_MAX, SW - 8);
  const panelH = SH - PANEL_Y - 4;
  const rbX = getRightBtnX();

  // Left item panel — sunken inset (EXE: left panel 0xC8=200px wide, scrollable list)
  drawBox3DSunken(PANEL_X, PANEL_Y, panelW, panelH, BLACK,
    UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);

  // Column headers inside panel
  const hdrY   = PANEL_Y + 3;

  // Panel content — either Score tab or item list
  if (shop.category === TAB_SCORE) {
    // EXE: Score tab shows "Player Rankings" title (DS:0x6042), centered above list
    // EXE: per-row format: "#N" rank (DS:0x6052="#%d") + player name + score (DS:0x6056="%d")
    // EXE: row spacing: 11px if screenH < 220, 13px if >= 220 (file 0x341F5, DS:0xEF3A vs 0xDC)
    const scoreRowH = config.screenHeight >= 220 ? 13 : 11;
    const board  = getLeaderboard();
    const scoreX = PANEL_X + panelW - 90;
    // EXE: "Player Rankings" title centered in panel (DS:0x6042)
    const titleStr = 'Player Rankings';
    const titleX = PANEL_X + Math.floor((panelW - measureText(titleStr)) / 2);
    drawText(titleX, hdrY, titleStr, UI_HIGHLIGHT);
    hline(PANEL_X + 2, PANEL_X + panelW - 3, PANEL_Y + 13, UI_MED_BORDER);
    const listY  = PANEL_Y + 16;
    for (let i = 0; i < board.length; i++) {
      const p   = board[i];
      const y   = listY + i * scoreRowH;
      const col = p.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
      // EXE: "#N" rank number prefix (DS:0x6052="#%d")
      drawText(PANEL_X + 3, y, '#' + (i + 1),     UI_DARK_TEXT);
      drawText(PANEL_X + 23, y, p.name,            col);
      drawText(scoreX,       y, String(p.score),   UI_DARK_TEXT);
    }
  } else {
    // EXE: Weapons and Miscellaneous tabs — scrollable item list
    const rowH    = getRowH();
    const perPage = getItemsPerPage();
    const hasSb   = shop.items.length > perPage;
    // Right edge of list content (leaves room for scrollbar when present)
    const listRight = PANEL_X + panelW - 3 - (hasSb ? SB_W + 1 : 0);

    // EXE column headers: qty, icon, weapon name, $price/max
    drawText(PANEL_X + 3, hdrY, TAB_NAMES[shop.category], UI_HIGHLIGHT);
    hline(PANEL_X + 2, listRight, PANEL_Y + 13, UI_MED_BORDER);
    const listY   = PANEL_Y + 16;
    const endIdx  = Math.min(shop.items.length, shop.scrollOffset + perPage);

    // EXE item row format (paint callback file 0x1580D, item_click_handler file 0x1503B):
    // "qty ▸ icon weapon_name $price/bundle" — qty left, icon, name, price/max right
    const qtyCol  = PANEL_X + 3;
    const nameCol = PANEL_X + 28;
    const priceCol = PANEL_X + panelW - 62 - (hasSb ? SB_W + 1 : 0);

    for (let i = shop.scrollOffset; i < endIdx; i++) {
      const item      = shop.items[i];
      const y         = listY + (i - shop.scrollOffset) * rowH;

      if (item.isHeader) {
        hline(PANEL_X + 2, listRight, y + 1, UI_MED_BORDER);
        drawText(PANEL_X + 3, y + 3, item.header, UI_HIGHLIGHT);
        continue;
      }

      const selected  = i === shop.selectedItem;
      const itemPrice = getWeaponPrice(item.idx);
      const canAfford = player.cash >= itemPrice;
      const owned     = player.inventory[item.idx];

      if (selected) {
        fillRect(PANEL_X + 2, y - 1, listRight, y + rowH - 2, selFill);
      }

      const txtColor = selected   ? UI_HIGHLIGHT
                     : canAfford ? UI_DARK_TEXT
                     :             UI_MED_BORDER;
      // Qty column (EXE: left-most, shows owned count)
      drawText(qtyCol, y, owned > 0 ? String(owned) : '0', owned > 0 ? baseColor : txtColor);
      // Small icon indicator
      drawText(PANEL_X + 16, y, '>', txtColor);
      // Weapon name
      drawText(nameCol, y, item.weapon.name, txtColor);
      // Price/bundle (EXE: "$price/max" right-aligned)
      const priceStr = '$' + itemPrice + '/' + item.weapon.bundle;
      drawText(priceCol, y, priceStr, txtColor);
    }

    // EXE-style 3D scrollbar (right side of panel) — sunken track, raised thumb, arrow buttons
    const perPageSb = getItemsPerPage();
    if (shop.items.length > perPageSb) {
      const sbX   = PANEL_X + panelW - SB_W - 3; // inside panel border
      const sbTop = listY;
      const sbBot = PANEL_Y + panelH - 3;
      const sbH   = sbBot - sbTop;
      const btnH  = SB_W;          // square arrow buttons
      const trkTop = sbTop + btnH;  // track starts below up arrow
      const trkBot = sbBot - btnH;  // track ends above down arrow
      const trkH   = trkBot - trkTop;

      // Up arrow button (raised 3D box + triangle glyph)
      drawBox3DRaised(sbX, sbTop, SB_W, btnH, UI_BACKGROUND,
        UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
      // Up triangle (▲)
      const arrowMidX = sbX + Math.floor(SB_W / 2);
      for (let row = 0; row < 3; row++) {
        for (let col = -row; col <= row; col++) {
          setPixel(arrowMidX + col, sbTop + 3 + row, UI_DARK_TEXT);
        }
      }

      // Down arrow button (raised 3D box + triangle glyph)
      drawBox3DRaised(sbX, trkBot, SB_W, btnH, UI_BACKGROUND,
        UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
      // Down triangle (▼)
      for (let row = 0; row < 3; row++) {
        for (let col = -(2 - row); col <= (2 - row); col++) {
          setPixel(arrowMidX + col, trkBot + 3 + row, UI_DARK_TEXT);
        }
      }

      // Track (sunken groove between arrow buttons)
      drawBox3DSunken(sbX, trkTop, SB_W, trkH, UI_MED_BORDER,
        UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);

      // Thumb (raised 3D box) — proportional to visible/total items
      if (trkH > 8) {
        const trackBorder = 1; // draw_flat_box uses 1px border
        const innerH = trkH - 2 * trackBorder;
        const thumbH = Math.max(8, Math.floor(innerH * perPageSb / shop.items.length));
        const maxScroll = shop.items.length - perPageSb;
        const thumbY = trkTop + trackBorder + (maxScroll > 0
          ? Math.floor((innerH - thumbH) * shop.scrollOffset / maxScroll)
          : 0);
        drawBox3DRaised(sbX + 1, thumbY, SB_W - 2, thumbH, UI_BACKGROUND,
          UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
      }
    }

  }

  // === Right-side buttons (EXE: shopDialogBuild at file 0x15AF6) ===
  // EXE: buttons at X=0xFA=250 (lo-res 320px mode)
  // EXE: "~Update" DS:0x2E39 at Y=di+0x32, "~Inventory" DS:0x2EEF at Y=di*2+0x46,
  //       "~Done" DS:0x2C57 at Y=di*3+0x5A
  // EXE: tab selectors (Score DS:0x2C3B, Weapons DS:0x2C41, Misc DS:0x2C49) as type9 widgets
  const rbW = getRightBtnW();
  const btnH = 15;
  const btnPad = 4;

  // Tab selector buttons (EXE: Score/Weapons/Misc — DS:0x226C far ptr table)
  const tabBtnY0 = PANEL_Y + 2;
  for (let t = 0; t < NUM_TABS; t++) {
    const by = tabBtnY0 + t * (btnH + btnPad);
    const isActive = t === shop.category;
    if (isActive) {
      drawBox3DSunken(rbX, by, rbW, btnH, UI_BACKGROUND,
        UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);
    } else {
      drawBox3DRaised(rbX, by, rbW, btnH, UI_BACKGROUND,
        UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
    }
    const tc = isActive ? UI_HIGHLIGHT : UI_DARK_TEXT;
    drawText(rbX + 4, by + 2, TAB_NAMES[t], tc);
  }

  // EXE: "~Update" button (DS:0x2E39, dialog_create_button at file 0x15D67, X=0xFA, Y=di+0x32)
  const updateY = tabBtnY0 + NUM_TABS * (btnH + btnPad) + 8;
  drawBox3DRaised(rbX, updateY, rbW, btnH, UI_BACKGROUND,
    UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
  drawText(rbX + 4, updateY + 2, '~Update', UI_DARK_TEXT);

  // EXE: "~Inventory" button (DS:0x2EEF, dialog_create_button at file 0x15DA3, X=0xFA, Y=di*2+0x46)
  const invY = updateY + btnH + btnPad;
  drawBox3DRaised(rbX, invY, rbW, btnH, UI_BACKGROUND,
    UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
  drawText(rbX + 4, invY + 2, '~Inventory', UI_DARK_TEXT);

  // EXE: "~Done" button (DS:0x2C57, add_widget_type9 at file 0x15DBC, X=0xFA, Y=di*3+0x5A)
  const doneY = invY + btnH + btnPad;
  drawBox3DRaised(rbX, doneY, rbW, btnH, UI_BACKGROUND,
    UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
  drawText(rbX + 4, doneY + 2, '~Done', UI_DARK_TEXT);

  // Item details below buttons (if selected)
  if (shop.category !== TAB_SCORE) {
    const sel = shop.items[shop.selectedItem];
    if (sel && !sel.isHeader) {
      const detY = doneY + btnH + 10;
      drawText(rbX, detY,      sel.weapon.name,               baseColor);
      drawText(rbX, detY + 12, `Price:  $${getWeaponPrice(sel.idx)}`, UI_DARK_TEXT);
      drawText(rbX, detY + 23, `Bundle: x${sel.weapon.bundle}`, UI_DARK_TEXT);
      const owned = player.inventory[sel.idx];
      drawText(rbX, detY + 34, `Owned:  ${owned > 0 ? owned : '-'}`,
               owned > 0 ? baseColor : UI_MED_BORDER);
    }
  }

  // EXE: "Sell Equipment" sub-dialog (DS:0x234C) — modal overlay when selling
  // Strings: "Sell Equipment", "Description", "Amount in stock",
  //          "~Quantity to sell:", "Offer", "~Accept", "~Reject"
  if (shop.selling) {
    const item = shop.items[shop.selectedItem];
    if (item) {
      const owned = player.inventory[item.idx];
      // EXE: sell offer = floor(qty × price × factor / bundle); 0.8 normal, 0.65 free market
      const sellFactor = config.freeMarket ? 0.65 : 0.8;
      const offer = Math.floor(shop.sellQty * getWeaponPrice(item.idx) / item.weapon.bundle * sellFactor);
      const dlgW = Math.min(240, SW - 20);
      const dlgH = 106;
      const dlgX = Math.floor((SW - dlgW) / 2);
      const dlgY = Math.floor((SH - dlgH) / 2);

      drawBox3DRaised(dlgX, dlgY, dlgW, dlgH, UI_BACKGROUND,
        UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);

      // Title
      drawText(dlgX + 5, dlgY + 3, 'Sell Equipment', UI_HIGHLIGHT);
      hline(dlgX + 3, dlgX + dlgW - 4, dlgY + 14, UI_MED_BORDER);

      // Fields
      const lx = dlgX + 6;
      const vx = dlgX + Math.floor(dlgW * 0.55);
      drawText(lx, dlgY + 18, 'Description',       UI_DARK_TEXT);
      drawText(vx, dlgY + 18, item.weapon.name,    baseColor);
      drawText(lx, dlgY + 30, 'Amount in stock',   UI_DARK_TEXT);
      drawText(vx, dlgY + 30, String(owned),        baseColor);

      // Quantity field with sunken inset
      drawText(lx, dlgY + 42, '~Quantity to sell:', UI_DARK_TEXT);
      const qtyStr = String(shop.sellQty);
      const qw = Math.max(20, measureText(qtyStr) + 6);
      drawBox3DSunken(vx - 2, dlgY + 40, qw, 13, BLACK,
        UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);
      drawText(vx + 2, dlgY + 42, qtyStr, UI_HIGHLIGHT);

      // Offer
      hline(dlgX + 3, dlgX + dlgW - 4, dlgY + 56, UI_MED_BORDER);
      drawText(lx, dlgY + 60, 'Offer', UI_DARK_TEXT);
      drawText(vx, dlgY + 60, '$' + offer, UI_HIGHLIGHT);
      hline(dlgX + 3, dlgX + dlgW - 4, dlgY + 72, UI_MED_BORDER);

      // Accept / Reject buttons
      const btnW = 60, btnH = 15;
      const acceptX = dlgX + Math.floor((dlgW - btnW * 2 - 20) / 2);
      const rejectX = acceptX + btnW + 20;
      const btnY = dlgY + 77;
      drawBox3DRaised(acceptX, btnY, btnW, btnH, UI_BACKGROUND,
        UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
      drawText(acceptX + 5, btnY + 2, '~Accept', UI_DARK_TEXT);
      drawBox3DRaised(rejectX, btnY, btnW, btnH, UI_BACKGROUND,
        UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
      drawText(rejectX + 5, btnY + 2, '~Reject', UI_DARK_TEXT);
    }
  }
}
