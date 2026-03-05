// Scorched Earth - Main entry point + game loop
// EXE source: play.cpp (seg 0x28B9, file base 0x2F830) — main game loop
// EXE: game loop dispatch at file 0x2F78A, VGA blit via Fastgraph V4.02
// Phase 6: Title screen, config menu, full game flow

import { config, GRAPHICS_MODES, applyGraphicsMode } from './config.js';
import { initFramebuffer, reinitFramebuffer, blit, setPixel, getPixel, fillRect, hline, vline, drawBox3DRaised } from './framebuffer.js';
import { initPalette, BLACK, LASER_GREEN, LASER_WHITE } from './palette.js';
import { generateTerrain, drawSky, drawTerrain, initSkyBackground, PLAYFIELD_TOP, reinitTerrainBuffers, loadMTNFiles } from './terrain.js';
import { placeTanks, drawAllTanks, players, drawDeathAnimations } from './tank.js';
import { seedRandom, bresenhamLine } from './utils.js';
import { initInput } from './input.js';
import { drawHud, drawWindIndicator } from './hud.js';
import { drawText, drawTextShadow, measureText } from './font.js';
import { projectiles } from './physics.js';
import { gameTick, game, STATE, generateWind, getCurrentPlayer, initGameRound, SYSTEM_MENU_OPTIONS } from './game.js';
import { drawShield, drawShieldBreak } from './shields.js';
import { isShopActive, drawShop } from './shop.js';
import { getLeaderboard, SCORE_MODE } from './score.js';
import { menuTick, drawMainMenu, drawPlayerSetupScreen, playerSetup } from './menu.js';
import { WPN } from './weapons.js';
import { screenFlash } from './explosions.js';
import { initSound, toggleSound } from './sound.js';
import { drawSpeechBubble } from './talk.js';
import { COLOR_HUD_TEXT, COLOR_HUD_HIGHLIGHT, COLOR_HUD_WARNING,
         PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL,
         FIRE_PAL_BASE,
         UI_HIGHLIGHT, UI_DARK_TEXT, UI_DARK_BORDER, UI_BACKGROUND,
         UI_DEEP_SHADOW, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER } from './constants.js';

// Update CSS --game-aspect custom property for display scaling.
// EXE: each mode has a displayAspect (pixel height/width ratio). For non-square
// pixel modes (320×400 aspect=0.50, 360×480 aspect=0.55), the display should
// show corrected proportions: displayWidth/displayHeight = w / (h * displayAspect)
function updateCSSAspect() {
  const mode = GRAPHICS_MODES[config.graphicsMode] || GRAPHICS_MODES[0];
  // CSS aspect = display width / display height
  // Display height = canvas height * displayAspect (tall pixels compress vertically)
  const cssAspect = mode.w / (mode.h * mode.displayAspect);
  document.documentElement.style.setProperty('--game-aspect', cssAspect.toFixed(4));
}

async function init() {
  const canvas = document.getElementById('screen');
  initFramebuffer(canvas);
  updateCSSAspect();

  initInput(canvas);
  seedRandom(Date.now());

  // Set up palette for title screen (default terrain/sky)
  initPalette(config.landType, config.skyType);
  initSkyBackground();

  // EXE: main menu is the first screen (no separate title splash)
  game.state = STATE.CONFIG;

  // Pre-load MTN terrain files (land type 3 — ScannedMountain class)
  await loadMTNFiles();

  requestAnimationFrame(gameLoop);
}

// Called when transitioning from menu to game
function startGame() {
  // Apply selected graphics mode — reinit framebuffer + terrain at new resolution
  applyGraphicsMode();
  reinitFramebuffer();
  reinitTerrainBuffers();
  updateCSSAspect();

  // Re-init palette with configured types
  initPalette(config.landType, config.skyType);
  initSkyBackground();
  generateTerrain();
  generateWind();
  placeTanks(config.numPlayers);

  // Apply player setup from menu
  for (let i = 0; i < players.length && i < playerSetup.length; i++) {
    players[i].name = playerSetup[i].name;
    players[i].aiType = playerSetup[i].aiType;
  }

  game.round = 1;
  game.turnCount = 0;
  game.currentPlayer = 0;
  initGameRound();
}

