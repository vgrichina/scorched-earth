import {WPN} from './weapons.js';

// Native 0x22714..0x2279C runs on integer samples of the projectile line.
// It tests exact X equality, even when a physics step crosses many columns.
export function triggerVerticalGuidance(projectile,x,y) {
  if (projectile.guidanceType!==WPN.VERT_GUIDANCE || !projectile.guidanceTarget ||
      x!==projectile.guidanceTarget.x) return false;
  projectile.guidanceType=0;
  projectile.guidanceAttraction=true;
  projectile.guidanceCorrX=0;
  projectile.guidanceCorrY=projectile.guidanceTarget.y>y?-1:1;
  return true;
}
