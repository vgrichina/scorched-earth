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
//   "Sell Equipment" DS:0x234C, "Description" DS:0x233C, "Amount in stock" DS:0x2340,
//   "~Quantity to sell:" DS:0x2344, "Offer" DS:0x2348,
//   "~Accept" DS:0x2350, "~Reject" DS:0x2354
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
// EXE palette animation (palette tick at file 0x14E34):
//   Accent color table at DS:0x1F62 (5 entries × 6 bytes RGB words):
//     bright red (63,0,0), orange (63,32,10), magenta (63,0,63),
//     dark red (63,12,12), deep pink (63,0,30)
//   Cycles palette indices 8-11 every 8 frames (test [0xEC], 7)
//
// NOTE: Web port uses simplified flat categories vs EXE's tabbed dialog system.
// The EXE shop is significantly more complex (dialog widgets, scrollbar, sell sub-dialog,
// palette animation, per-player name switching, "NO KIBITZING!!" privacy guard).

import { config } from './config.js';
import { fillRect, hline, vline } from './framebuffer.js';
import { drawText, drawTextShadow, measureText } from './font.js';
import { BLACK } from './palette.js';
import { WEAPONS, WPN, CATEGORY } from './weapons.js';
import { consumeKey, isKeyDown } from './input.js';
import { random } from './utils.js';
import { isAI } from './ai.js';
import { SHIELD_TYPE, activateShield } from './shields.js';
import { COLOR_HUD_TEXT, COLOR_HUD_HIGHLIGHT,
         PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL } from './constants.js';

// Shop state
const shop = {
  active: false,
  playerIdx: 0,
  category: 0,        // 0=Weapons, 1=Guidance, 2=Defense, 3=Accessories
  selectedItem: 0,
  scrollOffset: 0,
  items: [],
};

// Web port uses 4 flat categories; EXE uses 3 tabs (Score/Weapons/Miscellaneous)
// with sub-categories within Miscellaneous
const CATEGORY_NAMES = ['Weapons', 'Guidance', 'Defense', 'Accessories'];
const ITEMS_PER_PAGE = 10;

// Open shop for a player
// EXE: called from between-rounds loop at file 0x232E5 (play.cpp)
// EXE: checks player.cash > 0 (32-bit compare at player+0xA2/+0xA4) before opening
export function openShop(playerIdx) {
  shop.active = true;
  shop.playerIdx = playerIdx;
  shop.category = 0;
  shop.selectedItem = 0;
  shop.scrollOffset = 0;
  updateItemList();
}

export function closeShop() {
  shop.active = false;
}

export function isShopActive() {
  return shop.active;
}

// Update filtered item list based on current category
// EXE: category boundaries set by equipInit() at file 0x1D5D4 via findWeaponByName()
// EXE: weapon struct array at DS:0x11F6 (file 0x056F76), stride 0x34 (52 bytes)
// EXE: arms level gating via weapon_struct+0x08 <= config.armsLevel
function updateItemList() {
  shop.items = [];
  for (let i = 2; i < WEAPONS.length; i++) {
    const w = WEAPONS[i];
    if (w.category === shop.category && w.arms <= config.armsLevel) {
      shop.items.push({ idx: i, weapon: w });
    }
  }
  shop.selectedItem = Math.min(shop.selectedItem, Math.max(0, shop.items.length - 1));
}

// AI auto-purchase
// EXE: shopScreen() at file 0x1DBB5 — 12-case jump table for AI buy decisions
// EXE: uses random(11) action selection for variety
export function aiAutoPurchase(player) {
  const budget = player.cash;

  if (budget >= 1875 * 5 && player.inventory[WPN.MISSILE] < 10) {
    const cost = 1875 * 5;
    if (player.cash >= cost) {
      player.cash -= cost;
      player.inventory[WPN.MISSILE] += 5;
    }
  }

  if (budget >= 10000 * 3 && player.inventory[WPN.BABY_NUKE] < 3) {
    const cost = 10000 * 3;
    if (player.cash >= cost) {
      player.cash -= cost;
      player.inventory[WPN.BABY_NUKE] += 3;
    }
  }

  if (WEAPONS[46].arms <= config.armsLevel && player.cash >= WEAPONS[46].price && player.inventory[46] < 2) {
    player.cash -= WEAPONS[46].price;
    player.inventory[46] += 1;
  }
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

  // Category switching
  if (consumeKey('ArrowLeft')) {
    shop.category = (shop.category + CATEGORY_NAMES.length - 1) % CATEGORY_NAMES.length;
    shop.selectedItem = 0;
    shop.scrollOffset = 0;
    updateItemList();
  }
  if (consumeKey('ArrowRight')) {
    shop.category = (shop.category + 1) % CATEGORY_NAMES.length;
    shop.selectedItem = 0;
    shop.scrollOffset = 0;
    updateItemList();
  }

  // Item selection
  if (consumeKey('ArrowUp')) {
    shop.selectedItem = Math.max(0, shop.selectedItem - 1);
    if (shop.selectedItem < shop.scrollOffset) shop.scrollOffset = shop.selectedItem;
  }
  if (consumeKey('ArrowDown')) {
    shop.selectedItem = Math.min(shop.items.length - 1, shop.selectedItem + 1);
    if (shop.selectedItem >= shop.scrollOffset + ITEMS_PER_PAGE) {
      shop.scrollOffset = shop.selectedItem - ITEMS_PER_PAGE + 1;
    }
  }

  // Buy
  // EXE: item_click_handler at file 0x1503B — calls dialog_select_item (0x3F19:0x5260)
  if (consumeKey('Enter') || consumeKey('Space')) {
    const item = shop.items[shop.selectedItem];
    if (item) {
      const cost = item.weapon.price;
      const bundle = item.weapon.bundle;
      if (player.cash >= cost) {
        player.cash -= cost;
        player.inventory[item.idx] += bundle;
      }
    }
  }

  // Sell — EXE has full sub-dialog: "Sell Equipment" title, quantity input, accept/reject
  // EXE: sell price ~50% of purchase (visible in sell dialog "Offer" field)
  if (consumeKey('Backspace') || consumeKey('Delete')) {
    const item = shop.items[shop.selectedItem];
    if (item && player.inventory[item.idx] > 0) {
      const refund = Math.floor(item.weapon.price * 0.5);
      player.cash += refund;
      const bundle = item.weapon.bundle;
      player.inventory[item.idx] = Math.max(0, player.inventory[item.idx] - bundle);
    }
  }

  // Done — EXE: "~Done" hotkey 'D' at DS:0x2278
  if (consumeKey('Escape') || consumeKey('Tab')) {
    shop.active = false;
    return true;
  }

  return false;
}

