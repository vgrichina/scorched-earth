// Scorched Earth - Indexed Framebuffer (VGA Mode 13h emulation)
// EXE: VGA Mode 13h — linear 320×200 framebuffer at segment A000h
// EXE: uses Fastgraph V4.02 library for VGA pixel operations
// EXE: pixel values are palette indices (0-255) into the VGA DAC
// Web: 320×200 Uint8Array of palette indices, blitted to canvas via palette32 lookup

import { palette32, updatePalette32 } from './palette.js';
import { config } from './config.js';

const WIDTH = config.screenWidth;   // 320
const HEIGHT = config.screenHeight; // 200

// The indexed pixel buffer (VGA VRAM equivalent)
export const pixels = new Uint8Array(WIDTH * HEIGHT);

// Canvas rendering
let ctx = null;
let imageData = null;
let buf32 = null;

export function initFramebuffer(canvas) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  ctx = canvas.getContext('2d');
  imageData = ctx.createImageData(WIDTH, HEIGHT);
  buf32 = new Uint32Array(imageData.data.buffer);
}

// Set a single pixel by palette index
export function setPixel(x, y, colorIndex) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  pixels[y * WIDTH + x] = colorIndex;
}

// Get palette index at pixel
export function getPixel(x, y) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return 0;
  return pixels[y * WIDTH + x];
}

// Draw horizontal line (inclusive)
export function hline(x0, x1, y, colorIndex) {
  if (y < 0 || y >= HEIGHT) return;
  if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
  if (x0 < 0) x0 = 0;
  if (x1 >= WIDTH) x1 = WIDTH - 1;
  const row = y * WIDTH;
  for (let x = x0; x <= x1; x++) {
    pixels[row + x] = colorIndex;
  }
}

// Draw vertical line (inclusive)
export function vline(x, y0, y1, colorIndex) {
  if (x < 0 || x >= WIDTH) return;
  if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
  if (y0 < 0) y0 = 0;
  if (y1 >= HEIGHT) y1 = HEIGHT - 1;
  for (let y = y0; y <= y1; y++) {
    pixels[y * WIDTH + x] = colorIndex;
  }
}

// Fill rectangle (inclusive coords)
export function fillRect(x0, y0, x1, y1, colorIndex) {
  for (let y = y0; y <= y1; y++) {
    hline(x0, x1, y, colorIndex);
  }
}

// Clear entire framebuffer to a color index
export function clear(colorIndex) {
  pixels.fill(colorIndex);
}

// Blit indexed framebuffer to canvas using palette32 lookup
export function blit() {
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    buf32[i] = palette32[pixels[i]];
  }
  ctx.putImageData(imageData, 0, 0);
}
