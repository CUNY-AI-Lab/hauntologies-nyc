// The demo can serve the map after a sharing decision. APIs remain closed until
// verified identity is configured; old hosting identity headers are never trusted.
import { authenticateAccess, stripIdentityHeaders } from './access-identity.mjs';
export function createDemoWorker(handler, registration, authenticate = authenticateAccess) {
  return {
    async fetch(request, env, ctx) {
      const rawPath = new URL(request.url).pathname;
      let path = rawPath;
      try {
        for(let i=0;i<4;i++){const decoded=decodeURIComponent(path);if(decoded===path)break;path=decoded;}
      } catch { return new Response('Invalid path',{status:400}); }
      path=path.replace(/\/+/g,'/').toLowerCase();
      if(path==='/data/source-inventory.json')return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
      // Only event registration has a public write endpoint. Review and map
      // contribution APIs keep their existing authentication boundary.
      if(path==='/api/register'&&registration)return registration(request,env);
      // Only exact contribution routes can use verified identity. Encoded,
      // repeated, case-folded and bare API paths stay closed.
      if (rawPath === path && /^\/api\/contributions\/[a-z][a-z0-9-]*$/.test(rawPath)) {
        const actor = await authenticate(request, env);
        if (actor) {
          const headers = stripIdentityHeaders(request);
          headers.set('oai-authenticated-user-id', actor);
          const response = await handler.fetch(new Request(request, { headers }), env, ctx);
          const privateHeaders = new Headers(response.headers);
          privateHeaders.set('Cache-Control', 'no-store');
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