// Draw shop UI into framebuffer
// EXE: uses dialog system (seg 0x3F19) with 3D beveled boxes and scrollable list widgets
// EXE: dialog_alloc(screenW, screenH, 0, 0) creates full-screen modal at file 0x15AF6
// Web port: simplified flat rendering (no dialog system, no 3D boxes, no scroll widgets)
export function drawShop(player) {
  if (!shop.active) return;

  fillRect(0, 0, config.screenWidth - 1, config.screenHeight - 1, BLACK);

  const baseColor = player.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;

  // Title — EXE: player name rendered with fg_setcolor(player+0x1A) at file 0x1580D
  drawTextShadow(8, 2, `${player.name}'s Shop`, baseColor, 0);
  // EXE: "Cash Left:" at DS:0x22F8 (file 0x58B5D), rendered by cash_display at file 0x16A7C
  drawText(200, 2, `Cash: $${player.cash}`, COLOR_HUD_HIGHLIGHT);

  // Category tabs
  // EXE: 3 tabs at bottom — "Score" DS:0x2C3B, "Weapons" DS:0x2C41,
  // "Miscellaneous" DS:0x2C49, "~Done" DS:0x2C57
  // Web port: 4 categories at top as simple text labels
  for (let i = 0; i < CATEGORY_NAMES.length; i++) {
    const x = 8 + i * 78;
    const color = i === shop.category ? COLOR_HUD_HIGHLIGHT : COLOR_HUD_TEXT;
    drawText(x, 14, CATEGORY_NAMES[i], color);
    if (i === shop.category) {
      hline(x, x + measureText(CATEGORY_NAMES[i]) - 1, 22, color);
    }
  }

  // Column headers
  drawText(8, 28, 'Item', COLOR_HUD_TEXT);
  drawText(160, 28, 'Price', COLOR_HUD_TEXT);
  drawText(210, 28, 'Own', COLOR_HUD_TEXT);
  drawText(250, 28, 'Bndl', COLOR_HUD_TEXT);
  hline(8, 310, 36, COLOR_HUD_TEXT);

  // Item list
  // EXE: scrollable list widget via add_item_list() at 0x3F19:0x2A9B, 14-15 visible rows
  // EXE: selection highlight painted with player_color+4 (lighter shade) at file 0x1580D
  // EXE: depleted items use DS:0xEF24 color (check at file 0x30452-0x30462)
  const startY = 40;
  const endIdx = Math.min(shop.items.length, shop.scrollOffset + ITEMS_PER_PAGE);

  for (let i = shop.scrollOffset; i < endIdx; i++) {
    const item = shop.items[i];
    const y = startY + (i - shop.scrollOffset) * 14;
    const selected = i === shop.selectedItem;
    const canAfford = player.cash >= item.weapon.price;

    if (selected) {
      fillRect(6, y - 1, 312, y + 9, player.index * PLAYER_PALETTE_STRIDE + 1);
    }

    const textColor = selected ? COLOR_HUD_HIGHLIGHT : (canAfford ? COLOR_HUD_TEXT : 104 + PLAYER_PALETTE_STRIDE);
    drawText(8, y, item.weapon.name, textColor);
    drawText(160, y, '$' + item.weapon.price, textColor);
    const owned = player.inventory[item.idx];
    drawText(210, y, owned > 0 ? String(owned) : '-', owned > 0 ? baseColor : COLOR_HUD_TEXT);
    drawText(250, y, 'x' + item.weapon.bundle, COLOR_HUD_TEXT);
  }

  // Footer
  const footerY = config.screenHeight - 20;
  hline(8, 310, footerY - 4, COLOR_HUD_TEXT);
  drawText(8, footerY, 'ENTER:Buy  DEL:Sell  TAB:Done', COLOR_HUD_TEXT);
  drawText(8, footerY + 10, 'LEFT/RIGHT:Category  UP/DOWN:Select', COLOR_HUD_TEXT);
}
