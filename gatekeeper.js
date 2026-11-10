/* Shared family controls. Browser-level enforcement. Supports offline play from a
   server-reserved lease ("שמורת זמן"): minutes deducted from the daily allowance in
   advance, spent offline, and reconciled on the next connection. */
(()=>{'use strict';const script=document.currentScript,app=script?.dataset.app;if(!app)return;const ROOT='https://hagibernstein-commits.github.io/family-hub/',URL='https://ypteevcdbcotgyrezuqq.supabase.co',KEY='sb_publishable_A9baxa9MiXjEBGUup4mPGQ_tXqJL2rI',session=crypto.randomUUID();let overlay,kids=[],kid=localStorage.getItem('fc_kid_v1'),token=localStorage.getItem('fc_device_v1'),running=false,choosing=false,lastOk=0,remain=0,offline=false,limitReleased=false,lastLeaseTry=0,lastSave=0,dirty=false;
const LKEY='fc_lease_v2';
let leases={};try{leases=JSON.parse(localStorage.getItem(LKEY))||{};}catch(e){leases={};}
let lease=kid&&leases[kid]?leases[kid]:null;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&quot;','"':'&quot;',"'":'&#39;'}[c]));
function saveLeases(){try{localStorage.setItem(LKEY,JSON.stringify(leases));}catch(e){}lastSave=Date.now();dirty=false;}
function refreshLease(){lease=kid&&leases[kid]?leases[kid]:null;}
function clearLease(){if(kid&&leases[kid])delete leases[kid];lease=null;saveLeases();}
function leaseLeft(){return lease?Math.max(0,lease.seconds-lease.consumed):0;}
function israelHM(d){try{const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);return p;}catch(e){return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}}
function windowOk(){if(!lease)return false;const hm=israelHM(new Date());return hm>=lease.start&&hm<lease.end;}
function clockTampered(){const w=Date.now();if(lease&&w<(lease.maxWall||0)-120000)return true;if(lease){lease.maxWall=Math.max(w,lease.maxWall||0);}return false;}
function leaseValid(){return !!(lease&&lease.id&&leaseLeft()>0&&Date.now()<lease.expiresAt);}
async function call(active=false,child=kid){const r=await fetch(URL+'/rest/v1/rpc/fc_gate',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({token,kid_id:child||null,app_id:child?app:null,session_id:session,active}),signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('network');return r.json();}
async function leaseCall(o){const r=await fetch(URL+'/rest/v1/rpc/fc_lease',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({token,kid_id:kid,app_id:app,settle:o.settle??null,release:!!o.release,want:null}),signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('network');return r.json();}
async function releaseLease(){refreshLease();if(!lease)return;try{await leaseCall({settle:lease.consumed,release:true});}catch(e){}clearLease();}
async function syncLease(r){refreshLease();const now=Date.now();
 if(r.lease_enabled===false){if(lease)await releaseLease();return;}
 const want=(r.lease_minutes||10)*60;
 const stale=lease&&(now>lease.expiresAt-30*60e3);
 const low=lease&&leaseLeft()<lease.seconds*0.5;
 if((!lease||stale||low||lease.consumed>0)&&r.remaining>60&&now-lastLeaseTry>60e3){lastLeaseTry=now;
  try{const res=await leaseCall({settle:lease?lease.consumed:null});
   if(res&&res.ok&&res.lease){leases[kid]={id:res.lease.id,seconds:Number(res.lease.seconds),consumed:0,expiresAt:Date.parse(res.lease.expires_at),start:String(res.start).slice(0,5),end:String(res.end).slice(0,5),maxWall:now,name:r.name};saveLeases();refreshLease();}
   else if(res&&res.reason==='off'){clearLease();}
  }catch(e){}
 }}
function mount(){if(overlay)return;overlay=document.createElement('div');overlay.id='family-control-overlay';overlay.dir='rtl';overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#f5f3eb;color:#173c39;display:flex;align-items:center;justify-content:center;padding:24px;font:17px Arial,sans-serif;overflow:auto';document.documentElement.appendChild(overlay);}
function block(title,text,picker=false){mount();document.getElementById('family-control-prelock')?.remove();running=false;offline=false;overlay.style.display='flex';overlay.innerHTML='<section style="max-width:410px;text-align:center;background:white;border:1px solid #dce3d5;border-radius:26px;padding:30px;width:100%"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M12 22V12M12 15C3 15 2 8 3 4c7 0 10 4 9 11ZM12 11c0-7 5-10 10-9 0 7-4 10-10 9Z"/></svg><h1 style="font-size:27px;line-height:1.25">'+esc(title)+'</h1><p style="line-height:1.8">'+esc(text)+'</p>'+(picker?'<label for="fc-child">מי משחקים?</label><select id="fc-child" style="display:block;width:100%;padding:14px;margin:15px 0;border:1px solid #becbbf;border-radius:12px;font:inherit">'+kids.map(k=>'<option value="'+k.id+'"'+(kid===k.id?' selected':'')+'>'+esc(k.name)+'</option>').join('')+'</select><button id="fc-start" style="border:0;background:#173c39;color:white;border-radius:12px;padding:14px 26px;font:inherit">מתחילים</button>':'')+'<p><a href="'+ROOT+'" style="color:#326d56">למרכז המשפחתי</a></p></section>';document.querySelectorAll('audio,video').forEach(m=>m.pause());if(picker){choosing=true;document.getElementById('fc-start').onclick=()=>{choosing=false;kid=document.getElementById('fc-child').value;localStorage.setItem('fc_kid_v1',kid);refreshLease();offline=false;tick();};}}
function pillText(){if(offline&&lease)return(lease.name||'')+' · אופליין '+Math.ceil(leaseLeft()/60)+' דק׳';return(lease&&lease.name||'')+' · '+Math.ceil(remain/60)+' דק׳';}
function allow(r){document.getElementById('family-control-prelock')?.remove();remain=Number(r.remaining);lastOk=Date.now();running=true;overlay.style.display='none';pill.textContent=(r.name||'')+' · '+Math.ceil(remain/60)+' דק׳';pill.style.display='block';if(lease)lease.name=r.name;}
function allowOffline(){document.getElementById('family-control-prelock')?.remove();running=true;offline=true;lastOk=Date.now();overlay.style.display='none';pill.textContent=pillText();pill.style.display='block';}
function tryOffline(){refreshLease();if(!leaseValid()||clockTampered())return false;if(!windowOk())return false;allowOffline();return true;}
const pill=document.createElement('button');pill.title='החלפת שחקן';pill.style.cssText='position:fixed;bottom:8px;left:8px;z-index:2147483646;background:#173c39;color:white;border:1px solid #9bb59e;border-radius:18px;padding:8px 12px;font:12px Arial,sans-serif;box-shadow:0 2px 12px #0003';pill.onclick=async()=>{try{await call(false);}catch(e){}block('מי משחקים עכשיו?','בוחרים את הפרופיל כדי לשמור על הזמן של כל אחד.',true);};document.documentElement.appendChild(pill);pill.style.display='none';
const messages={paused:['זמן להפסקה ביחד','ההורים עצרו כרגע את המשחקים. אפשר לחזור כשיתנו אור ירוק.'],disabled:['המשחק בהפסקה','האפליקציה הזו אינה זמינה עכשיו. אפשר לבחור משהו אחר עם ההורים.'],window:['עכשיו זמן לדברים אחרים','אפשר לשחק בשעות המותרות שקבעו ההורים.'],limit:['כל הכבוד על היום!','זמן המשחק היומי הסתיים. מחר מחכה התחלה חדשה.']};let inFlight=false;
async function tick(retried){if(inFlight||choosing)return;inFlight=true;try{token=localStorage.getItem('fc_device_v1');if(!token){pill.style.display='none';block('מצרפים את המכשיר לבית','פותחים את המרכז המשפחתי ומבקשים מהורה לצרף את המכשיר באמצעות קוד QR.');return;}if(!kids.length){const r=await call(false,null);kids=r.kids;if(!kids.some(k=>k.id===kid)){kid=null;block('ברוכים הבאים!','בוחרים מי משחקים, והזמן משותף לכל המשחקים.',true);return;}}if(!kid)return;const r=await call(!document.hidden&&!offline&&document.hasFocus());
 if(r.ok){offline=false;allow(r);syncLease(r).catch(()=>{});}
 else{offline=false;const m=messages[r.reason]||['נחזור בעוד רגע','המשחק לא זמין כרגע.'];
  refreshLease();
  if(r.reason==='limit'&&lease&&leaseLeft()>0&&!retried){limitReleased=true;await releaseLease();inFlight=false;return tick(true);}
  if((r.reason==='paused'||r.reason==='disabled'||r.reason==='window')&&lease){releaseLease();}
  pill.style.display='none';block(m[0],r.reason==='window'?'זמן המשחק הוא בין '+r.start.slice(0,5)+' ל־'+r.end.slice(0,5)+' לפי שעון ישראל.':m[1]);}}catch(e){if(tryOffline())return;pill.style.display='none';block('בודקים את החיבור','כדי לשמור על זמן המשחק צריך חיבור לאינטרנט. ננסה שוב בעוד כמה שניות.');}finally{inFlight=false;}}
block('רגע לפני שמתחילים','בודקים את זמן המשחק המשפחתי…');tick();setInterval(tick,10000);
let lastMono=performance.now();
setInterval(()=>{const now=performance.now(),dt=(now-lastMono)/1000;lastMono=now;
 if(running&&!offline&&Date.now()-lastOk>12000){if(!tryOffline()){pill.style.display='none';block('בודקים את החיבור','ממתינים לאישור זמן עדכני מהמרכז המשפחתי.');}return;}
 if(offline&&running&&lease){
  if(clockTampered()){clearLease();pill.style.display='none';block('השעון צריך אימות','כדי להמשיך לשחק בלי אינטרנט השעון במכשיר צריך להיות מדויק. מתחברים לאינטרנט ומנסים שוב.');return;}
  if(!document.hidden&&document.hasFocus()){lease.consumed=Math.min(lease.seconds,lease.consumed+Math.max(0,dt));dirty=true;}
  if(!windowOk()){pill.style.display='none';block(messages.window[0],'זמן המשחק הוא בין '+lease.start+' ל־'+lease.end+' לפי שעון ישראל.');return;}
  if(leaseLeft()<=0){pill.style.display='none';block('הזמן השמור נגמר','הדקות שנשמרו למשחק בלי אינטרנט נוצלו. חיבור קצר לאינטרנט יאפשר להמשיך.');saveLeases();return;}
  pill.textContent=pillText();
  if(dirty&&Date.now()-lastSave>5000)saveLeases();
 }},1000);
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(offline&&dirty)saveLeases();call(false).catch(()=>{});}else{block('רגע לפני שממשיכים','בודקים את זמן המשחק…');tick();}});
window.addEventListener('pagehide',()=>{if(offline&&dirty)saveLeases();fetch(URL+'/rest/v1/rpc/fc_gate',{method:'POST',keepalive:true,headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({token,kid_id:kid,app_id:app,session_id:session,active:false})}).catch(()=>{});});
window.addEventListener('storage',e=>{if(e.key==='fc_kid_v1'){kid=e.newValue;refreshLease();offline=false;tick();}if(e.key==='fc_device_v1'){token=e.newValue;kids=[];refreshLease();tick();}});
})();
