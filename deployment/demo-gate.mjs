import { registrationRestricted } from '../server/registration-eligibility.mjs';
// Public map with account-derived identity for private contribution routes.
// Old hosting identity headers never establish an account session.
import { accessConfiguration, authenticateAccess, stripIdentityHeaders } from './access-identity.mjs';
import { handleMapAccount, mapAccountsReady, mapSession } from './map-accounts.mjs';
import { contributorCredits, contributorRoster, publishedEdits, publishedRecordPage } from '../server/published-edits.mjs';
import { pendingPlaces } from '../server/pending-places.mjs';
const privateJson = (value, status = 200) => Response.json(value, { status, headers: {
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'
} });
export function createDemoWorker(handler, registration, authenticate = authenticateAccess) {
  return {
    async fetch(request, env, ctx) {
      const rawPath = new URL(request.url).pathname;
      let path = rawPath;
      try {
        for(let i=0;i<4;i++){const decoded=decodeURIComponent(path);if(decoded===path)break;path=decoded;}
      } catch { return new Response('Invalid path',{status:400}); }
      path=path.replace(/\/+/g,'/').toLowerCase();
      const mapEnabled = mapAccountsReady(env);
      if (rawPath === '/api/registration-policy' && ['GET','HEAD'].includes(request.method)) {
        const response = privateJson({ restricted: registrationRestricted(env) });
        return request.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response;
      }
      if (['/api/published-edits','/api/published-records'].includes(rawPath) && ['GET','HEAD'].includes(request.method) ) {
        try {
          const query=new URL(request.url).searchParams;if([...query.keys()].some(key=>key!=='after')||query.getAll('after').length>1||rawPath==='/api/published-edits'&&query.size||query.has('after')&&!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(query.get('after')))return privateJson({error:'invalid_page'},400);
          const data = rawPath==='/api/published-edits'?{items:await publishedEdits(env.DB)}:await publishedRecordPage(env.DB,query.get('after')||'');
          return request.method === 'HEAD' ? new Response(null, {headers:{'Cache-Control':'no-store'}}) : privateJson(data);
        } catch { return privateJson({error:'feed_unavailable'},503); }
      }
      if (rawPath === '/api/contributor-credits' && ['GET','HEAD'].includes(request.method)) {
        if (new URL(request.url).search) return privateJson({error:'invalid_page'},400);
        try {
          const data = await contributorCredits(env.DB);
          return request.method === 'HEAD' ? new Response(null, {headers:{'Cache-Control':'no-store'}}) : privateJson(data);
        } catch { return privateJson({error:'feed_unavailable'},503); }
      }
      // Registrant names are for signed-in map accounts only.
      if (rawPath === '/api/contributor-roster' && ['GET','HEAD'].includes(request.method)) {
        if (new URL(request.url).search) return privateJson({error:'invalid_page'},400);
        let viewer;
        try { viewer = mapEnabled ? await mapSession(request, env) : null; } catch { return privateJson({error:'account_unavailable'},503); }
        if (!viewer) return privateJson({error:'sign_in_required'},401);
        try {
          const data = await contributorRoster(env.DB);
          return request.method === 'HEAD' ? new Response(null, {headers:{'Cache-Control':'private, no-store'}}) : Response.json(data, {headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
        } catch { return privateJson({error:'feed_unavailable'},503); }
      }
      // Places sent for review are public as their own map layer, before any decision.
      if (rawPath === '/api/pending-places' && ['GET','HEAD'].includes(request.method)) {
        if (new URL(request.url).search) return privateJson({error:'invalid_page'},400);
        try {
          const data = await pendingPlaces(env.DB);
          return request.method === 'HEAD' ? new Response(null, {headers:{'Cache-Control':'no-store'}}) : privateJson(data);
        } catch { return privateJson({error:'feed_unavailable'},503); }
      }
      if (path === '/api/auth' || path.startsWith('/api/auth/')) {
        if (rawPath !== path) return privateJson({error:'invalid_path'},400);
        return handleMapAccount(request, env);
      }
      // CUNY Login was withdrawn. An obsolete enable setting must never
      // activate that adapter or fall back to another identity provider.
      const withdrawnIdentity = env?.CONTRIBUTIONS_CUNY_ENABLED === 'true';
      if (rawPath === '/api/access-status' && ['GET','HEAD'].includes(request.method)) {
        const enabled = mapEnabled || (!withdrawnIdentity && Boolean(accessConfiguration(env)));
        const response = privateJson({ enabled, sign_in_url: enabled ? '/api/contributions/sign-in' : null, ...(mapEnabled ? {account_mode:'map'} : {}), dashboard_enabled: false });
        return request.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response;
      }
      // Legacy session cookies, headers and owner names cannot open obsolete
      // authentication or attendee routes.
      if (path === '/auth' || path.startsWith('/auth/') || path === '/api/admin/registrations') {
        return privateJson({error:'sign_in_required'},401);
      }
      if(path==='/data/source-inventory.json')return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
      // Only event registration has a public write endpoint. Review and map
      // contribution APIs keep their existing authentication boundary.
      if(path==='/api/register'&&registration)return registration(request,env);
      // Only exact contribution routes can use verified identity. Encoded,
      // repeated, case-folded and bare API paths stay closed.
      if (rawPath === path && /^\/api\/contributions\/[a-z][a-z0-9-]*$/.test(rawPath)) {
        if (rawPath === '/api/contributions/sign-in' && mapEnabled && ['GET','HEAD'].includes(request.method)) return new Response(null, {status:303,headers:{Location:'/#sign-in','Cache-Control':'no-store'}});
        let actor;
        try { actor = mapEnabled ? (await mapSession(request, env))?.actor_id : withdrawnIdentity ? null : await authenticate(request, env); }
        catch { return privateJson({error:'account_unavailable'},503); }
        if (actor) {
          // A tab can retain a draft while another tab changes the session.
          // This assertion binds its write to the expected account; it never grants identity.
          const expectedActor=request.headers.get('X-Hauntologies-Actor');
          if(!['GET','HEAD'].includes(request.method)&&expectedActor&&expectedActor!==actor)return privateJson({error:'account_changed'},409);
          if (rawPath === '/api/contributions/sign-in' || rawPath === '/api/contributions/session') {
            if (!['GET','HEAD'].includes(request.method)) return new Response(null, { status:405, headers:{Allow:'GET, HEAD','Cache-Control':'no-store'} });
            if (rawPath.endsWith('/sign-in')) return new Response(null, { status:303, headers:{Location:'/', 'Cache-Control':'no-store'} });
            const response = Response.json({ actor_id:actor }, { headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'} });
            return request.method === 'HEAD' ? new Response(null, { headers:response.headers }) : response;
          }
          const headers = stripIdentityHeaders(request);
          headers.delete('X-Hauntologies-Actor');
          headers.delete('cookie');
          headers.set('oai-authenticated-user-id', actor);
          const response = await handler.fetch(new Request(request, { headers }), env, ctx);
          const privateHeaders = new Headers(response.headers);
          const isPrivate = (response.headers.get('Cache-Control') || '').split(',').some(value => value.trim().toLowerCase() === 'private');
          privateHeaders.set('Cache-Control', isPrivate ? 'private, no-store' : 'no-store');
          return new Response(response.body, { status: response.status, statusText: response.statusText, headers: privateHeaders });
        }
      }
      if (!['GET','HEAD'].includes(request.method) || path === '/api' || path.startsWith('/api/')) {
        return Response.json({error:'sign_in_required'}, {
          status:401,
          headers:{'Cache-Control':'no-store'}
        });
      }
      const headers = stripIdentityHeaders(request);
      return handler.fetch(new Request(request,{headers}),env,ctx);
    }
  };
}
