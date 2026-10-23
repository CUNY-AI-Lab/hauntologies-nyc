// The demo can serve the map after a sharing decision. APIs remain closed until
// verified identity is configured; old hosting identity headers are never trusted.
import { accessConfiguration, authenticateAccess, stripIdentityHeaders } from './access-identity.mjs';
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
      // CUNY Login was withdrawn. An obsolete enable setting must never
      // activate that adapter or fall back to another identity provider.
      const withdrawnIdentity = env?.CONTRIBUTIONS_CUNY_ENABLED === 'true';
      if (rawPath === '/api/access-status' && ['GET','HEAD'].includes(request.method)) {
        const enabled = !withdrawnIdentity && Boolean(accessConfiguration(env));
        const response = privateJson({ enabled, sign_in_url: enabled ? '/api/contributions/sign-in' : null, dashboard_enabled: false });
        return request.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response;
      }
      // Replacement map accounts are not activated. Legacy session cookies,
      // headers and owner names cannot open authentication or attendee routes.
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
        const actor = withdrawnIdentity ? null : await authenticate(request, env);
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
