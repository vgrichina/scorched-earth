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
//   Resolution check: if FG_MAXY >= 400 (screenH > 400), adds 5px extra spacing.
//
// Native shop categories are Weapons and Miscellaneous, selected by a type-6
// icon slider. Miscellaneous follows native item-table order without headings.
// Right-side buttons are Update, Inventory and Done.
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
// The initial Weapons and Miscellaneous pages have full-frame RGB fixtures.
// Inventory/selling dialogs and broader input/timing still require native checks.

import { config, getUIBorderHeight } from './config.js';
import {playerCash,addPlayerCash} from './cash.js';
import { fillRect, hline, vline, setPixel, drawBox3DRaised, drawBox3DSunken } from './framebuffer.js';
import { drawText, drawTextShadow, drawTextEmbossed, measureText } from './font.js';
import { BLACK, saveAccentPalette, restoreAccentPalette, tickAccentPalette } from './palette.js';
import { WEAPONS, WPN, CATEGORY } from './weapons.js';
import { consumeAnyKey, consumeKey, consumeClick, isKeyDown, mouse } from './input.js';
import { random } from './utils.js';
import { isAI } from './ai.js';
import { SHIELD_TYPE } from './shields.js';
import { players } from './tank.js';
import { drawIcon, drawUIIcon, drawIconSlider, drawPlayfieldBorder } from './hud.js';
import { COLOR_HUD_TEXT, COLOR_HUD_HIGHLIGHT,
         PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL,
         UI_HIGHLIGHT, UI_DARK_TEXT, UI_DARK_BORDER, UI_BACKGROUND,
         UI_DEEP_SHADOW, UI_LIGHT_ACCENT, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER } from './constants.js';

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

