export type WorkspaceRoute = {document?: string; discussion?: string; page?: number};

const ID = /^[A-Za-z0-9._:-]{1,100}$/;

function cleanId(value: string | null): string | undefined {
  return value && ID.test(value) ? value : undefined;
}

/** Read the copyable reader location. Unknown or hostile values are ignored. */
export function parseWorkspaceRoute(search: string): WorkspaceRoute {
  const params = new URLSearchParams(search.split('#')[0]);
  const document = cleanId(params.get('document'));
  const discussion = cleanId(params.get('discussion'));
  const rawPage = Number(params.get('page'));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 100000 ? rawPage : undefined;
  return {
    ...(document ? {document} : {}),
    ...(discussion ? {discussion} : {}),
    ...(page ? {page} : {}),
  };
}

/** Keep document, discussion and page in the address bar instead of stripping them. */
export function workspaceRouteUrl(base: {pathname: string; hash?: string}, route: WorkspaceRoute): string {
  const params = new URLSearchParams();
  if (route.document && ID.test(route.document)) params.set('document', route.document);
  if (route.discussion && ID.test(route.discussion)) params.set('discussion', route.discussion);
  if (route.page && Number.isSafeInteger(route.page) && route.page > 0) params.set('page', String(route.page));
  const query = params.toString();
  return `${base.pathname}${query ? `?${query}` : ''}${base.hash ?? ''}`;
}
