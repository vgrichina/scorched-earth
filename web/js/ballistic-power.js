// EXE 0x254E9: shared ballistic-guidance/AI solver. Angle is the native
// global angle (+0x32), not the direction-relative barrel angle (+0x92).
// Return the possibly adjusted angle as well as signed AX; callers own HUD updates.
export function ballisticPower(tank, target, angle, wind, gravity, strict = false) {
  const signed16 = n => (n << 16) >> 16;
  const direction = angle < 90 ? 1 : angle > 90 ? -1 : tank.direction;
  for (;;) {
    let w = wind / 2000, g = gravity;
    let theta = (angle > 90 ? 180 - angle : angle) * 0.017453293;
    const muzzleY = signed16(tank.y + tank.barrelYOff) - Math.sin(theta) * tank.barrelLen;
    const muzzleX = signed16(tank.x + direction * tank.barrelXOff)
      + Math.cos(angle * 0.017453293) * tank.barrelLen;
    let dx = target.x - muzzleX, dy = muzzleY - target.y;
    if (dx < 0) { dx = -dx; w = -w; }
    dx /= 0.55;
    if (w !== 0 && dx !== 0) {
      const phi = Math.atan(w / g);
      const alpha = Math.atan(dy / dx) - phi;
      const radius = Math.sqrt(dx * dx + dy * dy);
      g = Math.sqrt(g * g + w * w);
      theta -= phi;
      dx = Math.cos(alpha) * radius;
      dy = Math.sin(alpha) * radius;
    }
    const cos = Math.cos(theta);
    // Software-FPU runtime path (DS:BE30 < 3). Do not substitute sin/cos:
    // rounding at a horizontal shot can change the exact-zero retry below.
    const denominator = (Math.tan(theta) * dx - dy) * (2 * (cos * cos));
    if (denominator === 0) {
      if (strict) return { power: -2, angle };
      angle = signed16(angle + 1);
      continue;
    }
    let speedSq = g * dx * dx / denominator;
    if (speedSq < 0) {
      if (strict) return { power: -1, angle };
      speedSq = -speedSq;
    }
    const power = Math.sqrt(speedSq) * 50;
    if (strict && power > tank.energy * 10) return { power: -1, angle };
    return { power: signed16(Math.trunc(power)), angle };
  }
}
