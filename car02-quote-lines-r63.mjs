// DPRO CAR02 R63 / REVIEW ONLY — quote line validation; no network, no storage.
// Business API's item schema is unchanged. R63's UI limit is 10 rows for readability.
export const R63_MAX_ITEMS=10;
export const R63_MAX_YEN_PER_LINE=100_000_000;
export function validateQuoteRowsR63(rows){
  if(!Array.isArray(rows)||rows.length<1||rows.length>R63_MAX_ITEMS)
    return {ok:false,index:-1,field:'rows',message:'見積項目は1～10件にしてください。'};
  const items=[];
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    const name=typeof row?.name==='string'?row.name.trim():'';
    if(!name||name.length>160)
      return {ok:false,index:i,field:'name',message:`${i+1}件目の作業名称を1～160文字で入力してください。`};
    const raw=typeof row?.price==='string'?row.price.trim():'';
    if(!/^(?:0|[1-9][0-9]*)$/.test(raw))
      return {ok:false,index:i,field:'price',message:`${i+1}件目の金額は0円以上1億円以下の整数で入力してください。`};
    const price=Number(raw);
    if(!Number.isSafeInteger(price)||price>R63_MAX_YEN_PER_LINE)
      return {ok:false,index:i,field:'price',message:`${i+1}件目の金額は0円以上1億円以下の整数で入力してください。`};
    items.push({name,price});
  }
  const subtotal=items.reduce((n,x)=>n+x.price,0);
  // Integer calculation, truncate fractional yen once for the entire illustrative quote.
  const tax=Math.floor(subtotal/10);
  return {ok:true,items,subtotal,tax,total:subtotal+tax};
}
