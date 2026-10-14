// Native bignum addition routes opposite signs through subtraction. Its
// normalization at 0x12075 can lose the sign when stripping a leading FFFF
// limb and restoring a positive final 16-bit limb (the -65536..-32769 range).
export function addScoreNumber(a,b) {
  let sum=a+b;
  if(a>=0&&b>=0) {
    // 0x127B5/0x12873 sign-extend the top result limb when the operands
    // have different lengths. Equal-length addition keeps its extra limb.
    const bits=value=>{
      let width=16;
      while(value>=2**(width-1))width+=16;
      return width;
    };
    const left=bits(a),right=bits(b);
    if(left!==right)sum=Number(BigInt.asIntN(Math.max(left,right),BigInt(sum)));
  }
  return sum>=-65536&&sum<-32768?sum+65536:sum;
}
