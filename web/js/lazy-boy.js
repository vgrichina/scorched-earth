// Native Lazy Boy callback 0x25037..0x25250: choose one pixel movement.
// Caller handles digging, collisions, drawing and the dt-based movement budget.
export function lazyBoyRouteStep(x,y,target,referenceIndex,top,readPixel) {
  let dx=target.x-x,dy=target.y-y;
  const scale=Math.max(Math.abs(dx),Math.abs(dy));
  if(scale===0) return {atTarget:true};
  dx/=scale;dy/=scale;
  const ix=Math.trunc(x),iy=Math.trunc(y);
  let stepX=Math.trunc(x+dx)-ix,stepY=Math.trunc(y+dy)-iy;
  let nextX=Math.trunc(x+dx),nextY=Math.trunc(y+dy);
  if(stepX===0 && stepY===0) return {dx,dy,stepX,stepY,nextX,nextY,subpixel:true};
  const matches=pixel=>referenceIndex!==null && Math.trunc(pixel/8)===referenceIndex;
  let pixel=readPixel(nextX,nextY);
  if(pixel<105 && !matches(pixel)) {
    if(stepX!==0) {
      if(iy===top) {stepY=0;dy=0;}
      else {dx=0;dy=-1;stepX=0;stepY=-1;}
      nextX=ix+stepX;nextY=iy+stepY;
      pixel=readPixel(nextX,nextY);
      // The fallback test is strictly >105; the primary test above is >=105.
      if(pixel>105 || matches(pixel)) return {dx,dy,stepX,stepY,nextX,nextY,pixel,blocked:false};
    }
    return {dx,dy,stepX,stepY,nextX,nextY,pixel,blocked:true};
  }
  return {dx,dy,stepX,stepY,nextX,nextY,pixel,blocked:false};
}

// Execute a callback's movement budget. Yield side effects in native order so
// rendering/terrain/collision adapters can update readPixel before continuation.
// Coordinates remain local until normal completion, matching 0x25491..0x254DF.
export function* lazyBoyMovement(projectile,dt,readPixel,top=38) {
  let x=projectile.x,y=projectile.y;
  let ix=Math.trunc(x),iy=Math.trunc(y);
  let shieldHit=false;
  const hitTank=pixel=>{
    if(pixel%8===5) shieldHit=true;
    return !(Math.trunc(pixel/8)===projectile.attackerIdx && shieldHit);
  };
  for(let budget=dt*500;budget>0;budget-=1) {
    const step=lazyBoyRouteStep(x,y,projectile.target,projectile.referenceIndex,top,readPixel);
    if(step.atTarget) return {completed:false};
    if(step.subpixel) {x+=step.dx;y+=step.dy;continue;}
    if(step.blocked) {
      if(step.pixel<80 && hitTank(step.pixel)) {
        yield {kind:'erase'};
        yield {kind:'hit',x:ix,y:iy,pixel:step.pixel};
        return {completed:false};
      }
      yield {kind:'dig',x:ix+step.stepX,y:iy+step.stepY};
    }
    x+=step.dx;y+=step.dy;ix+=step.stepX;iy+=step.stepY;
    yield {kind:'velocity',dx:step.stepX,dy:step.stepY};
    const pixel=readPixel(ix,iy);
    if(pixel<80) {
      if(hitTank(pixel)) {
        yield {kind:'hit',x:ix,y:iy,pixel};
        return {completed:false};
      }
      shieldHit=false;
    }
    if(ix===projectile.target.x && iy===projectile.target.y) {
      yield {kind:'hit',x:ix,y:iy,pixel};
      return {completed:false};
    }
    yield {kind:'draw',x:ix,y:iy};
  }
  return {completed:true,x,y,ix,iy};
}