// EXE VERIFIED: full world repaint before gameTick ensures clean framebuffer
// for pixel-based collision detection. Laser sight pixels never enter the FB
// during gameTick — they are drawn as overlays AFTER physics/collision runs.
function redrawWorld() {
  drawSky();
  drawTerrain();
  drawAllTanks();
  // Draw shields on top of tanks
  for (const p of players) {
    if (p.alive) drawShield(p);
  }
}

function drawAllProjectiles() {
  for (const proj of projectiles) {
    if (!proj.active) continue;

    // Draw trail — config.tracePaths shows full permanent trail
    const trail = proj.trail;
    const trailLen = config.tracePaths ? trail.length : (proj.isNapalmParticle ? 5 : 20);
    for (let i = Math.max(0, trail.length - trailLen); i < trail.length; i++) {
      const p = trail[i];
      const age = trail.length - i;
      if (p.x >= 0 && p.x < config.screenWidth && p.y >= 0 && p.y < config.screenHeight) {
        if (proj.isNapalmParticle) {
          const palIdx = proj.isDirtParticle ? 140 : (190 + Math.min(9, age));
          setPixel(p.x, p.y, palIdx);
        } else {
          setPixel(p.x, p.y, age < 5 ? COLOR_HUD_HIGHLIGHT : age < 10 ? 189 : COLOR_HUD_WARNING);
        }
      }
    }

    // Draw projectile head
    // EXE: BOMB_ICON (DS:0x51A2): 0=Small(1px), 1=Big(5px cross), 2=Invisible(skip)
    // EXE: DS:0x514E=BOMB_INVISIBLE_FLAG suppresses drawing in both draw functions
    const hx = Math.round(proj.x);
    const hy = Math.round(proj.y);
    if (hx >= 0 && hx < config.screenWidth && hy >= 0 && hy < config.screenHeight) {
      if (proj.isNapalmParticle) {
        setPixel(hx, hy, proj.isDirtParticle ? 145 : COLOR_HUD_HIGHLIGHT);
      } else if (config.bombIcon !== 2) {
        // Small (0): single white pixel; Big (1, default): 5-pixel cross
        setPixel(hx, hy, COLOR_HUD_HIGHLIGHT);
        if (config.bombIcon !== 0) {
          if (hx + 1 < config.screenWidth) setPixel(hx + 1, hy, FIRE_PAL_BASE + 19);
          if (hx - 1 >= 0) setPixel(hx - 1, hy, FIRE_PAL_BASE + 19);
          if (hy + 1 < config.screenHeight) setPixel(hx, hy + 1, FIRE_PAL_BASE + 19);
          if (hy - 1 >= 0) setPixel(hx, hy - 1, FIRE_PAL_BASE + 19);
        }
      }
      // bombIcon===2: Invisible — draw nothing
    }
  }
}

// ======================================================================
// LASER SIGHT SYSTEM
// ======================================================================
// EXE: draw_laser_sight function at file 0x36321 (seg 0x2F76:0x01C1)
// EXE: shares code segment 0x2F76 with plasma_blast_handler (0x3616D)
//   and riot_blast_handler (0x3651D)
// EXE: Laser and Plasma Laser are ACCESSORIES (indices 35-36), NOT fireable
//   beam weapons. They have NULL behavior function pointers (0x0000:0x0000).
//   Invoked during AIM phase by the UI, not through the weapon dispatch system.
// EXE: DS:EC4C = erase color mask, DS:EC4E = draw color
// EXE: DS:6100 = PI/180 deg-to-rad constant
// EXE: DS:6108 = angular step (~0.3 rad) for sweep animation
// EXE: DS:EC50/EC52 = laser sight tracking X/Y (furthest reach)
// EXE: Laser struct at DS:0x18AA (file 0x5762A): color=0x78, erase=0xFE
// EXE: Plasma Laser struct at DS:0x18DE (file 0x5765E): color=0xFE, erase=-1

const laserState = {
  displayAngle: -1,  // current visual angle in radians (-1 = uninitialized)
  lastPlayerIdx: -1, // track player changes to reset sweep
};
const LASER_ANGLE_STEP = 0.3;  // EXE: DS:6108 ~0.3 rad per animation frame

