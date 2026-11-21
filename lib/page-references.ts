export function requestedPages(question:string){
 const result=new Set<number>();
 const numberText=question.normalize('NFKC').replace(/[零〇一二两三四五六七八九十百千]+/g,token=>{
   const digits='零一二三四五六七八九';let total=0,value=0;
   for(const c of token){const unit=({十:10,百:100,千:1000} as Record<string,number>)[c];if(unit){total+=(value||1)*unit;value=0;}else value=value*10+(c==='两'?2:c==='〇'?0:digits.indexOf(c));}
   return String(total+value);
 });
 const normalized=numberText.replace(/(\d)\s*页\s*([至到\-–~])\s*第?\s*(?=\d)/g,'$1$2');
 for(const match of normalized.matchAll(/(?:第\s*)?(\d+(?:\s*[、,，至到\-–~和及]\s*\d+)*)\s*页/g)){
  for(const part of match[1].split(/[、,，和及]/)){
   const pair=part.trim().split(/[至到\-–~]/).map(Number);
   if(pair.some(n=>!Number.isSafeInteger(n)||n<1))throw Error('请输入有效的页码。');
   const end=pair[1]??pair[0];if(end<pair[0]||end-pair[0]>7)throw Error('每次最多引用 8 页，请分次提问。');
   for(let offset=0;offset<=end-pair[0];offset++)result.add(pair[0]+offset);
  }
 }
 if(result.size>8)throw Error('每次最多引用 8 页。');
 return [...result];
}
