// EXE 0x2589C: attraction callback, shared by Heat and vertical guidance.
// Velocity Y uses the native upward-positive convention.
export function guidanceAttractionStep(p,target,signX,signY,mode,dt) {
  const dx=target.x-p.x,dy=p.y-target.y;
  const passed=(dx<0 && signX<0)||(dx>0 && signX>0)||
    (dy<0 && signY>0)||(dy>0 && signY<0);
  if(passed) return {action:mode===1?'explode':'disable',vx:p.vx,vy:p.vy};
  const distanceSq=dx*dx+dy*dy;
  if(distanceSq<0.001) return {action:'continue',vx:p.vx,vy:p.vy};
  const correction=10000*dt/Math.sqrt(Math.sqrt(distanceSq));
  return {action:'continue',vx:p.vx+correction*dx,vy:p.vy+correction*dy};
}
