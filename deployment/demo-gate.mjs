// The demo can serve the map after a sharing decision. APIs remain closed until
// verified identity is configured; old hosting identity headers are never trusted.
export function createDemoWorker(handler, registration) {
  return {
    async fetch(request, env, ctx) {
      let path = new URL(request.url).pathname;
      try {
        for(let i=0;i<4;i++){const decoded=decodeURIComponent(path);if(decoded===path)break;path=decoded;}
      } catch { return new Response('Invalid path',{status:400}); }
      path=path.replace(/\/+/g,'/').toLowerCase();
      if(path==='/data/source-inventory.json')return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
      // Only event registration has a public write endpoint. Review and map
      // contribution APIs keep their existing authentication boundary.
      if(path==='/api/register'&&registration)return registration(request,env);
      if (!['GET','HEAD'].includes(request.method) || path === '/api' || path.startsWith('/api/')) {
        return Response.json({error:'sign_in_required'}, {
          status:401,
          headers:{'Cache-Control':'no-store'}
        });
      }
      const headers = new Headers(request.headers);
      for (const name of [...headers.keys()]) {
        if (name.startsWith('oai-authenticated-')) headers.delete(name);
      }
      return handler.fetch(new Request(request,{headers}),env,ctx);
    }
  };
}