// Draw laser sight line from barrel tip
// EXE function: file 0x36321, seg 0x2F76:0x01C1
// EXE params: (x, y, angle, end_angle, power, type)
// EXE pseudocode:
//   angle_rad = angle * PI/180
//   if (type == 1) { EC4C = -1; EC4E = 0xFE; }  // Plasma: white, no mask
//   else           { EC4C = 0xFE; EC4E = 0x78; } // Laser: green, skip white
//   while (angle_rad < end_angle_rad) {
//     dx = sin(angle_rad) * (-power); dy = cos(angle_rad) * power;
//     bresenham_line(old, new, pixel_callback_at_0x36271);
//     angle_rad += ~0.3_rad;
//   }
// EXE VERIFIED: Laser/Plasma Laser have NULL behavior pointers (0x0000:0x0000).
// No per-turn ammo consumption found in any EXE code path. They are purely visual
// accessories checked by inventory count but never decremented during AIM phase.
function drawLaserSight(player) {
  if (!player.alive) return;
  // EXE: checks player inventory for Laser (idx 35) or Plasma Laser (idx 36)
  const hasLaser = player.inventory[WPN.LASER] > 0;
  const hasPlasma = player.inventory[WPN.PLASMA_LASER] > 0;
  if (!hasLaser && !hasPlasma) return;

  // EXE: Plasma takes priority — type==1 check at 0x36321
  const isPlasma = hasPlasma;
  // EXE: DS:EC4E = 0xFE (white) for Plasma, 0x78 (green) for standard Laser
  // Web: remapped to palette indices 253/254 to avoid terrain overlap (0x78=120 conflicts)
  const color = isPlasma ? LASER_WHITE : LASER_GREEN;

  const targetAngleRad = player.angle * Math.PI / 180;

  // Reset sweep on player change
  if (laserState.lastPlayerIdx !== player.index) {
    laserState.displayAngle = targetAngleRad;
    laserState.lastPlayerIdx = player.index;
  }

  // Initialize on first use
  if (laserState.displayAngle < 0) {
    laserState.displayAngle = targetAngleRad;
  }

  // EXE: sweep animation — steps display angle toward target by DS:6108 (~0.3 rad) per frame
  const diff = targetAngleRad - laserState.displayAngle;
  if (Math.abs(diff) > LASER_ANGLE_STEP) {
    laserState.displayAngle += Math.sign(diff) * LASER_ANGLE_STEP;
  } else {
    laserState.displayAngle = targetAngleRad;
  }

  const angleRad = laserState.displayAngle;
  // EXE: barrel tip = tank dome center + barrel length (12px) in aim direction
  const barrelLength = 12;
  const domeTopY = player.y - 4 - 4;  // body(4) + dome peak(4) from icons.cpp
  const startX = Math.round(player.x + Math.cos(angleRad) * barrelLength);
  const startY = Math.round(domeTopY - Math.sin(angleRad) * barrelLength);

  // EXE: dx = sin(angle_rad) * (-power) — power (0-1000) controls laser reach
  const maxDist = player.power;
  const endX = Math.round(player.x + Math.cos(angleRad) * maxDist);
  const endY = Math.round(domeTopY - Math.sin(angleRad) * maxDist);

  // EXE: per-pixel callback at file 0x36271 (seg 0x2F76:0x0111)
  // EXE: checks screen bounds (DS:EF42/EF3C/EF40/EF38)
  // EXE: handles cavern wrapping (DS:510E)
  // EXE: Standard Laser: EC4C=0xFE (skip white pixels), EC4E=0x78 (green, terrain blend)
  //   → calls 0x32C2:0x1519 for terrain-blended drawing
  // EXE: Plasma Laser: EC4C=-1 (no skip mask), EC4E=0xFE (fg_point overwrites all)
  // EXE: tracks furthest reach in DS:EC50/EC52
  // EXE: uses Bresenham line at file 0x1E2E3 (seg 0x171B:0x0733)
  bresenhamLine(startX, startY, endX, endY, (x, y) => {
    if (x >= 0 && x < config.screenWidth && y >= 0 && y < config.screenHeight) {
      if (!isPlasma) {
        // EXE: "If EC4C != -1: skip pixels matching EC4C (0xFE)"
        // Standard laser skips white pixels so it doesn't overwrite plasma sight
        const existing = getPixel(x, y);
        if (existing === LASER_WHITE) return;
        // EXE: "If EC4E == 0x78: terrain blend" — green line draws through terrain
      }
      // EXE: Plasma laser overwrites all pixels (EC4C=-1 means no skip check)
      setPixel(x, y, color);
    }
  });
}

