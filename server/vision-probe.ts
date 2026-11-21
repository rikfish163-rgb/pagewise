import {deflateSync} from 'node:zlib';
import {askPersonal,type PersonalProfile} from './personal-api.ts';
function chunk(type:string,data:Buffer){
 const body=Buffer.concat([Buffer.from(type),data]),size=Buffer.alloc(4),sum=Buffer.alloc(4);
 size.writeUInt32BE(data.length);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,body,sum]);
}
export function challenge(){
 const colors=[['红',220,30,35],['绿',20,180,55],['蓝',20,75,230],['黄',250,220,15],['黑',15,15,15],['白',250,250,250]] as const;
 const sequence=Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>colors[n%colors.length]);
 const width=240,height=48,row=Buffer.alloc(1+width*3,0);
 for(let x=0;x<width;x++){const c=sequence[Math.floor(x/40)];for(let i=0;i<3;i++)row[1+x*3+i]=(x%40===0||x%40===39)?130:Number(c[i+1]);}
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(Array(height).fill(row)))),chunk('IEND',Buffer.alloc(0))]);
 return {image:'data:image/png;base64,'+png.toString('base64'),expected:sequence.map(c=>c[0]).join('')};
}
export async function probeVision(p:PersonalProfile,ask=askPersonal){
 const test=challenge();try{
 const result=await ask({...p,vision:true},{image:test.image,history:[],memories:[],question:'图中从左到右有六个等宽色格，可重复。每格用红、绿、蓝、黄、黑、白之一表示。只输出这六个汉字，不加解释。'});
 return result.replace(/[\s，,。、.]/g,'')===test.expected;
 }catch{return false;}
}
