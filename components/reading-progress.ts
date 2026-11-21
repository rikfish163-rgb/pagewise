export type ReadingProgress={page:number;anchorPage:number;fraction:number};
const key=(documentId:string)=>'pagewise:position:'+documentId;

export function readProgress(documentId:string):ReadingProgress|null{
  try{
    const value=JSON.parse(localStorage.getItem(key(documentId))??'null');
    if(value && Number.isSafeInteger(value.page)&&value.page>0
      &&Number.isSafeInteger(value.anchorPage)&&value.anchorPage>0
      &&Number.isFinite(value.fraction)&&value.fraction>=0&&value.fraction<=1)return value;
  }catch{ /* Reading can continue when storage is unavailable. */ }
  return null;
}

export function saveProgress(documentId:string,progress:ReadingProgress){
  try{
    localStorage.setItem(key(documentId),JSON.stringify(progress));
    window.dispatchEvent(new Event('pagewise:reading-progress'));
  }catch{ /* Reading can continue when storage is unavailable. */ }
}

export function subscribeReadingProgress(onChange:()=>void){
  window.addEventListener('storage',onChange);
  window.addEventListener('pagewise:reading-progress',onChange);
  return ()=>{
    window.removeEventListener('storage',onChange);
    window.removeEventListener('pagewise:reading-progress',onChange);
  };
}

export function recentReader(documentId?:string){
  try{
    const key='pagewise:active-reader';
    if(documentId)localStorage.setItem(key,documentId);
    return localStorage.getItem(key);
  }catch{return null;}
}