// Native ranking valuation reads +0x1A directly, even if Free Market is off.
export function getMarketPrice(weaponIdx) {
  return market[weaponIdx]?.mktCost??WEAPONS[weaponIdx].price;
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
export function buyWeapon(player, weaponIdx) {
  if(!isShopItemAvailable(WEAPONS[weaponIdx]))return false;
  if (player.inventory[weaponIdx] >= MAX_WEAPON_QTY) return false;
  const price = getWeaponPrice(weaponIdx);
  if (playerCash(player) < price) return false;
  const bundle = WEAPONS[weaponIdx].bundle;
  addPlayerCash(player,-price);
  player.inventory[weaponIdx] += bundle;
  trackPurchase(weaponIdx);
  // EXE overflow refund (0x14A83): if qty > 99, refund excess proportionally
  if (player.inventory[weaponIdx] > MAX_WEAPON_QTY) {
    const excess = player.inventory[weaponIdx] - MAX_WEAPON_QTY;
    player.inventory[weaponIdx] = MAX_WEAPON_QTY;
    addPlayerCash(player,Math.trunc(excess * price / bundle));
    // Native 0x14B02 charges 20% of the retained partial bundle.
    addPlayerCash(player,-Math.trunc(0.2 * (price * (bundle-excess) / bundle)));
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

// Native type-6 selector: Weapons (0), Miscellaneous (1).
const TAB_WEAPONS = 0;
const TAB_MISC = 1;
const TAB_NAMES = ['Weapons','Miscellaneous'];

// Shop state
const shop = {
  active: false,
  playerIdx: 0,
  category: TAB_WEAPONS,
  selectedItem: 0,
  emptyArrowErased: false,
  scrollOffset: 0,
  items: [],
  kibitz: false,      // EXE: "NO KIBITZING!!" anti-peek screen between hotseat players
  selling: false,     // EXE: "Sell Equipment" sub-dialog active
  descriptionItem: null,
  sellQty: 1,         // EXE: "~Quantity to sell:" field value
  frame: 0,           // frame counter for palette animation
  // EXE scrollbar: arrow buttons only, no track/thumb drag
  roundsLeft: 10,     // rounds remaining (set on openShop)
};

// Layout constants (EXE: shopDialogBuild at file 0x15AF6, shop_list_row_init at 0x16219)
// EXE: SHIELD_DRAW_X_MIN=3 (DS:EF42), SHIELD_DRAW_Y_MIN=38 (DS:EF40) at 320×200
const PANEL_W_MAX = 200; // EXE: left panel width = 0xC8 = 200px
const PANEL_X = 4;       // sunken panel border X (items start at ITEM_X inside)
const PANEL_Y = 32;      // EXE: list widget Y = 0x20 = 32 (shopDialogBuild)
const ITEM_X = 12;       // EXE: SHIELD_DRAW_X_MIN + 9 = 3 + 9 = 12
const ITEM_Y_START = 55; // EXE: SHIELD_DRAW_Y_MIN + 17 = 38 + 17 = 55
// Scrollbar: EXE dialog system (seg 0x3F19) — arrow buttons only (no track/thumb)
const SB_W    = 15;   // scrollbar arrow width (EXE: 15px, file 0x15C40 bp+0x0E)
const SB_H    = 14;   // scrollbar arrow height (EXE: 14px, file 0x15C40 bp+0x10)

// EXE: right-side buttons at X=0xFA=250 (shopDialogBuild at file 0x15AF6)
function getRightBtnX() { return 250; }
function getRightBtnW() { return Math.max(...['~Update', '~Inventory', '~Done'].map(measureText)) + 12; }
// EXE: resolution check at file 0x15D37: cmp [FG_MAXY], 0x190 → di=0 or 5
function getExtraSpacing() { return config.screenHeight > 400 ? 5 : 0; }
// EXE: button height at file 0x48755: cmp [FG_MAXY], 0x12C → 17 if <300, 19 if >=300
function getBtnH() { return config.screenHeight >= 300 ? 19 : 17; }

// EXE: constant 20px row stride (file 0x16219, no hi-res variation)
function getRowH() { return 20; }

// Items visible per page: EXE formula: stride=20, Y_start=ITEM_Y_START, loop exits at FG_MAXY-20
function getItemsPerPage() {
  const bottom = config.screenHeight - 1 - 20; // FG_MAXY - 20
  return Math.min(44, Math.max(1, Math.floor((bottom - ITEM_Y_START) / 20) + 1));
}

function getSelectorY(){return Math.min(ITEM_Y_START+(getItemsPerPage()-1)*10,240);}

// Open shop for a player
// EXE: called from between-rounds loop at file 0x232E5 (play.cpp)
// EXE: checks player.cash > 0 (32-bit compare at player+0xA2/+0xA4) before opening
export function openShop(playerIdx, roundsLeft, { showPrivacy = true } = {}) {
  shop.active = true;
  shop.barMaxima=[Math.max(0,...players.map(playerCash)),
                  Math.max(0,...players.map(p=>p.earnedInterest??0))];
  shop.playerIdx = playerIdx;
  shop.category = TAB_WEAPONS;
  shop.selectedItem = 0;
  shop.scrollOffset = 0;
  shop.emptyArrowErased=false;
  shop.selling = false;
  shop.updateOpen=false;
  shop.inventoryOpen=false;shop.inventorySelection=0;shop.sellItem=null;shop.descriptionItem=null;
  shop.sellQty = 1;
  shop.frame = 0;
  shop.roundsLeft = roundsLeft || 10;
  // EXE: "NO KIBITZING!!" shown before each non-first human player's shop (DS:0x231C)
  shop.kibitz = showPrivacy && playerIdx > 0 && !isAI(players[playerIdx]);
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

// Native selector has two positions; accessories follow weapon-table order.
export function selectShopCategory(category, selectedItem=0, scrollOffset=0) {
  if(shop.items.length===0&&shop.selectedItem===-1)shop.emptyArrowErased=true;
  shop.category=category===TAB_MISC?TAB_MISC:TAB_WEAPONS;
  shop.selectedItem=selectedItem;shop.scrollOffset=scrollOffset;updateItemList();
}
// Native equip_init 1D7E6..1D904: arms limits always apply; Useless Items
// bypasses only the filters for equipment made redundant by game settings.
export function isShopItemAvailable(weapon) {
  if(weapon.arms>config.armsLevel)return false;
  if(config.uselessItems)return true;
  switch(weapon.name){
    case 'Earth Disrupter': return config.suspendDirt!==0;
    case 'Smoke Tracer': return !config.tracePaths;
    case 'Parachute': return !!config.fallingTanks;
    case 'Contact Trigger': return !!config.tunneling && config.playMode!==1;
    case 'Fuel Tank':
    case 'Heat Guidance':
    case 'Bal Guidance':
    case 'Horz Guidance':
    case 'Vert Guidance':
    case 'Lazy Boy': return config.playMode!==1;
    case 'Auto Defense': return config.playMode!==2;
    default: return true;
  }
}
function updateItemList() {
  shop.items=[];
  for(let idx=2;idx<WEAPONS.length;idx++){
    const weapon=WEAPONS[idx];
    if((weapon.category===CATEGORY.WEAPON)===(shop.category===TAB_WEAPONS)&&isShopItemAvailable(weapon))
      shop.items.push({idx,weapon});
  }
  shop.selectedItem=Math.min(shop.selectedItem,Math.max(0,shop.items.length-1));
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
    if (isShopItemAvailable(w) && w.price > 0) {
      const price = getWeaponPrice(i);
      if (playerCash(player) >= price) {
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
    if (w.category === category && isShopItemAvailable(w) && w.price > 0) {
      const price = getWeaponPrice(i);
      if (playerCash(player) >= price) {
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
  for (let i = WPN.MAG_DEFLECTOR; i <= WPN.SUPER_MAG; i++) {
    const w = WEAPONS[i];
    if (isShopItemAvailable(w) && w.price > 0) {
      const price = getWeaponPrice(i);
      if (playerCash(player) >= price) {
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
  const candidates = [WPN.FUEL_TANK, WPN.BATTERY]; // Fuel Tank, Battery
  const available = candidates.filter(i => {
    const w = WEAPONS[i];
    return isShopItemAvailable(w) && w.price > 0 && playerCash(player) >= getWeaponPrice(i);
  });
  if (available.length === 0) return;
  const idx = available[random(available.length)];
  buyWeapon(player, idx);
}

// Native sell acceptance 0x37C0C uses the same cash owner as purchases.
export function sellWeapon(player,weaponIdx,quantity) {
  const qty=Math.min(quantity,player.inventory[weaponIdx]);
  if(qty<=0)return false;
  const factor=config.freeMarket?0.65:0.8;
  const refund=Math.trunc(qty*getWeaponPrice(weaponIdx)*factor/WEAPONS[weaponIdx].bundle);
  player.inventory[weaponIdx]-=qty;
  addPlayerCash(player,refund);
  return true;
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
  sellWeapon(player,idx,qty);
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

  if(shop.updateOpen){
    const x=Math.floor((config.screenWidth-151)/2),y=Math.floor((config.screenHeight-56)/2);
    const clicked=consumeClick(0)|consumeClick(2);
    if(consumeKey('Escape')||(clicked&&mouse.over&&(mouse.x<x||mouse.x>x+150||mouse.y<y||mouse.y>y+55)))shop.updateOpen=false;
    consumeAnyKey();
    return false;
  }
  if(shop.descriptionItem!==null){
    const l=descriptionLayout(shop.descriptionItem);
    if(consumeKey('Escape')||consumeKey('Enter')||consumeKey('KeyD'))shop.descriptionItem=null;
    const left=consumeClick(0),right=consumeClick(2);
    if((left||right)&&mouse.over&&mouse.x>=l.buttonX&&mouse.x<l.buttonX+measureText('~Done')+12&&mouse.y>=l.buttonY&&mouse.y<l.buttonY+getBtnH())shop.descriptionItem=null;
    consumeKey('Space');
    return false;
  }

  // EXE: "Sell Equipment" sub-dialog — handle separately before normal shop input
  // EXE: dialog at file 0x152E9, strings at DS:0x234C-0x2354
  if (shop.selling) {
    const item = shop.sellItem??shop.items[shop.selectedItem];
    const maxQty = item ? player.inventory[item.idx] : 0;
    // Native sell dialog does not bind extended Up/Down scan codes.
    consumeKey('ArrowUp');consumeKey('ArrowDown');
    consumeKey('Enter');consumeKey('Space');
    if(consumeKey('KeyQ')){
      const reverse=isKeyDown('AltLeft')||isKeyDown('AltRight');
      shop.sellQty=reverse?(shop.sellQty>1?shop.sellQty-1:maxQty):(shop.sellQty<maxQty?shop.sellQty+1:1);
    }
    // Accept (EXE: "~Accept" hotkey 'A')
    // EXE: refund = floor(qty × price × factor / bundle); factor = 0.8 normal, 0.65 free market
    if (consumeKey('KeyA')) {
      if (item && maxQty > 0) {
        const qty = Math.min(shop.sellQty, maxQty);
        sellWeapon(player,item.idx,qty);
        shop.sellQty = 1;
      }
      shop.selling = false;
    }
    // Reject (EXE: "~Reject" hotkey 'R')
    if (consumeKey('Escape') || consumeKey('KeyR')) {
      shop.selling = false;
    }
    // Mouse: click Accept/Reject buttons in sell dialog
    const leftClick=consumeClick(0),rightClick=consumeClick(2);
    if (mouse.over && (leftClick||rightClick)) {
      const {x,y,width,qtyWidth,acceptX,rejectX}=sellLayout(player,item);
      const btnY=y+85-getUIBorderHeight(),btnH=getBtnH();
      const qtyX=x+Math.floor((width-qtyWidth)/2);
      if(mouse.x>=qtyX&&mouse.x<=qtyX+qtyWidth&&mouse.y>=y+53&&mouse.y<=y+64){
        shop.sellQty=rightClick?(shop.sellQty<maxQty?shop.sellQty+1:1):(shop.sellQty>1?shop.sellQty-1:maxQty);
      }
      const mx = mouse.x, my = mouse.y;
      if (my >= btnY && my < btnY + btnH) {
        if (mx >= acceptX && mx < acceptX + measureText('~Accept')+12) {
          // Accept — EXE: refund = floor(qty × price × factor / bundle)
          if (item && maxQty > 0) {
            const qty = Math.min(shop.sellQty, maxQty);
            sellWeapon(player,item.idx,qty);
            shop.sellQty = 1;
          }
          shop.selling = false;
        } else if (mx >= rejectX && mx < rejectX + measureText('~Reject')+12) {
          shop.selling = false;  // Reject
        }
      }
    }
    return false;
  }

  const perPage = getItemsPerPage();
  const SW = config.screenWidth, SH = config.screenHeight;
  const panelW = Math.min(PANEL_W_MAX, SW - 8);

  if(shop.inventoryOpen){
    const l=inventoryLayout(player);
    if(consumeKey('Escape')){closeShopInventory(player);return false;}
    // Native 0x3E1D3 wraps each grid axis independently, including empty cells.
    let col=shop.inventorySelection%l.columns,row=Math.floor(shop.inventorySelection/l.columns);
    if(consumeKey('ArrowLeft'))col--;
    if(consumeKey('ArrowRight'))col++;
    if(consumeKey('ArrowUp'))row--;
    if(consumeKey('ArrowDown'))row++;
    if(consumeKey('Home'))col=0;
    if(consumeKey('End'))col=l.columns-1;
    if(consumeKey('PageUp'))row=0;
    if(consumeKey('PageDown'))row=l.rows-1;
    shop.inventorySelection=((row+l.rows)%l.rows)*l.columns+(col+l.columns)%l.columns;
    let activate=false;
    const left=consumeClick(0),right=consumeClick(2);
    if(left||right){
      if(mouse.x<l.x||mouse.x>l.x+l.width||mouse.y<l.y||mouse.y>l.y+l.height)closeShopInventory(player);
      else if(mouse.y>=l.y+24){
        const col=Math.floor((mouse.x-l.x-4)/30),row=Math.floor((mouse.y-l.y-24)/15),index=row*l.columns+col;
        if(col>=0&&col<l.columns&&row>=0&&row<l.rows){shop.inventorySelection=index;activate=true;}
      }
    }
    if(activate&&right){
      shop.descriptionItem=l.items[shop.inventorySelection]??null;
      return false;
    }
    if(consumeKey('Enter')||consumeKey('Space')||activate){
      const idx=l.items[shop.inventorySelection];
      if(idx!==undefined&&idx!==2&&player.inventory[idx]>0){shop.sellItem={idx,weapon:WEAPONS[idx]};shop.selling=true;shop.sellQty=1;}
    }
    return false;
  }
  if(consumeKey('KeyU')){shop.updateOpen=true;return false;}
  if(consumeKey('KeyI')){openShopInventory(player);return false;}

  // Native shop does not change categories on horizontal arrow keys.
  consumeKey('ArrowLeft');consumeKey('ArrowRight');

  // Native 152E9 keeps row navigation within the current page.
  const previousSelection=shop.selectedItem;
  const lastVisible=Math.min(shop.items.length,shop.scrollOffset+perPage)-1;
  if(consumeKey('ArrowUp'))
    shop.selectedItem=shop.selectedItem<=shop.scrollOffset?lastVisible:shop.selectedItem-1;
  if(consumeKey('ArrowDown'))
    shop.selectedItem=shop.selectedItem>=lastVisible?shop.scrollOffset:shop.selectedItem+1;
  if(consumeKey('Home'))shop.selectedItem=shop.scrollOffset;
  if(consumeKey('End'))shop.selectedItem=lastVisible;
  if(consumeKey('PageUp'))scrollShopPage(-1);
  if(consumeKey('PageDown'))scrollShopPage(1);
  if(previousSelection===-1&&shop.selectedItem!==-1&&shop.items.length===0)shop.emptyArrowErased=true;

  // Buy (EXE: item_click_handler at file 0x1503B — calls dialog_select_item 0x3F19:0x5260)
  if (consumeKey('Enter') || consumeKey('Space')) {
    const item = shop.items[shop.selectedItem];
    if (item && !item.isHeader) {
      buyWeapon(player, item.idx);
    }
  }

  // Native shop selling is reached through Inventory, not these keys.
  consumeKey('Backspace');consumeKey('Delete');
  if(consumeKey('Tab'))selectShopCategory(shop.category===TAB_WEAPONS?TAB_MISC:TAB_WEAPONS);

  // Done — EXE: "~Done" hotkey 'D' at DS:0x2278
  if (consumeKey('Escape') || consumeKey('KeyD')) {
    shop.active = false;
    return true;
  }

  // EXE scrollbar: arrow buttons only (no track/thumb drag)
  const hasSbTick = shop.items.length > perPage;

  // Mouse clicks
  const leftClick=consumeClick(0),rightClick=consumeClick(2);
  if (mouse.over && (leftClick||rightClick)) {
    const mx = mouse.x, my = mouse.y;
    const listY = ITEM_Y_START;
    const rowH = getRowH();
    const rbX = getRightBtnX(), rbW = getRightBtnW();
    const di = getExtraSpacing();
    const btnH = getBtnH();

    // Right-side action buttons: Update, Inventory, Done
    if (mx >= rbX && mx < rbX + rbW) {
      // Action buttons (top right)
      const updateY = di + 0x32 - getUIBorderHeight();
      if (my >= updateY && my < updateY + btnH) {
        shop.updateOpen=true;
      }
      const invY = di * 2 + 0x46 - getUIBorderHeight();
      if (my >= invY && my < invY + btnH) {
        openShopInventory(player);
      }
      const doneY = di * 3 + 0x5A - getUIBorderHeight();
      if (my >= doneY && my < doneY + btnH) {
        shop.active = false;
        return true;
      }
    }
    // Native type-6 selector spans its icons and slider (builder 0x15BBA).
    else if(mx>=198&&mx<=226&&my>=getSelectorY()-17&&my<=getSelectorY()+5) {
      selectShopCategory(mx<212?TAB_WEAPONS:TAB_MISC);
    }
    // Scrollbar interaction
    else if (hasSbTick) {
      const sbX = 200;
      if (mx >= sbX && mx < sbX + SB_W) {
        scrollShopAt(mx,my);
      }
      // Item list click (exclude scrollbar)
      else if (mx >= PANEL_X + 2 && mx < sbX && my >= listY) {
        handleItemListClick(player, mx, my, listY, rowH);
      }
    }
    // Item list (no scrollbar)
    else if (mx >= PANEL_X + 2 && mx < PANEL_X + panelW - 2 && my >= listY) {
      handleItemListClick(player, mx, my, listY, rowH);
    }
  }

  return false;
}

// Native scrollbar buttons cycle complete pages and reset the row selection.
function scrollShopAt(mx,my){
  const perPage=getItemsPerPage();
  if(shop.items.length<=perPage||mx<200||mx>=200+SB_W)return false;
  const top=ITEM_Y_START-getUIBorderHeight(),bottom=top+(perPage-1)*20;
  const direction=my>=top&&my<top+SB_H?-1:my>=bottom&&my<bottom+SB_H?1:0;
  if(!direction)return false;
  return scrollShopPage(direction);
}
function scrollShopPage(direction){
  const perPage=getItemsPerPage();
  if(shop.items.length<=perPage)return false;
  const pages=Math.ceil(shop.items.length/perPage);
  shop.scrollOffset=((Math.floor(shop.scrollOffset/perPage)+direction+pages)%pages)*perPage;
  shop.selectedItem=shop.scrollOffset;
  return true;
}

// Shared item list click handler
function handleItemListClick(player, mx, my, _listY, rowH) {
  const perPage = getItemsPerPage();
  // Native click widgets cover the text rectangle, excluding bevels and gaps.
  const row=Math.floor((my-ITEM_Y_START)/rowH);
  if(mx<ITEM_X||mx>ITEM_X+166||row<0||row>=perPage||my>ITEM_Y_START+row*rowH+11)return;
  const clickedRow=row+shop.scrollOffset;
  if (clickedRow >= 0 && clickedRow < shop.items.length) {
    const clickedItem = shop.items[clickedRow];
    if (clickedItem && clickedItem.isHeader) return;
    shop.selectedItem = clickedRow;
    if (clickedRow < shop.scrollOffset) shop.scrollOffset = clickedRow;
    if (clickedRow >= shop.scrollOffset + perPage)
      shop.scrollOffset = clickedRow - perPage + 1;
    buyWeapon(player,clickedItem.idx);
  }
}

function drawShopActionLabel(x,y,label,disabled){
  if(disabled){drawText(x+1,y,label.replace('~',''),UI_LIGHT_BORDER);drawText(x,y,label.replace('~',''),UI_DARK_TEXT);}
  else drawText(x,y,label,UI_HIGHLIGHT);
}
function openShopInventory(player){
  shop.inventoryOpen=true;shop.inventorySelection=0;
  shop.inventoryItems=[];
  for(let i=2;i<WEAPONS.length;i++)if(player.inventory[i]>0||(i===WPN.FUEL_TANK&&(player.fuelEnergy??0)>0))shop.inventoryItems.push(i);
  // Native redraws the grid after selling, but refreshes the shop list on closing it.
  shop.inventoryShopCounts=Array.from(player.inventory);
  shop.inventoryOpeningCash=playerCash(player);
}
function closeShopInventory(player){
  shop.inventoryOpen=false;
  if(playerCash(player)!==shop.inventoryOpeningCash){
    shop.selectedItem=0;shop.scrollOffset=0;updateItemList();
  }
}
function inventoryLayout(player){
  const items=shop.inventoryItems;
  const columns=items.length>36?7:items.length>25?6:items.length>16?5:4;
  const rows=Math.max(1,Math.ceil(items.length/columns)),width=columns*30+6,height=rows*15+25;
  return {items,columns,rows,width,height,x:Math.floor((config.screenWidth-1-width)/2),y:Math.floor((38+config.screenHeight-4-height)/2)};
}
function drawShopInventory(player){
  const {items,columns,rows,width,height,x,y}=inventoryLayout(player),color=player.colorIndex*8;
  drawBox3DRaised(x,y,width+1,height+1,UI_BACKGROUND,UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
  drawText(x+Math.floor((width-measureText('Inventory'))/2)+1,y+5,'Inventory',UI_HIGHLIGHT);
  hline(x+5,x+width-5,y+18,UI_LIGHT_BORDER);hline(x+5,x+width-5,y+19,UI_MED_BORDER);
  for(let col=1;col<columns;col++)vline(x+3+col*30,y+24,y+height-3,color);
  for(let row=0;row<rows-1;row++)hline(x+4,x+width-4,y+38+row*15,color);
  items.forEach((idx,i)=>{
    const tx=x+6+i%columns*30,ty=y+25+Math.floor(i/columns)*15;
    if(player.inventory[idx]>0||(idx===WPN.FUEL_TANK&&shop.inventoryShopCounts[idx]===0&&(player.fuelEnergy??0)>0)){drawText(tx,ty,String(player.inventory[idx]),UI_HIGHLIGHT);drawIcon(tx+13,ty,idx-2,UI_HIGHLIGHT);}
  });
  const sx=x+4+shop.inventorySelection%columns*30,sy=y+24+Math.floor(shop.inventorySelection/columns)*15;
  vline(sx,sy,sy+12,UI_MED_BORDER);hline(sx+1,sx+28,sy,UI_BRIGHT_BORDER);
  vline(sx+28,sy+1,sy+13,UI_DARK_BORDER);hline(sx,sx+27,sy+13,UI_LIGHT_BORDER);
}

// Draw shop UI into framebuffer
// EXE: uses dialog system (seg 0x3F19) with 3D beveled boxes and scrollable list widgets
// EXE: dialog_alloc(screenW, screenH, 0, 0) creates full-screen modal at file 0x15AF6
// Native list rows, category selector and right-side action buttons.
// Native 0x16A7A: maxima are computed independently for cash and interest.
// Both bars show one six-pixel column per player (0x16D3A / 0x16EF8).
export function drawShopCashBars() {
  if(!config.statusBar)return;
  const y=17,cashX=15+measureText('Cash Left:'),interestLabelX=cashX+72;
  const interestX=interestLabelX+measureText('Earned interest')+10;
  drawText(5,y,'Cash Left:',UI_HIGHLIGHT);
  drawText(interestLabelX,y,'Earned interest',UI_HIGHLIGHT);
  const bars=[[cashX,players.map(playerCash)],
              [interestX,players.map(p=>p.earnedInterest??0)]];
  for(const [index,[x,values]] of bars.entries()) {
    // Purchases keep the opening scale; native 0x1717A raises the cash
    // maximum when a sale increases it, but never lowers it within a shop.
    const maximum=Math.max(shop.barMaxima?.[index]??0,...values);
    if(shop.barMaxima)shop.barMaxima[index]=maximum;
    drawBox3DSunken(x-1,y,players.length*6+2,12,UI_HIGHLIGHT,
      UI_MED_BORDER,UI_BRIGHT_BORDER,UI_DARK_BORDER,UI_LIGHT_BORDER);
    players.forEach((p,i)=>{
      const height=maximum?Math.max(0,Math.min(10,Math.trunc(values[i]*10/maximum))):0;
      if(height)fillRect(x+i*6,y+11-height,x+i*6+5,y+10,p.colorIndex*PLAYER_PALETTE_STRIDE);
    });
  }
}

export function drawShop(player) {
  if (!shop.active) return;

  const SW = config.screenWidth;
  const SH = config.screenHeight;

  // EXE: "NO KIBITZING!!" — show_no_kibitzing at 0x43080 — 200×155 centered 3D dialog
  if (shop.kibitz) {
    const dlgW = 200, dlgH = 155;
    const dlgX = Math.floor((SW - dlgW) / 2);
    const dlgY = Math.floor((SH - dlgH) / 2);
    drawBox3DRaised(dlgX, dlgY, dlgW, dlgH, UI_BACKGROUND,
      UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
    // EXE: draw_embossed_text at (dlg.x+30, dlg.y+70)
    drawTextEmbossed(dlgX + 30, dlgY + 70, 'NO KIBITZING!!', [
      UI_DEEP_SHADOW, UI_BRIGHT_BORDER, UI_DARK_TEXT, UI_LIGHT_ACCENT, UI_DARK_BORDER
    ]);
    return;
  }

  const baseColor = player.colorIndex * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;

  // Shared HUD frame and three-layer playfield border.
  fillRect(0, 0, SW - 1, SH - 1, UI_BACKGROUND);
  drawPlayfieldBorder();

  // === Header row 1 (EXE: cash_display at file 0x16A7C) ===
  // EXE: cash label and amount use distinct columns (0x15FBA, 0x15FFB).
  // EXE: header row 1 at Y = HUD_Y (DS:0x518E, typically 5)
  const hdr1Y = 5;
  drawText(10, hdr1Y, player.name, baseColor);

  const cashTxtX = 20 + measureText('MMMMMMMMMMMMMMM'); // EXE 0x15FBA..0x15FD6
  drawText(cashTxtX, hdr1Y, 'Cash:', UI_HIGHLIGHT);
  drawText(cashTxtX + measureText('Cash:') + 3, hdr1Y,
    '$' + playerCash(player).toLocaleString(), UI_HIGHLIGHT);

  // EXE: "%s rounds remain" DS:0x2C1A / "1 round remains" DS:0x2C2B
  const roundsStr = shop.roundsLeft === 1 ? '1 round remains' : `${shop.roundsLeft} rounds remain`;
  drawText(SW - 100, hdr1Y, roundsStr, UI_HIGHLIGHT);

  drawShopCashBars();

  // Layout: left item panel (200px) + right-side buttons
  // EXE: panel sunken box from (ITEM_X-2, ITEM_Y_START-2) to bottom
  const panelW = Math.min(PANEL_W_MAX, SW - 8);
  const rbX = getRightBtnX();

  const hdrY = 40;

  {
    // EXE: Weapons and Miscellaneous tabs — scrollable item list
    const rowH    = getRowH();
    const perPage = getItemsPerPage();
    const hasSb   = shop.items.length > perPage;

    // EXE column headers: qty, icon, weapon name, $price/max
    drawText(23, hdrY, TAB_NAMES[shop.category], UI_HIGHLIGHT);
    const endIdx = shop.scrollOffset + perPage;

    // EXE item row format (paint callback file 0x1580D, item_click_handler file 0x1503B):
    // "qty ▸ icon weapon_name $price/bundle" — qty left, icon, name, price/max right
    // EXE column offsets (shop_list_render at 0x16826):
    // qty at X, icon at X+13, name at X+27, price at X+115
    const qtyCol  = ITEM_X;
    const nameCol = ITEM_X + 27;
    const priceCol = ITEM_X + 115;

    for (let i = shop.scrollOffset; i < endIdx; i++) {
      const item      = shop.items[i];
      // EXE: Y = ITEM_Y_START + (rowIndex * 20) — absolute positions
      const y         = ITEM_Y_START + (i - shop.scrollOffset) * rowH;

      // Native selection marker is painted even when the category is empty.
      if(i===shop.selectedItem){
        for(let dy=-2;dy<=2;dy++)
          for(let dx=0;dx<=2-Math.abs(dy);dx++)setPixel(6+dx,y+6+dy,UI_HIGHLIGHT);
      }
      if(!item){
        drawBox3DSunken(ITEM_X-2,y-2,171,16,UI_BACKGROUND,
          UI_MED_BORDER,UI_BRIGHT_BORDER,UI_DARK_BORDER,UI_LIGHT_BORDER);
        continue;
      }

      const itemPrice = getWeaponPrice(item.idx);
      const owned     = (shop.inventoryOpen?shop.inventoryShopCounts:player.inventory)[item.idx];

      drawBox3DSunken(ITEM_X - 2, y - 2, 171, 16, UI_BACKGROUND,
        UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);
      const txtColor = UI_HIGHLIGHT;
      // Qty column (EXE: left-most, shows owned count)
      drawText(qtyCol, y, owned > 0 ? String(owned) : '0', txtColor);
      // EXE: draws weapon icon at X+13
      drawIcon(ITEM_X + 13, y, item.idx - 2, txtColor, true);
      // Weapon name at X+27
      drawText(nameCol, y, item.weapon.name, txtColor);
      // Price/bundle at X+115 (EXE: "$price/max")
      const priceStr = '$' + itemPrice + '/' + item.weapon.bundle;
      drawText(priceCol, y, priceStr, txtColor);
    }

    // Native permits row -1 in an empty category. Its coordinate-table read
    // reaches CAC2/CAC4 (scroll offset / last-visible index), and the VGA
    // writer treats the resulting negative X as an unsigned 16-bit value.
    // The custom 360x480 writer wraps invalid coordinates; standard drivers clip.
    if(((shop.selectedItem===-1&&shop.items.length===0)||shop.emptyArrowErased) && SW===360){
      for(let dy=-2;dy<=2;dy++)for(let dx=0;dx<=2-Math.abs(dy);dx++){
        const address=(5+dy)*SW+((-6+dx)&0xffff);
        // Native erases the old arrow in flat background, including bevel pixels.
        setPixel(address%SW,Math.floor(address/SW),shop.selectedItem===-1&&shop.items.length===0?UI_HIGHLIGHT:UI_BACKGROUND);
      }
    }

    // EXE-style scrollbar (right side of panel) — arrow buttons only, no track/thumb
    const perPageSb = getItemsPerPage();
    {
      const enabled=shop.items.length>perPageSb;
      const sbX   = 200; // inside panel border
      const sbTop = ITEM_Y_START - getUIBorderHeight();
      const sbBot = ITEM_Y_START + (perPageSb - 1) * 20 - getUIBorderHeight() + SB_H;
      const sbH   = sbBot - sbTop;
      const btnH  = SB_H;          // arrow button height (EXE: 14px)
      const trkTop = sbTop + btnH;  // track starts below up arrow
      const trkBot = sbBot - btnH;  // track ends above down arrow
      const trkH   = trkBot - trkTop;

      // Up arrow button (raised 3D box + triangle glyph)
      drawBox3DRaised(sbX, sbTop, SB_W, btnH, UI_BACKGROUND,
        UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
      // EXE 0x15587: hollow seven-pixel bevel, base at widget top + 8.
      hline(sbX + 4, sbX + 10, sbTop + 8, (enabled?UI_BRIGHT_BORDER:UI_DARK_TEXT));
      for (let k = 0; k < 4; k++) {
        setPixel(sbX + 4 + k, sbTop + 7 - k, (enabled?UI_DARK_BORDER:UI_DARK_TEXT));
        if (k < 3) setPixel(sbX + 10 - k, sbTop + 7 - k, (enabled?UI_MED_BORDER:UI_DARK_TEXT));
      }

      // Down arrow button (raised 3D box + triangle glyph)
      drawBox3DRaised(sbX, trkBot, SB_W, btnH, UI_BACKGROUND,
        UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
      // EXE 0x156EF: the down tip belongs to the dark right edge.
      hline(sbX + 4, sbX + 10, trkBot + 5, (enabled?UI_LIGHT_BORDER:UI_DARK_TEXT));
      for (let k = 0; k < 4; k++) {
        if (k < 3) setPixel(sbX + 4 + k, trkBot + 6 + k, (enabled?UI_DARK_BORDER:UI_DARK_TEXT));
        setPixel(sbX + 10 - k, trkBot + 6 + k, (enabled?UI_MED_BORDER:UI_DARK_TEXT));
      }

      // EXE: no track or thumb between arrow buttons — just background
    }

  }

  // EXE type-6 selector: builder 0x15BBA, paint 0x47DF7, icons 0x15828.
  const selectorY=getSelectorY();
  drawUIIcon(199, selectorY - 11, 5, UI_HIGHLIGHT);
  drawUIIcon(217, selectorY - 11, 7, UI_HIGHLIGHT);
  drawIconSlider(198, 226, selectorY, shop.category === TAB_MISC ? 221 : 203);

  // === Right-side buttons (EXE: shopDialogBuild at file 0x15AF6) ===
  // EXE: buttons at X=0xFA=250 (lo-res 320px mode)
  // EXE: "~Update" DS:0x2E39 at Y=di+0x32, "~Inventory" DS:0x2EEF at Y=di*2+0x46,
  //       "~Done" DS:0x2C57 at Y=di*3+0x5A
  const rbW = getRightBtnW();
  const btnH = getBtnH();

  // EXE: action buttons at TOP RIGHT (shopDialogBuild dialog_create_button calls)
  // di = extra spacing for hi-res (5px if FG_MAXY >= 400, else 0)
  const di = getExtraSpacing();

  // "~Update" at X=250, Y=di+0x32
  const updateY = di + 0x32;
  if(shop.updateOpen)drawBox3DSunken(rbX,updateY-getUIBorderHeight(),rbW,btnH,UI_BACKGROUND,
    UI_MED_BORDER,UI_BRIGHT_BORDER,UI_DARK_BORDER,UI_LIGHT_BORDER);
  else drawBox3DRaised(rbX, updateY - getUIBorderHeight(), rbW, btnH, UI_BACKGROUND,
    UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
  if(shop.updateOpen)drawText(rbX+7,updateY+2,'Update',UI_HIGHLIGHT);
  else drawShopActionLabel(rbX+5,updateY,'~Update',shop.inventoryOpen);

  // "~Inventory" at X=250, Y=di*2+0x46
  const invY = di * 2 + 0x46;
  if(shop.inventoryOpen)drawBox3DSunken(rbX, invY - getUIBorderHeight(), rbW, btnH, UI_BACKGROUND,
    UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);
  else drawBox3DRaised(rbX, invY - getUIBorderHeight(), rbW, btnH, UI_BACKGROUND,
    UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
  if(shop.inventoryOpen)drawText(rbX+7,invY+2,'Inventory',UI_HIGHLIGHT);
  else drawShopActionLabel(rbX+5,invY,'~Inventory',shop.updateOpen);

  // "~Done" at X=250, Y=di*3+0x5A
  const doneY = di * 3 + 0x5A;
  drawBox3DRaised(rbX, doneY - getUIBorderHeight(), rbW, btnH, UI_BACKGROUND,
    UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
  drawShopActionLabel(rbX+5,doneY,'~Done',shop.inventoryOpen||shop.updateOpen);

  // NOTE: Item detail panel below action buttons is a web-only addition.
  // EXE shows no item details in the right panel area — details are in the
  // scrollable list itself (qty + icon + name + price/bundle per row).



  // EXE: "Sell Equipment" sub-dialog (DS:0x234C) — modal overlay when selling
  // Strings: "Sell Equipment", "Description", "Amount in stock",
  //          "~Quantity to sell:", "Offer", "~Accept", "~Reject"
  if(shop.updateOpen)drawShopUpdate(player);
  if(shop.inventoryOpen)drawShopInventory(player);

  if(shop.descriptionItem!==null)drawShopDescription(shop.descriptionItem);
  if (shop.selling) {
    const item=shop.sellItem??shop.items[shop.selectedItem];
    if(item)drawSellDialog(player,item);
  }
}

function sellLayout(player,item){
  const stock=`Amount in stock: ${player.inventory[item.idx]}`;
  const qtyWidth=15+measureText('~Quantity to sell:')+measureText(String(player.inventory[item.idx]));
  const width=Math.max(30+measureText('Sell Equipment'),20+qtyWidth,20+measureText(stock),20+measureText(item.weapon.name));
  // Native auto-sizing: last button bottom plus ten pixels of padding.
  const height=94-getUIBorderHeight()+getBtnH(),x=Math.floor((config.screenWidth-1-width)/2),y=Math.floor((config.screenHeight-1-height)/2);
  // Native 0x4A398 distributes three equal gaps, centering the remainder.
  const free=width-(measureText('~Accept')+11)-(measureText('~Reject')+11);
  const gap=Math.floor(free/3),left=gap+Math.floor((free-gap*3)/2);
  const acceptX=x+left,rejectX=acceptX+measureText('~Accept')+11+gap;
  return {x,y,width,height,stock,qtyWidth,acceptX,rejectX};
}
function drawSellDialog(player,item){
  const {x,y,width,height,stock,qtyWidth,acceptX,rejectX}=sellLayout(player,item);
  const center=text=>x+Math.floor((width-measureText(text)+1)/2);
  drawBox3DRaised(x,y,width+1,height+1,UI_BACKGROUND,UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
  drawText(center('Sell Equipment'),y+5,'Sell Equipment',UI_HIGHLIGHT);
  hline(x+5,x+width-5,y+18,UI_LIGHT_BORDER);hline(x+5,x+width-5,y+19,UI_MED_BORDER);
  const nameX=center(item.weapon.name);
  drawText(nameX,y+23,item.weapon.name,UI_HIGHLIGHT);
  drawIcon(nameX-13,y+23,item.idx-2,UI_HIGHLIGHT,true);
  drawIcon(nameX+measureText(item.weapon.name)+2,y+23,item.idx-2,UI_HIGHLIGHT,true);
  drawText(center(stock),y+38,stock,UI_HIGHLIGHT);
  const qx=x+Math.floor((width-qtyWidth)/2),qy=y+53;
  drawText(qx+8,qy,'~Quantity to sell:',UI_HIGHLIGHT);
  drawText(qx+10+measureText('~Quantity to sell:'),qy,String(shop.sellQty),UI_HIGHLIGHT);
  hline(qx,qx+6,qy+5,UI_BRIGHT_BORDER);hline(qx,qx+6,qy+7,UI_LIGHT_BORDER);
  for(let k=0;k<4;k++){
    setPixel(qx+k,qy+4-k,UI_DARK_BORDER);
    if(k<3)setPixel(qx+6-k,qy+4-k,UI_MED_BORDER);
    setPixel(qx+k,qy+8+k,k===3?UI_MED_BORDER:UI_DARK_BORDER);
    setPixel(qx+6-k,qy+8+k,UI_MED_BORDER);
  }
  const offer=Math.trunc(shop.sellQty*getWeaponPrice(item.idx)*(config.freeMarket?0.65:0.8)/item.weapon.bundle);
  const offerText=`Offer: $${offer.toLocaleString('en-US')}`;
  drawText(x+Math.floor((width-measureText(offerText))/2),y+68,offerText,UI_HIGHLIGHT);
  for(const [bx,label] of [[acceptX,'~Accept'],[rejectX,'~Reject']]){
    drawBox3DRaised(bx,y+85-getUIBorderHeight(),measureText(label)+12,getBtnH(),UI_BACKGROUND,UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
    drawText(bx+5,y+85,label,UI_HIGHLIGHT);
  }
}

// Native 0x269ED: this executable's Description dialog has a title, item name,
// separator and Done button; its body contains no explanatory text.
function descriptionLayout(idx){
  const width=Math.max(30+measureText('Description'),20+measureText(WEAPONS[idx].name));
  const border=getUIBorderHeight();
  const height=94-border+getBtnH(),x=Math.floor((config.screenWidth-1-width)/2),y=Math.floor((config.screenHeight-1-height)/2);
  return {x,y,width,height,buttonY:y+85-border,buttonX:x+Math.floor((width-measureText('~Done')-11+1)/2)};
}
function drawShopDescription(idx){
  const {x,y,width,height,buttonX,buttonY}=descriptionLayout(idx);
  drawBox3DRaised(x,y,width+1,height+1,UI_BACKGROUND,UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
  for(const [label,dy] of [['Description',5],[WEAPONS[idx].name,23]])
    drawText(x+Math.floor((width-measureText(label)+1)/2),y+dy,label,UI_HIGHLIGHT);
  hline(x+5,x+width-5,y+18,UI_LIGHT_BORDER);hline(x+5,x+width-5,y+19,UI_MED_BORDER);
  drawBox3DRaised(buttonX,buttonY,measureText('~Done')+12,getBtnH(),UI_BACKGROUND,UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
  drawText(buttonX+5,y+85,'~Done',UI_HIGHLIGHT);
}

// Native shop Update (42F20, paint 42D15): round count and earned interest.
function drawShopUpdate(player){
  const width=150,height=55,x=Math.floor((config.screenWidth-1-width)/2),y=Math.floor((config.screenHeight-1-height)/2);
  drawBox3DRaised(x,y,width+1,height+1,UI_BACKGROUND,UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
  drawText(x+Math.floor((width-measureText('Update')+1)/2),y+5,'Update',UI_HIGHLIGHT);
  hline(x+5,x+width-5,y+18,UI_LIGHT_BORDER);hline(x+5,x+width-5,y+19,UI_MED_BORDER);
  drawText(x+5,y+24,`${config.rounds-shop.roundsLeft} of ${config.rounds} rounds fought.`,UI_HIGHLIGHT);
  drawText(x+5,y+36,`Earned interest: $${(player.earnedInterest??0).toLocaleString('en-US')}`,UI_HIGHLIGHT);
}