function drawRoundOver() {
  const alive = players.filter(p => p.alive);

  // EXE: winner name display or "No Winner" (DS:0x2CE6) when all dead
  // EXE: Vicious mode skips winner display entirely (guard at file 0x33FEC: cmp [DS:5188],1; jz skip)
  if (config.scoringMode !== SCORE_MODE.VICIOUS) {
    if (alive.length === 1) {
      drawTextShadow(104, 60, alive[0].name, alive[0].index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL, 0);
    } else {
      drawTextShadow(120, 60, 'No Winner', COLOR_HUD_TEXT, 0);
    }
  }

  // Show scores
  drawTextShadow(8, 80, 'Scores:', COLOR_HUD_HIGHLIGHT, 0);
  const board = getLeaderboard();
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    const color = p.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
    drawText(16, 92 + i * 10, `${p.name}: ${p.score}`, color);
  }

  // War quote — wrap to up to 5 lines (EXE quotes can be 190+ chars)
  if (game.warQuote) {
    const lineLen = 38;
    const maxLines = 5;
    for (let i = 0; i < maxLines; i++) {
      const chunk = game.warQuote.substring(i * lineLen, (i + 1) * lineLen);
      if (!chunk) break;
      drawTextShadow(8, 130 + i * 10, chunk, COLOR_HUD_TEXT, 0);
    }
  }

  // EXE: "%d of %d rounds fought." (DS:0x3002) + "%s rounds remain"/"1 round remains" (DS:0x2C1A/0x2C2B)
  const remaining = config.rounds - game.round;
  drawTextShadow(60, 170, `${game.round} of ${config.rounds} rounds fought.`, COLOR_HUD_TEXT, 0);
  if (remaining === 1) {
    drawTextShadow(60, 182, '1 round remains', COLOR_HUD_TEXT, 0);
  } else if (remaining > 1) {
    drawTextShadow(60, 182, `${remaining} rounds remain`, COLOR_HUD_TEXT, 0);
  }
  // EXE: "<<Press any key>>" (DS:0x5212)
  drawTextShadow(60, 194, '<<Press any key>>', COLOR_HUD_TEXT, 0);
}

function drawGameOver() {
  fillRect(0, 0, config.screenWidth - 1, config.screenHeight - 1, BLACK);

  // EXE: "Final Scoring" (DS:0x2A9F) — displayed after last round
  drawTextShadow(96, 20, 'Final Scoring', COLOR_HUD_HIGHLIGHT, 0);

  // Final leaderboard
  const board = getLeaderboard();
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    const color = p.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
    const medal = i === 0 ? '* ' : '  ';
    drawTextShadow(24, 50 + i * 14, `${medal}${p.name}`, color, 0);
    drawText(200, 50 + i * 14, `${p.score} pts`, COLOR_HUD_TEXT);
    drawText(270, 50 + i * 14, `${p.wins}W`, COLOR_HUD_TEXT);
  }

  // EXE: "<<Press any key>>" (DS:0x5212)
  drawTextShadow(60, 170, '<<Press any key>>', COLOR_HUD_TEXT, 0);
}

// MAYHEM cheat code tracker
// EXE: "mayhem" cheat code — sets all weapons to max ammo (verified in binary strings)
// EXE: also supports "frondheim" (debug overlay), "ragnarok" (debug log), "nofloat" (disable FPU)
const MAYHEM_SEQ = ['KeyM', 'KeyA', 'KeyY', 'KeyH', 'KeyE', 'KeyM'];
let mayhemIdx = 0;

function checkMayhemCheat() {
  // Check for keypress matching next character in sequence
  // We piggyback on the input system by checking the raw key events
  // This is handled via a global listener set up once
}

