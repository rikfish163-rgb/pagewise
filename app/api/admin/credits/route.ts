import {env} from 'cloudflare:workers';
import {getSiteAccount} from '@/app/site-account';
import {handleAdminCredits} from '@/server/admin-credits';

export const dynamic='force-dynamic';

function handle(request:Request) {
  return handleAdminCredits(request,env.DB,getSiteAccount);
}

export {handle as GET,handle as POST};
