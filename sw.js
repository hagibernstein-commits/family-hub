const CACHE='family-hub-1.0.0';
const ROOT=new URL('./',self.location.href).href;
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./gatekeeper.js'].map(p=>new URL(p,ROOT).href);
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('family-hub-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.origin!==self.location.origin||!u.href.startsWith(ROOT))return;
 if(u.pathname.endsWith('/gatekeeper.js')){e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c2=r.clone();caches.open(CACHE).then(c=>c.put(e.request,c2))}return r}).catch(()=>caches.match(e.request)));return}
 if(e.request.mode==='navigate'||u.pathname.endsWith('/manifest.webmanifest')){e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put((e.request.mode==='navigate'?new URL('./index.html',ROOT).href:e.request.url),copy))}return r}).catch(()=>caches.match(e.request.mode==='navigate'?new URL('./index.html',ROOT).href:e.request.url)));return}
 e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request)))
});