function gameLoop() {
  // --- Menu screens ---
  if (game.state === STATE.TITLE || game.state === STATE.CONFIG || game.state === STATE.PLAYER_SETUP) {
    // Menu always renders at 320×200 — reinit if returning from a higher-res game
    if (config.screenWidth !== 320 || config.screenHeight !== 200) {
      config.screenWidth = 320;
      config.screenHeight = 200;
      reinitFramebuffer();
      reinitTerrainBuffers();
      updateCSSAspect();
      initPalette(config.landType, config.skyType);
      initSkyBackground();
    }

    const result = menuTick();

    if (result === 'start_game') {
      startGame();
    } else if (result === 'title' || result === 'config') {
      game.state = STATE.CONFIG;
      drawMainMenu();
    } else if (result === 'player_setup') {
      game.state = STATE.PLAYER_SETUP;
      drawPlayerSetupScreen();
    }

    blit();
    requestAnimationFrame(gameLoop);
    return;
  }

  // Shop mode: draw shop UI instead of game world
  if (game.state === STATE.SHOP && isShopActive()) {
    gameTick();
    drawShop(players[game.shopPlayerIdx]);
    blit();
    requestAnimationFrame(gameLoop);
    return;
  }

  // Game over: draw final screen
  if (game.state === STATE.GAME_OVER) {
    gameTick();
    drawGameOver();
    blit();
    requestAnimationFrame(gameLoop);
    return;
  }

  // EXE: No Kibitzing — black screen between human turns
  if (game.state === STATE.SCREEN_HIDE) {
    gameTick();
    fillRect(0, 0, config.screenWidth - 1, config.screenHeight - 1, BLACK);
    // EXE: dialog at 0x43080 (34ED:77B0), paint at 0x4304B — draws "NO KIBITZING!!" via draw_embossed_text
    // EXE: no player name, no "press any key" in the dialog — web adds these for clarity
    const nkW = measureText('NO KIBITZING!!');
    drawTextShadow(Math.floor((config.screenWidth - nkW) / 2), 60, 'NO KIBITZING!!', COLOR_HUD_HIGHLIGHT, 0);
    const targetPlayer = players[game.screenHideTarget] || getCurrentPlayer();
    drawTextShadow(72, 80, `${targetPlayer.name}'s turn`, targetPlayer.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL, 0);
    // EXE: "<<Press any key>>" (DS:0x5212) — consistent with round-over/game-over
    drawTextShadow(72, 100, '<<Press any key>>', COLOR_HUD_TEXT, 0);
    blit();
    requestAnimationFrame(gameLoop);
    return;
  }

  // EXE: System menu (F9) — EXE title "System Menu" (DS:0x2B22)
  // EXE items: ~Clear Screen, ~Mass Kill, ~Quit Game, Reassign ~Players,
  //   Reassign ~Teams, Save ~Game, ~Restore Game, ~New Game
  if (game.state === STATE.SYSTEM_MENU) {
    gameTick();
    // Draw overlay on top of current world
    redrawWorld();
    // EXE: system menu uses full 3D dialog widget system (0x3F19:0x2577 add_item_list)
    // Same raised box + UI palette as shop/submenu dialogs
    const smOptions = SYSTEM_MENU_OPTIONS;
    // EXE: SI = 20 (FG_MAXY <= 200) or 24 (FG_MAXY > 200); web scales proportionally
    // EXE condition FG_MAXY > 200 = screenHeight > 201 = screenHeight >= 202
    const rowH = config.screenHeight >= 202 ? 24 : 20;
    // Auto-size dialog width based on content (matching menu.js submenu pattern)
    let maxW = measureText('System Menu');
    for (const opt of smOptions) maxW = Math.max(maxW, measureText(opt.label));
    const dlgW = maxW + 24;
    const dlgH = 30 + smOptions.length * rowH;
    const dlgX = Math.floor((config.screenWidth - dlgW) / 2);
    const dlgY = Math.floor((config.screenHeight - dlgH) / 2);

    // 3D raised dialog box (EXE: draw_3d_box at file 0x444BB)
    drawBox3DRaised(dlgX, dlgY, dlgW, dlgH, UI_BACKGROUND,
      UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);

    // Title
    const titleX = dlgX + Math.floor((dlgW - measureText('System Menu')) / 2);
    drawText(titleX, dlgY + 4, 'System Menu', UI_HIGHLIGHT);
    hline(dlgX + 4, dlgX + dlgW - 5, dlgY + 14, UI_MED_BORDER);

    // Items
    for (let i = 0; i < smOptions.length; i++) {
      const iy = dlgY + 18 + i * rowH;
      const opt = smOptions[i];
      const selected = i === game.systemMenuOption;
      const color = opt.disabled ? UI_MED_BORDER : (selected ? UI_HIGHLIGHT : UI_DARK_TEXT);
      if (selected && !opt.disabled) {
        fillRect(dlgX + 3, iy - 1, dlgX + dlgW - 4, iy + rowH - 3, UI_DEEP_SHADOW);
      }
      drawText(dlgX + 8, iy, opt.label, color);
    }

    // EXE: confirmation dialog overlay (DS:0x2C06, DS:0x2BC9, DS:0x2BDE)
    if (game.systemMenuConfirm) {
      const confY = dlgY + dlgH - 28;
      fillRect(dlgX + 3, confY, dlgX + dlgW - 4, dlgY + dlgH - 4, UI_BACKGROUND);
      drawText(dlgX + 8, confY + 2, game.systemMenuConfirm, UI_HIGHLIGHT);
      drawText(dlgX + 8, confY + 14, 'Y: Yes  N: No', UI_DARK_TEXT);
    } else {
      drawText(dlgX + 8, dlgY + dlgH - 12, 'ESC: Cancel', UI_MED_BORDER);
    }
    blit();
    requestAnimationFrame(gameLoop);
    return;
  }

  // 1. Redraw clean world FIRST (no HUD) so gameTick reads clean pixels
  redrawWorld();

  // 2. Game logic — reads clean framebuffer for collisions/terrain scanning
  gameTick();

  // 3. Overlays on top of game world
  const player = getCurrentPlayer();
  const hudOpts = {
    guided: game.guidedActive,
    aimTimer: game.aimTimer > 0 ? Math.ceil(game.aimTimer / 60) : 0,
  };
  drawHud(player, game.wind, game.round, hudOpts);
  // EXE: draw_wind_indicator only in Sequential mode (file 0x307B2: cmp [5188],0 jnz skip)
  if (config.playMode === 0) drawWindIndicator(game.wind);
  drawAllProjectiles();

  // EXE VERIFIED: laser drawn during AIM phase only (draw_laser_sight at 0x36321)
  if ((game.state === STATE.AIM || game.state === STATE.SYNC_AIM) && player.alive) {
    drawLaserSight(player);
  }

  // Tank death animations
  drawDeathAnimations();

  // Shield break animation overlay
  drawShieldBreak();

  // Talking tanks speech bubble overlay
  drawSpeechBubble();



  if (game.state === STATE.ROUND_OVER) {
    drawRoundOver();
  }

  // EXE: screen flash on large explosions (nukes) — fill with white
  if (screenFlash.active) {
    fillRect(0, 0, config.screenWidth - 1, config.screenHeight - 1, COLOR_HUD_HIGHLIGHT);
    screenFlash.frames--;
    if (screenFlash.frames <= 0) screenFlash.active = false;
  }

  blit();

  requestAnimationFrame(gameLoop);
}

