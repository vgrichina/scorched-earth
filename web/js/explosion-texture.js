import { random } from './utils.js';
import { config, GRAPHICS_MODES } from './config.js';

// Native 0x2F111 / 0x2F2F6 / 0x2F451: recursive midpoint texture.
export function generateExplosionTexture(width,height,colors=40) {
  if(width*height>65535)return null;
  const pixels=new Uint8Array(width*height);
  const at=(x,y)=>y*width+x;
  pixels[0]=random(colors);pixels[width-1]=random(colors);
  pixels[(height-1)*width]=random(colors);pixels[width*height-1]=random(colors);
  function edge(x1,y1,x,y,x2,y2) {
    if(pixels[at(x,y)]!==0)return;
    const distance=Math.abs(x1-x2)+Math.abs(y1-y2);
    const value=random(distance*2)-distance+((pixels[at(x1,y1)]+pixels[at(x2,y2)]+1)>>1);
    pixels[at(x,y)]=Math.max(0,Math.min(colors-1,value));
  }
  function subdivide(x1,y1,x2,y2) {
    if(x2-x1<2&&y2-y1<2)return;
    const x=(x1+x2)>>1,y=(y1+y2)>>1;
    edge(x1,y1,x,y1,x2,y1);edge(x2,y1,x2,y,x2,y2);
    edge(x1,y2,x,y2,x2,y2);edge(x1,y1,x1,y,x1,y2);
    pixels[at(x,y)]=(pixels[at(x1,y1)]+pixels[at(x2,y1)]+pixels[at(x2,y2)]+pixels[at(x1,y2)]+2)>>2;
    subdivide(x1,y1,x,y);subdivide(x,y1,x2,y);
    subdivide(x,y,x2,y2);subdivide(x1,y,x,y2);
  }
  subdivide(0,0,width-1,height-1);
  return pixels;
}

export const explosionTextureCache={radius:-1,width:0,height:0,pixels:null};

// Native setup 0x2B57F..0x2B617 caches by scaled Nuke radius, even if
// the 64KB bitmap allocation fails. A changed radius rebuilds the texture.
export function prepareExplosionTexture() {
  // Native 0x2B619: release an existing bitmap and invalidate its radius.
  // A failed allocation has no bitmap, so its cached radius is retained.
  if(config.smallMemory) {
    if(explosionTextureCache.pixels) {
      explosionTextureCache.pixels=null;
      explosionTextureCache.radius=-1;
    }
    return;
  }
  const scale=(config.screenWidth===320?[0.5,0.75,1]:[1,2,3])[config.explosionScale];
  const radius=Math.trunc(75*scale);
  if(explosionTextureCache.radius===radius)return;
  const activeMode=GRAPHICS_MODES.find(m=>m.w===config.screenWidth&&m.h===config.screenHeight);
  const aspect=(activeMode??GRAPHICS_MODES[config.graphicsMode]).displayAspect;
  const sx=aspect<1?Math.trunc(aspect*65536):65536;
  const sy=aspect>1?Math.trunc(65536/aspect):65536;
  const width=Math.floor(radius*sx/65536)-Math.floor(-radius*sx/65536)+1;
  const height=Math.floor(radius*sy/65536)-Math.floor(-radius*sy/65536)+1;
  Object.assign(explosionTextureCache,{radius,width,height,pixels:generateExplosionTexture(width,height)});
}
