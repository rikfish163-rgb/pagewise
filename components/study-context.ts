import type {Selection} from '../lib/workspace-model';
type ReaderLocation={page:number;scrollTop:number;anchorPage:number;fraction:number;layout:'continuous'|'single';zoom:number};
export type PageReader = {
 count:number;
 read:(page:number,includeImage?:boolean)=>Promise<Selection>;
 getLocation:()=>ReaderLocation;
 restoreLocation:(location:ReaderLocation)=>void;
};

export function isOverview(question:string){
 return /大纲|提纲|纲要|概览|全文|整份|整篇|全书|整本|知识框架|主要(内容|讲了什么)|总结.{0,10}(课件|讲义|资料|文档|ppt)|(?:课件|讲义|资料|文档|ppt).{0,8}(总结|讲了什么)/i.test(question);
}

function evenlySpaced(count:number,limit:number){
 const length=Math.min(count,limit);
 return Array.from({length},(_,i)=>length===1?1:1+Math.round(i*(count-1)/(length-1)));
}

export async function documentOverview(reader:PageReader){
 const pages=evenlySpaced(reader.count,120);
 const budget=Math.floor(30000/pages.length);
 const summary=[`资料共 ${reader.count} 页，以下为 ${pages.length} 页的正文摘录。`];
 const scanned:number[]=[];
 for(const n of pages){
   const page=await reader.read(n,false);
   if(page.text?.trim())summary.push(`第 ${n} 页：${page.text.trim().slice(0,budget)}`);
   else scanned.push(n);
 }
 const images:Selection[]=[];
 for(const i of evenlySpaced(scanned.length,6))images.push(await reader.read(scanned[i-1]));
 if(scanned.length)summary.push(`${scanned.length} 个抽取页面无可读文字，附代表页：${images.map(s=>s.page).join('、')}。请标明覆盖范围。`);
 return {text:summary.join('\n'),images};
}
export { requestedPages } from '../lib/page-references.ts';
export async function combineImages(sources:string[]){
 if(!sources.length)return undefined;
 const images=await Promise.all(sources.map(async src=>{const im=new Image();im.src=src;await im.decode();return im}));
 const width=Math.min(1400,Math.max(...images.map(i=>i.naturalWidth)));
 const heights=images.map(i=>Math.min(1500,Math.round(i.naturalHeight*Math.min(1,width/i.naturalWidth))));
 const total=heights.reduce((a,b)=>a+b,0);const scale=Math.min(1,6800/total);
 const canvas=document.createElement('canvas');canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(total*scale);
 const ctx=canvas.getContext('2d')!;ctx.scale(scale,scale);ctx.fillStyle='white';ctx.fillRect(0,0,width,total);let y=0;
 images.forEach((im,i)=>{ctx.drawImage(im,0,y,im.naturalWidth*heights[i]/im.naturalHeight,heights[i]);y+=heights[i]});
 const encoded=canvas.toDataURL('image/jpeg',.78);if(encoded.length>2750000)throw Error('图片过大，请分次发送。');return encoded;
}
