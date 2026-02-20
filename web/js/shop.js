// Scorched Earth - Shop System
// EXE source: equip.cpp (seg 0x16BC, file base 0x1D5C0)
// EXE: equipInit at file 0x1D5D4 — sets DS:E4F0 (first accessory) and DS:D548 (last weapon)
// EXE: AI auto-purchase uses random(11) action selection
// Full-screen shop UI rendered in framebuffer
// Category tabs, buy/sell, arms level gating, AI auto-purchase

import { config } from './config.js';
import { fillRect, hline, vline } from './framebuffer.js';
import { drawText, drawTextShadow } from './font.js';
import { BLACK } from './palette.js';
import { WEAPONS, WPN, CATEGORY } from './weapons.js';
import { consumeKey, isKeyDown } from './input.js';
import { random } from './utils.js';
import { isAI } from './ai.js';
import { SHIELD_TYPE, activateShield } from './shields.js';
import { COLOR_HUD_TEXT, COLOR_HUD_HIGHLIGHT, CHAR_W,
         PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL } from './constants.js';

// Shop state
const shop = {
  active: false,
  playerIdx: 0,
  category: 0,        // 0=Weapons, 1=Guidance, 2=Defense, 3=Accessories
  selectedItem: 0,     // index within current category list
  scrollOffset: 0,
  items: [],           // filtered item list for current view
};

const CATEGORY_NAMES = ['Weapons', 'Guidance', 'Defense', 'Accessories'];
const ITEMS_PER_PAGE = 10;

// Open shop for a player
export function openShop(playerIdx) {
  shop.active = true;
  shop.playerIdx = playerIdx;
  shop.category = 0;
  shop.selectedItem = 0;
  shop.scrollOffset = 0;
  updateItemList();
}

// Close shop
export function closeShop() {
  shop.active = false;
}

export function isShopActive() {
  return shop.active;
}

// Update filtered item list based on current category
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

// AI auto-purchase (simplified from RE: random(11) action selection)
export function aiAutoPurchase(player) {
  const budget = player.cash;

  // Buy missiles if affordable
  if (budget >= 1875 * 5 && player.inventory[WPN.MISSILE] < 10) {
    const cost = 1875 * 5;
    if (player.cash >= cost) {
      player.cash -= cost;
      player.inventory[WPN.MISSILE] += 5;
    }
  }

  // Maybe buy Baby Nukes
  if (budget >= 10000 * 3 && player.inventory[WPN.BABY_NUKE] < 3) {
    const cost = 10000 * 3;
    if (player.cash >= cost) {
      player.cash -= cost;
      player.inventory[WPN.BABY_NUKE] += 3;
    }
  }

  // Buy shields if available at current arms level and affordable
  if (WEAPONS[46].arms <= config.armsLevel && player.cash >= WEAPONS[46].price && player.inventory[46] < 2) {
    player.cash -= WEAPONS[46].price;
    player.inventory[46] += 1;  // Shield
  }
}

// Handle shop input, returns true when shop is done
export function shopTick(player) {
  if (!shop.active) return true;

  // AI: auto-purchase and close
  if (isAI(player)) {
    aiAutoPurchase(player);
    shop.active = false;
    return true;
  }

  // Category switching: left/right
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

  // Item selection: up/down
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

  // Buy: Enter/Space
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

  // Sell: Backspace/Delete
  if (consumeKey('Backspace') || consumeKey('Delete')) {
    const item = shop.items[shop.selectedItem];
    if (item && player.inventory[item.idx] > 0) {
      const refund = Math.floor(item.weapon.price * 0.5);
      player.cash += refund;
      const bundle = item.weapon.bundle;
      player.inventory[item.idx] = Math.max(0, player.inventory[item.idx] - bundle);
    }
  }

  // Done: Escape or Tab
  if (consumeKey('Escape') || consumeKey('Tab')) {
    shop.active = false;
    return true;
  }

  return false;
}

// Draw shop UI into framebuffer
export function drawShop(player) {
  if (!shop.active) return;

  // Full screen background
  fillRect(0, 0, config.screenWidth - 1, config.screenHeight - 1, BLACK);

  const baseColor = player.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;

  // Title bar
  drawTextShadow(8, 2, `${player.name}'s Shop`, baseColor, 0);
  drawText(200, 2, `Cash: $${player.cash}`, COLOR_HUD_HIGHLIGHT);

  // Category tabs
  for (let i = 0; i < CATEGORY_NAMES.length; i++) {
    const x = 8 + i * 78;
    const color = i === shop.category ? COLOR_HUD_HIGHLIGHT : COLOR_HUD_TEXT;
    drawText(x, 14, CATEGORY_NAMES[i], color);
    if (i === shop.category) {
      hline(x, x + CATEGORY_NAMES[i].length * CHAR_W - 1, 22, color);
    }
  }

  // Column headers
  drawText(8, 28, 'Item', COLOR_HUD_TEXT);
  drawText(160, 28, 'Price', COLOR_HUD_TEXT);
  drawText(210, 28, 'Own', COLOR_HUD_TEXT);
  drawText(250, 28, 'Bndl', COLOR_HUD_TEXT);
  hline(8, 310, 36, COLOR_HUD_TEXT);

  // Item list
  const startY = 40;
  const endIdx = Math.min(shop.items.length, shop.scrollOffset + ITEMS_PER_PAGE);

  for (let i = shop.scrollOffset; i < endIdx; i++) {
    const item = shop.items[i];
    const y = startY + (i - shop.scrollOffset) * 14;
    const selected = i === shop.selectedItem;
    const canAfford = player.cash >= item.weapon.price;

    // Highlight bar for selected item
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
