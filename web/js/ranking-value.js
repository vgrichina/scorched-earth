// Native player ranking value 0x31379: Greedy uses cash and resale value.
import {config} from './config.js';
import {WEAPONS} from './weapons.js';
import {getMarketPrice} from './shop.js';
import {playerCash} from './cash.js';

export function playerRankingValue(player) {
  if(config.scoringMode!==2)return player.score;
  let value=playerCash(player);
  // Native item 0 (Baby Missile) is excluded, as are nonpositive quantities.
  // Convert each item's valuation separately, using the current market price.
  for(let i=3;i<WEAPONS.length;i++) {
    const quantity=player.inventory?.[i]??0;
    if(quantity>0)value+=Math.trunc(quantity*getMarketPrice(i)/WEAPONS[i].bundle*0.8);
  }
  return value;
}
