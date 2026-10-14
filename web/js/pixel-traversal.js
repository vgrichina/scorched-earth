// Native 0x1CFC7 rectangle visitation. This local LFSR is independent of the
// gameplay RNG; (0,0) is deliberately visited last. Masks are from DS:0B28.
const masks=[0,0,0x3,0x6,0xc,0x14,0x30,0x60,0xb8,0x110,0x240,0x500,
  0xca0,0x1b00,0x3500,0x6000,0xb400,0x12000,0x20400,0x72000,
  0x90000,0x140000,0x300000,0x400000,0xd80000,0x1200000,0x3880000,
  0x7200000,0x9000000,0x14000000,0x32800000,0x48000000,0xa3000000];

export function* rectanglePixelOrder(width,height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width<1 || height<1 || width>32767 || height>32767)
    throw new RangeError('Rectangle dimensions must be positive signed 16-bit integers');
  const xBits=32-Math.clz32(width),yBits=32-Math.clz32(height);
  const mask=masks[xBits+yBits],yMask=(1<<yBits)-1;
  let value=1;
  do {
    const x=value>>>yBits,y=value&yMask;
    if (x<width && y<height) yield [x,y];
    value=((value>>>1)^((value&1)?mask:0))>>>0;
  } while (value!==1);
  yield [0,0];
}
