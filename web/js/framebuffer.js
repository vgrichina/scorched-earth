// Scorched Earth - Indexed Framebuffer (VGA/SVGA mode emulation)
// EXE: supports 9 graphics modes from 320×200 (Mode 13h) to 1024×768 (VESA)
// EXE: uses Fastgraph V4.02 library for pixel operations across all modes
// EXE: pixel values are palette indices (0-255) into the VGA DAC
// Web: W×H Uint8Array of palette indices, blitted to canvas via:
//   WebGL — index texture + palette texture, fragment shader does DAC lookup on GPU
//   Canvas2D fallback — CPU loop maps indices through palette32 LUT to ImageData

import { palette32 } from './palette.js';
import { config } from './config.js';

// Current dimensions — updated by initFramebuffer/reinitFramebuffer
let WIDTH = config.screenWidth;
let HEIGHT = config.screenHeight;

// Export accessors for modules that need current dimensions
export function getWidth() { return WIDTH; }
export function getHeight() { return HEIGHT; }

// The indexed pixel buffer (VGA VRAM equivalent)
export let pixels = new Uint8Array(WIDTH * HEIGHT);

// VGA DAC background emulation — per-row default palette index
// In VGA hardware, every VRAM byte always maps to a DAC color. There is no
// "unfilled" pixel. This table stores the sky gradient palette index per
// scanline, enabling clearToBackground() to reset the entire framebuffer
// in a single memcpy — equivalent to every VGA pixel always having a color.
let background = new Uint8Array(HEIGHT);
let backgroundBuffer = new Uint8Array(WIDTH * HEIGHT);

// Uint8 view of palette32 for WebGL texture upload (ABGR Uint32 → RGBA bytes on LE)
const paletteBytes = new Uint8Array(palette32.buffer);

// Canvas2D fallback state
let ctx = null;
let imageData = null;
let buf32 = null;

// WebGL state
let gl = null;
let glProg = null;
let indexTexture = null;
let paletteTexture = null;

// Canvas element reference
let canvasEl = null;

export function initFramebuffer(canvas) {
  canvasEl = canvas;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  // Try WebGL for GPU-accelerated palette lookup (VGA DAC emulation on GPU)
  gl = canvas.getContext('webgl', { alpha: false, antialias: false });
  if (gl) {
    initWebGL();
  } else {
    // Fallback to Canvas2D palette lookup
    ctx = canvas.getContext('2d');
    imageData = ctx.createImageData(WIDTH, HEIGHT);
    buf32 = new Uint32Array(imageData.data.buffer);
  }
}

// Reinitialize framebuffer for a new graphics mode (different resolution)
// Called when user changes graphics mode in menu before starting game
export function reinitFramebuffer() {
  WIDTH = config.screenWidth;
  HEIGHT = config.screenHeight;

  pixels = new Uint8Array(WIDTH * HEIGHT);
  background = new Uint8Array(HEIGHT);
  backgroundBuffer = new Uint8Array(WIDTH * HEIGHT);

  if (!canvasEl) return;
  canvasEl.width = WIDTH;
  canvasEl.height = HEIGHT;

  if (gl) {
    gl.viewport(0, 0, WIDTH, HEIGHT);
    // Textures are recreated on next blit via texImage2D
  } else if (ctx) {
    imageData = ctx.createImageData(WIDTH, HEIGHT);
    buf32 = new Uint32Array(imageData.data.buffer);
  }
}

function initWebGL() {
  // Vertex shader: fullscreen quad, flip Y for screen coords
  const vsrc =
    'attribute vec2 a_pos;' +
    'varying vec2 v_uv;' +
    'void main(){' +
    '  gl_Position=vec4(a_pos,0,1);' +
    '  v_uv=vec2((a_pos.x+1.0)/2.0,(1.0-a_pos.y)/2.0);' +
    '}';

  // Fragment shader: sample index texture, look up color in palette texture
  // Index texture is LUMINANCE (single byte / 255.0), palette is 256×1 RGBA
  const fsrc =
    'precision mediump float;' +
    'varying vec2 v_uv;' +
    'uniform sampler2D u_idx;' +
    'uniform sampler2D u_pal;' +
    'void main(){' +
    '  float i=texture2D(u_idx,v_uv).r;' +
    '  gl_FragColor=texture2D(u_pal,vec2((i*255.0+0.5)/256.0,0.5));' +
    '}';

  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, vsrc);
  gl.compileShader(vs);

  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, fsrc);
  gl.compileShader(fs);

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.useProgram(prog);
  glProg = prog;

  // Fullscreen quad (triangle strip: BL, BR, TL, TR)
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  // Index texture: W×H LUMINANCE, updated every frame
  indexTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, indexTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_idx'), 0);

  // Palette texture: 256×1 RGBA (VGA DAC equivalent)
  paletteTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_pal'), 1);

  gl.viewport(0, 0, WIDTH, HEIGHT);
}

