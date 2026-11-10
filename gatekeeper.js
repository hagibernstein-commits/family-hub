/* מרכז בקרה משפחתי - שומר שער לאפליקציות ילדים | Family Control gatekeeper v1 */
(function(){
'use strict';
if(window.__gkLoaded)return;window.__gkLoaded=true;
var API='https://kvdb.io/NxA2jTKKEfbo8mJpDN6gkU';
var APP=(document.currentScript&&document.currentScript.getAttribute('data-app'))||'';
var HEART=45000,RECHECK=30000,CFG_FAILOPEN_AFTER=10*60*1000;
var S={kid:sessionStorage.getItem('gk_kid')||'',cfg:null,cfgAt:0,used:0,bonus:0,blocked:false,reason:'',remainLocal:null};

function enc(p){return p.split('/').map(encodeURIComponent).join('/');}
function get(k){return fetch(API+'/'+enc(k),{cache:'no-store'}).then(function(r){return r.ok?r.text():'';}).catch(function(){return '';});}
function set(k,v){return fetch(API+'/'+enc(k),{method:'POST',body:String(v)}).catch(function(){});}
function incr(k,d){return fetch(API+'/'+enc(k),{method:'PATCH',body:(d>=0?'+':'')+d}).then(function(r){if(!r.ok)return set(k,d);}).catch(function(){});}
function dayKey(){var d=new Date();return d.getFullYear()+('0'+(d.getMonth()+1)).slice(-2)+('0'+d.getDate()).slice(-2);}
function nowMin(){var d=new Date();return d.getHours()*60+d.getMinutes();}
function toMin(s){var p=String(s||'').split(':');return (+p[0])*60+(+p[1]||0);}

function loadCfg(force){
  var fresh=S.cfg&&(Date.now()-S.cfgAt<CFG_FAILOPEN_AFTER);
  return get('cfg').then(function(t){
    if(t){try{S.cfg=JSON.parse(t);S.cfgAt=Date.now();}catch(e){}}
    else if(!fresh)S.cfg=null;
    return S.cfg;
  });
}
function findApp(cfg){if(!cfg||!cfg.apps)return null;for(var i=0;i<cfg.apps.length;i++)if(cfg.apps[i].id===APP)return cfg.apps[i];return null;}
function allowance(cfg){var m=cfg.defaultMin||30;if(cfg.overrides&&cfg.overrides[S.kid])m=cfg.overrides[S.kid];return m*60+(S.bonus||0);}
function evaluate(){
  var cfg=S.cfg;if(!cfg)return null; /* fail open */
  var app=findApp(cfg);
  if(app&&app.enabled===false)return 'disabled';
  if(cfg.pauseUntil&&Date.now()<cfg.pauseUntil)return 'paused';
  var wS=toMin(cfg.windowStart||'13:00'),wE=toMin(cfg.windowEnd||'20:30'),n=nowMin();
  if(n<wS||n>wE)return 'window';
  if(S.used>=allowance(cfg))return 'limit';
  return null;
}
function msgs(r){
  var cfg=S.cfg||{};
  if(r==='disabled')return {t:'המשחק הזה לא זמין עכשיו 🌙',s:'אפשר לשחק במשחק אחר, או לבקש מההורים להפעיל אותו שוב'};
  if(r==='paused')return {t:'ההורים לחצו על הפסקה ✋',s:'כשהם יפעילו מחדש, אפשר יהיה להמשיך לשחק'};
  if(r==='window')return {t:'עכשיו לא זמן משחק 🙂',s:'אפשר לשחק בין '+(cfg.windowStart||'13:00')+' ל-'+(cfg.windowEnd||'20:30')};
  if(r==='limit')return {t:'נגמר הזמן להיום! ⏰',s:'עשית היום הרבה - מחר יהיו עוד דקות משחק'};
  return {t:'',s:''};
}

var OV=null,PILL=null;
function mk(tag,st,html){var e=document.createElement(tag);e.style.cssText=st;if(html!=null)e.innerHTML=html;return e;}
function showBlock(reason){
  S.blocked=true;S.reason=reason;hidePill();
  if(OV)return; 
  var m=msgs(reason);
  OV=mk('div','position:fixed;inset:0;z-index:2147483000;background:linear-gradient(160deg,#1e2a5a,#3b2f6e);display:flex;flex-direction:column;align-items:center;justify-content:center;direction:rtl;text-align:center;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#fff;padding:24px;');
  OV.appendChild(mk('div','font-size:72px;margin-bottom:8px;','🎮'));
  OV.appendChild(mk('div','font-size:26px;font-weight:800;margin-bottom:10px;',m.t));
  OV.appendChild(mk('div','font-size:17px;opacity:.85;max-width:300px;line-height:1.5;',m.s));
  document.documentElement.appendChild(OV);
  document.body&&document.body.style.setProperty('overflow','hidden');
}
function hideBlock(){S.blocked=false;if(OV){OV.remove();OV=null;}document.body&&document.body.style.removeProperty('overflow');}
function showPicker(){
  if(OV)return;
  var cfg=S.cfg,kids=(cfg&&cfg.kids&&cfg.kids.length?cfg.kids:['זיו','יהל','אלון','אריאל']);
  OV=mk('div','position:fixed;inset:0;z-index:2147483000;background:linear-gradient(160deg,#0f3d2e,#1e2a5a);display:flex;flex-direction:column;align-items:center;justify-content:center;direction:rtl;text-align:center;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#fff;padding:24px;');
  OV.appendChild(mk('div','font-size:60px;margin-bottom:6px;','🕹️'));
  OV.appendChild(mk('div','font-size:26px;font-weight:800;margin-bottom:18px;','מי משחק עכשיו?'));
  var row=mk('div','display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:340px;');
  kids.forEach(function(k){
    var b=mk('button','font-size:20px;font-weight:700;padding:14px 26px;border:none;border-radius:999px;background:#ffd166;color:#222;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.35);font-family:inherit;',k);
    b.onclick=function(){S.kid=k;sessionStorage.setItem('gk_kid',k);hideBlock();boot();};
    row.appendChild(b);
  });
  OV.appendChild(row);
  document.documentElement.appendChild(OV);
}
function showPill(){
  if(PILL||S.blocked)return;
  PILL=mk('div','position:fixed;bottom:10px;inset-inline-start:10px;z-index:2147482999;background:rgba(20,20,40,.82);color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;direction:rtl;font-size:13px;font-weight:700;padding:6px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer;','');
  PILL.title='החלפת שחקן';
  PILL.onclick=function(){sessionStorage.removeItem('gk_kid');S.kid='';hidePill();showPicker();};
  document.documentElement.appendChild(PILL);tickPill();
}
function hidePill(){if(PILL){PILL.remove();PILL=null;}}
function tickPill(){
  if(!PILL||!S.cfg)return;
  var left=Math.max(0,Math.floor((allowance(S.cfg)-S.used)/60));
  PILL.textContent=S.kid+' • נותרו '+left+' דקות';
  PILL.style.background=left<=5?'rgba(160,30,40,.9)':'rgba(20,20,40,.82)';
}

function beat(){
  if(document.visibilityState!=='visible'||!S.kid||S.blocked)return;
  var d=dayKey();
  incr('u/'+d+'/'+S.kid,HEART/1000);
  incr('ua/'+d+'/'+S.kid+'/'+APP,HEART/1000);
  set('live/'+S.kid,JSON.stringify({app:APP,ts:Date.now()}));
  S.used+=HEART/1000;tickPill();
}
function loop(){
  loadCfg().then(function(cfg){
    if(!S.kid){showPicker();return;}
    if(!cfg){hideBlock();return;} /* fail open */
    var r=evaluate();
    if(r){showBlock(r);}else{hideBlock();showPill();}
  });
}
function boot(){
  if(!S.kid){loadCfg().then(function(){showPicker();});return;}
  var d=dayKey();
  Promise.all([get('u/'+d+'/'+S.kid),get('b/'+d+'/'+S.kid)]).then(function(v){
    S.used=parseInt(v[0],10)||0;S.bonus=parseInt(v[1],10)||0;
    loadCfg(true).then(function(){
      var r=evaluate();
      if(r)showBlock(r);else{hideBlock();showPill();}
    });
  });
}
set('seen/'+APP,Date.now());
setInterval(loop,RECHECK);
setInterval(beat,HEART);
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')loop();});
boot();
})();