// Init sound on first user gesture (browser autoplay policy)
window.addEventListener('keydown', () => initSound(), { once: true });
window.addEventListener('click', () => initSound(), { once: true });
window.addEventListener('touchstart', () => initSound(), { once: true });

// Game states where H-key toggle and cheat codes should work
// (not during TITLE, CONFIG, PLAYER_SETUP where keys are used for menus/name entry)
const GAMEPLAY_STATES = new Set([
  STATE.AIM, STATE.FLIGHT, STATE.EXPLOSION, STATE.FALLING,
  STATE.NEXT_TURN, STATE.ROUND_OVER, STATE.SHOP, STATE.ROUND_SETUP,
  STATE.GAME_OVER, STATE.SYNC_AIM, STATE.SYNC_FIRE,
  STATE.SCREEN_HIDE, STATE.SYSTEM_MENU,
]);

// H key: toggle sound (gameplay only — not during menu/name entry)
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyH' && GAMEPLAY_STATES.has(game.state)) toggleSound();
});

// MAYHEM cheat: global key listener for the sequence (gameplay only)
// EXE VERIFIED: sets ALL weapon types to 99 unconditionally (RE doc line 516)
window.addEventListener('keydown', (e) => {
  if (!GAMEPLAY_STATES.has(game.state)) { mayhemIdx = 0; return; }
  if (e.code === MAYHEM_SEQ[mayhemIdx]) {
    mayhemIdx++;
    if (mayhemIdx >= MAYHEM_SEQ.length) {
      mayhemIdx = 0;
      // EXE: sets ALL weapon types to 99 unconditionally
      for (const p of players) {
        for (let w = 2; w < p.inventory.length; w++) {
          p.inventory[w] = 99;
        }
      }
    }
  } else {
    mayhemIdx = e.code === MAYHEM_SEQ[0] ? 1 : 0;
  }
});

init();
