// DPRO CAR02 R64 — REVEW ONLY. Pure client-side validation of a mock quote.
// Never represents server-side authorization or proof of customer consent.
export const R64_REVIEW_MAX_ITEMS = 10;
export function reviewCar02QuoteR64(quote) {
  const bad={ok:false,code:'CAR02_QUOTE_REVIEW_INVALID'};
  if(!quote||typeof quote!=='object'||Array.isArray(quote)||
     !Number.isSafeInteger(quote.revision)||quote.revision<1||
     !Array.isArray(quote.items)||quote.items.length<1||quote.items.length>R64_REVIEW_MAX_ITEMS)
    return bad;
  const items=[];
  for(const row of quote.items){
    if(!row||typeof row!=='object'||Array.isArray(row)||
       typeof row.name!=='string'||!row.name.trim()||row.name.length>160||
       !Number.isSafeInteger(row.price)||row.price<0||row.price>100_000_000)return bad;
    items.push({name:row.name.trim(),price:row.price});
  }
  const subtotal=items.reduce((a,b)=>a+b.price,0);
  const tax=Math.floor(subtotal/10);
  const total=subtotal+tax;
  if(![subtotal,tax,total].every(Number.isSafeInteger)||
      quote.subtotal!==subtotal||quote.tax!==tax||quote.total!==total)return bad;
  return {ok:true,revision:quote.revision,items,subtotal,tax,total};
}
export function quoteApprovalKeyR64(quote,expectedVersion){
  const review=reviewCar02QuoteR64(quote);
  if(!review.ok||!Number.isSafeInteger(expectedVersion)||expectedVersion<1)return null;
  // Only in-browser mock fingerprint; not a cryptographic signature or auth token.
  return JSON.stringify([expectedVersion,review.revision,review.items.map(x=>[x.name,x.price]),review.subtotal,review.tax,review.total]);
}
