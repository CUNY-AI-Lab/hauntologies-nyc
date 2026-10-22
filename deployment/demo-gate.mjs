// The demo can serve the map after a sharing decision. APIs remain closed until
// verified identity is configured; old hosting identity headers are never trusted.
import { accessConfiguration, authenticateAccess, stripIdentityHeaders } from './access-identity.mjs';
import { cunyIdentity } from './cuny-identity.mjs';
const privateJson = (value, status = 200) => Response.json(value, { status, headers: {
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'
} });
const readMethod = request => ['GET','HEAD'].includes(request.method);
export function createDemoWorker(handler, registration, authenticate = authenticateAccess, { cuny = cunyIdentity, registrationDashboard } = {}) {
  return {
    async fetch(request, env, ctx) {
      const rawPath = new URL(request.url).pathname;
      let path = rawPath;
      try {
        for(let i=0;i<4;i++){const decoded=decodeURIComponent(path);if(decoded===path)break;path=decoded;}
      } catch { return new Response('Invalid path',{status:400}); }
      path=path.replace(/\/+/g,'/').toLowerCase();
      const useCuny = env?.CONTRIBUTIONS_CUNY_ENABLED === 'true';
      // No automatic fallback from a configured CUNY receiver to another login
      // method. The owner subject is an explicit server setting, never a name.
      if (rawPath === '/api/access-status' && ['GET','HEAD'].includes(request.method)) {
        const readiness = await cuny.readiness(env);
        const enabled = useCuny ? readiness.ownerConfigured : Boolean(accessConfiguration(env));
        const response = privateJson({ enabled, sign_in_url: enabled ? '/api/contributions/sign-in' : null, dashboard_enabled: useCuny && readiness.ownerConfigured });
        return request.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response;
      }
      if (path === '/auth' || path.startsWith('/auth/')) {
        if (!useCuny || rawPath !== path) return privateJson({error:'sign_in_required'},401);
        if (rawPath === '/auth/session') {
          if (!readMethod(request)) return new Response(null,{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
          const principal = await cuny.authenticate(request,env);
          if (!principal) return privateJson({error:'sign_in_required'},401);
          // Only the signed-in person's own verified subject; this grants no
          // dashboard, review or publication rights and never returns tokens.
          const response = privateJson({subject:principal.subject,actor_id:principal.actor_id});
          return request.method === 'HEAD' ? new Response(null,{headers:response.headers}) : response;
        }
        return await cuny.handleAuth(request,env) || privateJson({error:'not_found'},404);
      }
      if (rawPath === '/api/admin/registrations') {
        if (!useCuny || !registrationDashboard) return privateJson({error:'sign_in_required'},401);
        const principal = await cuny.authenticate(request,env);
        if (!principal) return privateJson({error:'sign_in_required'},401);
        if (!cuny.isOwner(principal,env)) return privateJson({error:'not_authorized'},403);
        return registrationDashboard(request,{DB:env.DB,principal,ownerSubject:env.CONTRIBUTIONS_CUNY_OWNER_SUBJECT});
      }
      if(path==='/data/source-inventory.json')return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
      // Only event registration has a public write endpoint. Review and map
      // contribution APIs keep their existing authentication boundary.
      if(path==='/api/register'&&registration)return registration(request,env);
      // Only exact contribution routes can use verified identity. Encoded,
      // repeated, case-folded and bare API paths stay closed.
      if (rawPath === path && /^\/api\/contributions\/[a-z][a-z0-9-]*$/.test(rawPath)) {
        if (useCuny && rawPath === '/api/contributions/sign-in') {
          if (!readMethod(request)) return new Response(null,{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
          if (!(await cuny.readiness(env)).ownerConfigured) return privateJson({error:'sign_in_required'},401);
          return new Response(null,{status:303,headers:{Location:'/auth/start?returnTo=%2F','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
        }
        const principal = useCuny ? await cuny.authenticate(request,env) : null;
        if (useCuny && principal && !cuny.isOwner(principal,env)) return privateJson({error:'not_authorized'},403);
        const actor = useCuny ? principal?.actor_id : await authenticate(request, env);
        if (actor) {
          if (rawPath === '/api/contributions/sign-in' || rawPath === '/api/contributions/session') {
            if (!['GET','HEAD'].includes(request.method)) return new Response(null, { status:405, headers:{Allow:'GET, HEAD','Cache-Control':'no-store'} });
            if (rawPath.endsWith('/sign-in')) return new Response(null, { status:303, headers:{Location:'/', 'Cache-Control':'no-store'} });
            const response = Response.json({ actor_id:actor }, { headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'} });
            return request.method === 'HEAD' ? new Response(null, { headers:response.headers }) : response;
          }
          const headers = stripIdentityHeaders(request);
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