// Set per-row background palette indices (sky gradient)
// Called once when sky type is configured; the mapping from screen row
// to palette index (80-103) is independent of the palette RGB values.
export function setBackground(rowColors) {
  background.set(rowColors);
  for (let y = 0; y < HEIGHT; y++) {
    backgroundBuffer.fill(rowColors[y], y * WIDTH, (y + 1) * WIDTH);
  }
}

// Get background palette index for a screen row (used by crater/tunnel fill)
export function getBackgroundColor(y) {
  return background[y];
}

// Clear framebuffer to per-row background colors
// Single memcpy — equivalent to VGA VRAM always having a valid DAC index
export function clearToBackground() {
  pixels.set(backgroundBuffer);
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

// EXE: draw_3d_box at file 0x444BB (0x3DAB:0x000B) — raised box, Windows 3.1-style
// EXE: 2px beveled border. Left/Top = DS:0xEF26(dark) + DS:0xEF2E(light),
//      Right/Bottom = DS:0xEF30(med) + DS:0xEF32(bright). Interior = fill_color.
export function drawBox3DRaised(x, y, w, h, fill, lightBorder, darkBorder, medBorder, brightBorder) {
  // Fill interior
  fillRect(x + 2, y + 2, x + w - 3, y + h - 3, fill);
  // Top edge: 2px — outer=light, inner=dark (matches EXE DS:0xEF2E then DS:0xEF26)
  hline(x, x + w - 1, y, lightBorder);
  hline(x + 1, x + w - 2, y + 1, darkBorder);
  // Left edge: 2px
  vline(x, y, y + h - 1, lightBorder);
  vline(x + 1, y + 1, y + h - 2, darkBorder);
  // Bottom edge: 2px — outer=bright, inner=med (matches EXE DS:0xEF32 then DS:0xEF30)
  hline(x, x + w - 1, y + h - 1, brightBorder);
  hline(x + 1, x + w - 2, y + h - 2, medBorder);
  // Right edge: 2px
  vline(x + w - 1, y, y + h - 1, brightBorder);
  vline(x + w - 2, y + 1, y + h - 2, medBorder);
}

// EXE: draw_flat_box at file 0x44630 (0x3DAB:0x0180) — sunken/inset frame
// EXE: reversed bevel. Top=DS:0xEF30, Left=DS:0xEF32, Bottom=DS:0xEF26, Right=DS:0xEF2E
export function drawBox3DSunken(x, y, w, h, fill, medBorder, brightBorder, darkBorder, lightBorder) {
  // Fill interior
  fillRect(x + 2, y + 2, x + w - 3, y + h - 3, fill);
  // Top edge: sunken = med then bright
  hline(x, x + w - 1, y, medBorder);
  hline(x + 1, x + w - 2, y + 1, brightBorder);
  // Left edge: sunken = bright then med
  vline(x, y, y + h - 1, brightBorder);
  vline(x + 1, y + 1, y + h - 2, medBorder);
  // Bottom edge: sunken = dark then light
  hline(x, x + w - 1, y + h - 1, darkBorder);
  hline(x + 1, x + w - 2, y + h - 2, lightBorder);
  // Right edge: sunken = light then dark
  vline(x + w - 1, y, y + h - 1, lightBorder);
  vline(x + w - 2, y + 1, y + h - 2, darkBorder);
}

// Blit indexed framebuffer to canvas
// WebGL: upload index+palette textures, GPU does palette lookup in fragment shader
// Canvas2D: CPU loop maps palette indices to RGBA via palette32 LUT
export function blit() {
  if (gl) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, indexTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, WIDTH, HEIGHT, 0,
      gl.LUMINANCE, gl.UNSIGNED_BYTE, pixels);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, paletteBytes);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  } else {
    const totalPixels = WIDTH * HEIGHT;
    for (let i = 0; i < totalPixels; i++) {
      buf32[i] = palette32[pixels[i]];
    }
    ctx.putImageData(imageData, 0, 0);
  }
}
