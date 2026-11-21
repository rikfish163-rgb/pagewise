import {redirect} from 'next/navigation';
import Workspace from '@/components/Workspace';
import {getSiteAccount} from './site-account';

export const dynamic='force-dynamic';

export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const account=await getSiteAccount();
  if(!account){
    const query=await searchParams;
    const params=new URLSearchParams();
    for(const key of ['document','discussion','page']){
      const value=query[key];
      if(typeof value==='string'&&value.length<=100)params.set(key,value);
    }
    const target=params.size?'/?'+params+'#reader':'/';
    redirect('/login?return_to='+encodeURIComponent(target));
  }
  return <Workspace showAdmin={account.admin} accountSource={account.source}/>;
}
