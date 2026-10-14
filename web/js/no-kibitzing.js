// Native K-key modal dialog: retain the exact gameplay image underneath it.
import {config} from './config.js';
import {pixels,drawBox3DRaised} from './framebuffer.js';
import {drawTextEmbossed} from './font.js';
import {UI_BACKGROUND,UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,
  UI_BRIGHT_BORDER,UI_HIGHLIGHT,UI_DARK_TEXT} from './constants.js';
let saved = null;
export function drawNoKibitzing() {
  if (!saved) saved = pixels.slice();
  // Native centers against FG_MAXX/FG_MAXY and draws inclusive endpoints.
  const width = 200, height = 155;
  const x = Math.floor((config.screenWidth-1-width)/2);
  const y = Math.floor((config.screenHeight-1-height)/2);
  drawBox3DRaised(x,y,width+1,height+1,UI_BACKGROUND,
    UI_DARK_BORDER,UI_LIGHT_BORDER,UI_MED_BORDER,UI_BRIGHT_BORDER);
  drawTextEmbossed(x+30,y+70,'NO KIBITZING!!',[
    UI_HIGHLIGHT,UI_BRIGHT_BORDER,UI_DARK_TEXT,UI_BACKGROUND,UI_DARK_BORDER]);
}
export function closeNoKibitzing() {
  if (saved) pixels.set(saved);
  saved = null;
}
