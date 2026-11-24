// Intentionally network-only: never retain quotes, private pages or credentials.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(fetch(e.request).catch(()=>new Response('Sin conexión. No se muestran cotizaciones antiguas.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));});
