import http from 'node:http';
import { randomInt } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb } from './db.js';
import { randomToken, shortCode, secureEqual, hashPin, verifyPin } from './tokens.js';
import { createJobs } from './jobs.js';
import { createNotifier } from './notify.js';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' };
const fail = (status, error, message = error.replaceAll('_',' ')) => Object.assign(new Error(message), {status,error});
const iso = d => new Date(d).toISOString();
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);

export function createServer({ db = openDb(), now = () => new Date(), notify, startJobs = true } = {}) {
  if (!notify) { const ready=createNotifier({db}); notify=async(target,message)=>(await ready).notify(target,message); }
  const streams = new Map();
  const limits = new Map();
  const jobs = createJobs({db,now,notify});
  const q = (sql,...args) => db.prepare(sql).get(...args);
  const all = (sql,...args) => db.prepare(sql).all(...args);
  const run = (sql,...args) => db.prepare(sql).run(...args);
  const current = () => iso(now());
  const send = (res,status,data,headers={}) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); res.end(JSON.stringify(data)); };
  const parse = async req => {
    let raw='';
    for await (const part of req) { raw += part; if(raw.length>65536) throw fail(413,'too_large'); }
    if(!raw) return {};
    try { const value=JSON.parse(raw); if(!value || Array.isArray(value) || typeof value!=='object') throw Error(); return value; }
    catch { throw fail(400,'invalid_json'); }
  };
  const field = (v,max=1000) => typeof v==='string' && v.trim() && v.length<=max;
  const getEvent = id => q('SELECT * FROM events WHERE id=?',id) || (()=>{throw fail(404,'event_not_found')})();
  const getBand = token => q('SELECT * FROM bands WHERE token=?',token) || (()=>{throw fail(404,'band_not_found')})();
  const getDevice = req => {
    const match = (req.headers.cookie||'').match(/(?:^|;\s*)hb_device=([^;]+)/);
    if(!match) return null;
    try{return decodeURIComponent(match[1]);}catch{throw fail(400,'invalid_cookie');}
  };
  const device = req => {
    const id=getDevice(req);
    if(!id || !q('SELECT id FROM devices WHERE id=?',id)) throw fail(401,'guest_required');
    run('UPDATE devices SET lastSeenAt=? WHERE id=?',current(),id);
    return id;
  };
  const guestBand = (req,token) => {
    const id=device(req), band=getBand(token);
    if(!band.deviceId || !secureEqual(id,band.deviceId)) throw fail(403,'band_linked_elsewhere');
    return {id,band};
  };
  const admin = (req,id) => {
    const event=getEvent(id), pin=req.headers['x-admin-pin'];
    if(typeof pin!=='string' || !verifyPin(pin,event.adminPinHash)) throw fail(403,'admin_required');
    return event;
  };
  const monitor = (req,url,query=false) => {
    const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const token=query ? url.searchParams.get('token') : bearer;
    if(!token) throw fail(401,'monitor_required');
    const sessions=all('SELECT * FROM monitor_sessions');
    const session=sessions.find(s=>secureEqual(s.token,token));
    if(!session) throw fail(403,'monitor_required');
    return session;
  };
  const rate = (key,max,windowMs) => {
    const time=now().getTime(), old=(limits.get(key)||[]).filter(t=>time-t<windowMs);
    if(old.length>=max) throw fail(429,'rate_limited');
    old.push(time); limits.set(key,old);
  };
  const inside = token => q('SELECT direction FROM presence WHERE bandToken=? ORDER BY at DESC,id DESC LIMIT 1',token)?.direction==='in';
  const insideCount = eventId => q("SELECT COUNT(*) n FROM bands b WHERE b.eventId=? AND (SELECT direction FROM presence p WHERE p.bandToken=b.token ORDER BY at DESC,id DESC LIMIT 1)='in'",eventId).n;
  const stats = eventId => ({bands:q('SELECT COUNT(*) n FROM bands WHERE eventId=?',eventId).n,inside:insideCount(eventId),entered:q("SELECT COUNT(*) n FROM presence WHERE eventId=? AND direction='in'",eventId).n,exited:q("SELECT COUNT(*) n FROM presence WHERE eventId=? AND direction='out'",eventId).n,openHelp:q("SELECT COUNT(*) n FROM help_requests WHERE eventId=? AND status!='resolved'",eventId).n});
  const publicEvent = e => ({id:e.id,name:e.name,org:e.org,startsAt:e.startsAt,endsAt:e.endsAt,capacity:e.capacity,createdAt:e.createdAt});
  const publicHelp = h => ({id:h.id,bandShortCode:h.bandShortCode,note:h.note,location:h.location,createdAt:h.createdAt,status:h.status,ackBy:h.ackBy,resolvedAt:h.resolvedAt,resolution:h.resolution});
  const publicDeparture = d => ({id:d.id,leftAt:d.leftAt,leavingWith:d.leavingWith,destination:d.destination,expectedHomeAt:d.expectedHomeAt,status:d.status,homeAt:d.homeAt});
  const audit = (eventId,action,detail={}) => run('INSERT INTO audit (id,eventId,actor,action,at,detail) VALUES (?,?,?,?,?,?)',randomToken(),eventId,'organizer',action,current(),JSON.stringify(detail));
  const emit = (eventId,type,data) => { for(const res of streams.get(eventId)||[]) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
  const emitStats = eventId => { const s=stats(eventId); emit(eventId,'stats',{inside:s.inside,entered:s.entered,exited:s.exited}); };
  const notifyCircle = async (tokens,message) => { for(const circleToken of tokens) await notify({type:'circle',circleToken},message); };
  const shared = d => { try{return JSON.parse(d.sharedWith||'[]');}catch{return [];} };

  async function api(req,res,url) {
    const p=url.pathname, method=req.method;
    let m;
    if(method==='POST' && p==='/api/events') {
      const b=await parse(req);
      if(!field(b.name,120)||!field(b.org,120)||!Number.isFinite(Date.parse(b.startsAt))||!Number.isFinite(Date.parse(b.endsAt))||Date.parse(b.endsAt)<=Date.parse(b.startsAt)|| (b.capacity!==undefined && (!Number.isInteger(b.capacity)||b.capacity<1))) throw fail(400,'invalid_event');
      const id=randomToken(), pin=String(randomInt(100000000)).padStart(8,'0'), code=shortCode()+shortCode().slice(0,2), at=current();
      run('INSERT INTO events (id,name,org,startsAt,endsAt,capacity,adminPinHash,monitorCode,retentionHours,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)',id,b.name.trim(),b.org.trim(),iso(b.startsAt),iso(b.endsAt),b.capacity??null,hashPin(pin),code,48,at);
      audit(id,'event_created');
      return send(res,201,{eventId:id,adminPin:pin,monitorCode:code});
    }
    if((m=p.match(/^\/api\/events\/([^/]+)\/monitor-session$/)) && method==='POST') {
      const event=getEvent(m[1]), b=await parse(req);
      if(!field(b.monitorCode,6)||!secureEqual(event.monitorCode,b.monitorCode)||!field(b.name,80)) throw fail(403,'invalid_monitor_code');
      const token=randomToken(); run('INSERT INTO monitor_sessions (token,eventId,name,createdAt) VALUES (?,?,?,?)',token,event.id,b.name.trim(),current());
      return send(res,200,{monitorToken:token,event:{id:event.id,name:event.name}});
    }
    if((m=p.match(/^\/api\/events\/([^/]+)\/bands\.csv$/)) && method==='GET') {
      admin(req,m[1]); const rows=all('SELECT token,shortCode FROM bands WHERE eventId=? ORDER BY createdAt,shortCode',m[1]);
      const base=`${req.headers['x-forwarded-proto']==='https'?'https':req.socket.encrypted?'https':'http'}://${req.headers.host}`;
      res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Cache-Control':'no-store'});
      return res.end('shortCode,url\r\n'+rows.map(b=>`${b.shortCode},${base}/b/${b.token}\r\n`).join(''));
    }
    if((m=p.match(/^\/api\/events\/([^/]+)\/bands$/)) && method==='POST') {
      admin(req,m[1]); const b=await parse(req);
      if(!Number.isInteger(b.count)||b.count<1||b.count>2000) throw fail(400,'invalid_count');
      const base=`${req.headers['x-forwarded-proto']==='https'?'https':req.socket.encrypted?'https':'http'}://${req.headers.host}`;
      const bands=[]; const insert=db.prepare('INSERT INTO bands (token,eventId,shortCode,deviceId,displayName,createdAt) VALUES (?,?,?,?,?,?)');
      for(let i=0;i<b.count;i++) { let code; do {code=shortCode();} while(q('SELECT token FROM bands WHERE eventId=? AND shortCode=?',m[1],code)); const token=randomToken(); insert.run(token,m[1],code,null,null,current()); bands.push({token,shortCode:code,url:`${base}/b/${token}`}); }
      audit(m[1],'bands_created',{count:b.count});
      return send(res,200,{bands});
    }
    if((m=p.match(/^\/api\/events\/([^/]+)\/incidents$/)) && method==='GET') {
      admin(req,m[1]); return send(res,200,{incidents:all('SELECT * FROM help_requests WHERE eventId=? ORDER BY createdAt DESC',m[1]).map(publicHelp)});
    }
    if((m=p.match(/^\/api\/events\/([^/]+)\/end$/)) && method==='POST') {
      admin(req,m[1]); const at=current(); run('UPDATE events SET endsAt=? WHERE id=?',at,m[1]); audit(m[1],'event_ended'); return send(res,200,{endsAt:at});
    }
    if((m=p.match(/^\/api\/events\/([^/]+)$/)) && method==='GET') {
      const event=admin(req,m[1]); return send(res,200,{event:publicEvent(event),stats:stats(event.id)});
    }
    if(method==='POST' && p==='/api/door/scan') {
      const session=monitor(req,url), b=await parse(req);
      rate(`scan:${session.token}`,3000,60000);
      if(!['in','out','toggle'].includes(b.direction)||(!b.bandToken&&!b.shortCode)) throw fail(400,'invalid_scan');
      const band=b.bandToken ? getBand(b.bandToken) : q('SELECT * FROM bands WHERE eventId=? AND shortCode=?',session.eventId,b.shortCode);
      if(!band||band.eventId!==session.eventId) throw fail(404,'band_not_found');
      const was=inside(band.token), direction=b.direction==='toggle'?(was?'out':'in'):b.direction;
      const at=current(); let warning;
      if(direction==='in'&&was) warning='already_inside';
      else if(direction==='out'&&!was) warning='not_inside';
      else {
        const capacity=getEvent(session.eventId).capacity;
        if(direction==='in'&&capacity!==null&&insideCount(session.eventId)>=capacity) warning='capacity';
        else { run('INSERT INTO presence (id,bandToken,eventId,direction,at,by) VALUES (?,?,?,?,?,?)',randomToken(),band.token,band.eventId,direction,at,'monitor'); emit(session.eventId,'scan',{shortCode:band.shortCode,direction,inside:direction==='in'}); emitStats(session.eventId); }
      }
      return send(res,200,{band:{shortCode:band.shortCode,...(band.displayName?{displayName:band.displayName}:{})},inside:warning?was:direction==='in',at,...(warning?{warning}:{})});
    }
    if(method==='GET' && p==='/api/monitor/state') {
      const session=monitor(req,url), event=getEvent(session.eventId);
      const bands=all('SELECT token,shortCode,displayName FROM bands WHERE eventId=?',event.id);
      const insideBands=bands.flatMap(b=>{const latest=q('SELECT direction,at FROM presence WHERE bandToken=? ORDER BY at DESC,id DESC LIMIT 1',b.token);return latest?.direction==='in'?[{shortCode:b.shortCode,...(b.displayName?{displayName:b.displayName}:{}),since:latest.at}]:[]});
      const help=all("SELECT * FROM help_requests WHERE eventId=? AND status!='resolved' ORDER BY createdAt",event.id).map(publicHelp);
      return send(res,200,{event:{id:event.id,name:event.name},inside:insideBands.length,capacity:event.capacity,insideBands,help});
    }
    if(method==='GET' && p==='/api/monitor/stream') {
      const session=monitor(req,url,true); res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'}); res.write(': connected\n\n');
      if(!streams.has(session.eventId)) streams.set(session.eventId,new Set()); streams.get(session.eventId).add(res);
      const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),20000); heartbeat.unref();
      req.on('close',()=>{clearInterval(heartbeat);streams.get(session.eventId)?.delete(res)}); return;
    }
    if((m=p.match(/^\/api\/monitor\/help\/([^/]+)\/(ack|resolve)$/)) && method==='POST') {
      const session=monitor(req,url), h=q('SELECT * FROM help_requests WHERE id=? AND eventId=?',m[1],session.eventId); if(!h) throw fail(404,'help_not_found');
      if(m[2]==='ack') run("UPDATE help_requests SET status='ack',ackBy=? WHERE id=?",session.name,h.id);
      else {const b=await parse(req);if(!field(b.resolution,1000)) throw fail(400,'invalid_resolution');run("UPDATE help_requests SET status='resolved',resolvedAt=?,resolution=? WHERE id=?",current(),b.resolution.trim(),h.id);}
      const updated=publicHelp(q('SELECT * FROM help_requests WHERE id=?',h.id));emit(session.eventId,'help_update',{helpRequest:updated});return send(res,200,{helpRequest:updated});
    }
    if((m=p.match(/^\/api\/bands\/([^/]+)$/)) && method==='GET') {
      const band=getBand(m[1]), event=getEvent(band.eventId); let id=getDevice(req);
      if(!id||!q('SELECT id FROM devices WHERE id=?',id)) {id=randomToken();run('INSERT INTO devices (id,createdAt,lastSeenAt) VALUES (?,?,?)',id,current(),current());res.setHeader('Set-Cookie',`hb_device=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax${req.socket.encrypted||req.headers['x-forwarded-proto']==='https'?'; Secure':''}`);}
      if(band.deviceId&&!secureEqual(id,band.deviceId)) throw fail(403,'band_linked_elsewhere');
      if(!band.deviceId) run('UPDATE bands SET deviceId=? WHERE token=?',id,band.token);
      const circles=all('SELECT token,label,createdAt FROM circles WHERE deviceId=? AND eventId=?',id,event.id);
      const dep=q("SELECT * FROM departures WHERE bandToken=? AND status IN ('active','alerted') ORDER BY leftAt DESC LIMIT 1",band.token);
      return send(res,200,{band:{shortCode:band.shortCode,displayName:band.displayName},event:{id:event.id,name:event.name,endsAt:event.endsAt},inside:inside(band.token),mine:true,circles,...(dep?{activeDeparture:publicDeparture(dep)}:{})});
    }
    if((m=p.match(/^\/api\/bands\/([^/]+)\/name$/)) && method==='PUT') {
      guestBand(req,m[1]);const b=await parse(req);if(b.displayName!==null&&b.displayName!==''&&(!field(b.displayName,24))) throw fail(400,'invalid_name');
      run('UPDATE bands SET displayName=? WHERE token=?',b.displayName?.trim()||null,m[1]);return send(res,200,{displayName:b.displayName?.trim()||null});
    }
    if(method==='POST'&&p==='/api/circles') {
      const id=device(req), b=await parse(req);if(!field(b.label,80)||!field(b.eventId,100)) throw fail(400,'invalid_circle');
      if(!q('SELECT token FROM bands WHERE deviceId=? AND eventId=?',id,b.eventId)) throw fail(403,'guest_required');
      const token=randomToken();run('INSERT INTO circles (token,deviceId,eventId,label,createdAt) VALUES (?,?,?,?,?)',token,id,b.eventId,b.label.trim(),current());
      return send(res,201,{circleToken:token,inviteUrl:`${req.socket.encrypted||req.headers['x-forwarded-proto']==='https'?'https':'http'}://${req.headers.host}/c/${token}`});
    }
    if((m=p.match(/^\/api\/circles\/([^/]+)$/)) && method==='DELETE') {
      const id=device(req), c=q('SELECT * FROM circles WHERE token=?',m[1]);if(!c) throw fail(404,'circle_not_found');if(!secureEqual(id,c.deviceId)) throw fail(403,'guest_required');
      run('DELETE FROM circle_members WHERE circleToken=?',c.token);run('DELETE FROM circles WHERE token=?',c.token);return send(res,200,{deleted:true});
    }
    if(method==='POST'&&p==='/api/push/guest') {
      const id=device(req), b=await parse(req);if(!b.subscription||typeof b.subscription!=='object') throw fail(400,'invalid_subscription');
      run('INSERT INTO guest_push (deviceId,subscription) VALUES (?,?) ON CONFLICT(deviceId) DO UPDATE SET subscription=excluded.subscription',id,JSON.stringify(b.subscription));return send(res,200,{ok:true});
    }
    if(method==='POST'&&p==='/api/departures') {
      const b=await parse(req);if(!field(b.bandToken,200)||!['home','friend','other'].includes(b.destination)||!Number.isFinite(Date.parse(b.expectedHomeAt))||Date.parse(b.expectedHomeAt)<=now().getTime()|| (b.leavingWith!==undefined&&b.leavingWith!==null&&typeof b.leavingWith!=='string')) throw fail(400,'invalid_departure');
      const {id,band}=guestBand(req,b.bandToken);const circles=all('SELECT token FROM circles WHERE deviceId=? AND eventId=?',id,band.eventId).map(c=>c.token);
      const chosen=b.sharedWith===undefined?circles:b.sharedWith;if(!Array.isArray(chosen)||chosen.some(t=>!circles.includes(t))) throw fail(403,'invalid_shared_with');
      const recipients=[...new Set(chosen)];
      run("UPDATE departures SET status='cancelled' WHERE bandToken=? AND status IN ('active','alerted')",band.token);
      const departureId=randomToken(), leftAt=current();
      run('INSERT INTO departures (id,bandToken,eventId,deviceId,leftAt,leavingWith,destination,expectedHomeAt,sharedWith,status,homeAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',departureId,band.token,band.eventId,id,leftAt,b.leavingWith?.trim()||null,b.destination,iso(b.expectedHomeAt),JSON.stringify(recipients),'active',null);
      if(inside(band.token)) {run('INSERT INTO presence (id,bandToken,eventId,direction,at,by) VALUES (?,?,?,?,?,?)',randomToken(),band.token,band.eventId,'out',leftAt,'guest');emit(band.eventId,'scan',{shortCode:band.shortCode,direction:'out',inside:false});emitStats(band.eventId);}
      const message=`${band.displayName||'Your friend'} left at ${leftAt}${b.leavingWith?.trim()?`, with ${b.leavingWith.trim()}`:''}${b.destination==='home'?', heading home':''}`;
      await notifyCircle(recipients,message);
      return send(res,201,{departure:publicDeparture(q('SELECT * FROM departures WHERE id=?',departureId))});
    }
    if((m=p.match(/^\/api\/departures\/([^/]+)\/(home|cancel)$/)) && method==='POST') {
      const id=device(req), dep=q('SELECT * FROM departures WHERE id=?',m[1]);if(!dep) throw fail(404,'departure_not_found');if(!secureEqual(id,dep.deviceId)) throw fail(403,'guest_required');
      if(['active','alerted'].includes(dep.status)) {
        if(m[2]==='home') {const at=current();run("UPDATE departures SET status='home',homeAt=? WHERE id=?",at,dep.id);const band=getBand(dep.bandToken);await notifyCircle(shared(dep),`${band.displayName||'Your friend'} is home safe ✅`);}
        else run("UPDATE departures SET status='cancelled' WHERE id=?",dep.id);
      } else if((m[2]==='home'&&dep.status!=='home')||(m[2]==='cancel'&&dep.status!=='cancelled')) throw fail(409,'departure_closed');
      return send(res,200,{departure:publicDeparture(q('SELECT * FROM departures WHERE id=?',dep.id))});
    }
    if(method==='POST'&&p==='/api/help') {
      const b=await parse(req), cookieId=getDevice(req), id=cookieId&&q('SELECT id FROM devices WHERE id=?',cookieId)?cookieId:req.socket.remoteAddress||'anonymous';rate(`help:${id}`,3,600000);
      if(!field(b.eventId,200)) throw fail(400,'invalid_help');getEvent(b.eventId);
      let bandShortCode=null;if(b.bandToken){const band=getBand(b.bandToken);if(band.eventId!==b.eventId) throw fail(403,'invalid_band');if(getDevice(req)&&(!band.deviceId||!secureEqual(getDevice(req),band.deviceId))) throw fail(403,'band_linked_elsewhere');bandShortCode=band.shortCode;}
      if((b.note!==undefined&&b.note!==null&&typeof b.note!=='string')||(b.location!==undefined&&b.location!==null&&typeof b.location!=='string')) throw fail(400,'invalid_help');
      const helpId=randomToken();run('INSERT INTO help_requests (id,eventId,bandShortCode,note,location,createdAt,status,ackBy,resolvedAt,resolution) VALUES (?,?,?,?,?,?,?,?,?,?)',helpId,b.eventId,bandShortCode,b.note?.slice(0,500)||null,b.location?.slice(0,120)||null,current(),'open',null,null,null);
      emit(b.eventId,'help',{helpRequest:publicHelp(q('SELECT * FROM help_requests WHERE id=?',helpId))});return send(res,201,{id:helpId});
    }
    if(method==='POST'&&p==='/api/holds') {
      const id=device(req),b=await parse(req);if(!field(b.eventId,200)||!q('SELECT token FROM bands WHERE deviceId=? AND eventId=?',id,b.eventId)) throw fail(403,'guest_required');
      const until=iso(now().getTime()+30*86400000);run('INSERT INTO incident_holds (deviceId,eventId,until) VALUES (?,?,?) ON CONFLICT(deviceId,eventId) DO UPDATE SET until=excluded.until',id,b.eventId,until);return send(res,200,{until});
    }
    if(method==='GET'&&p==='/api/me/export') {
      const id=device(req),bands=all('SELECT token,eventId,shortCode,displayName FROM bands WHERE deviceId=?',id),deps=all('SELECT * FROM departures WHERE deviceId=?',id).map(d=>({eventId:d.eventId,bandToken:d.bandToken,...publicDeparture(d)})),circles=all('SELECT token,eventId,label,createdAt FROM circles WHERE deviceId=?',id),presence=all('SELECT p.* FROM presence p JOIN bands b ON p.bandToken=b.token WHERE b.deviceId=?',id);
      return send(res,200,{bands,departures:deps,circles,presence});
    }
    if((m=p.match(/^\/api\/circles\/([^/]+)\/join$/))&&method==='POST') {
      const c=q('SELECT * FROM circles WHERE token=?',m[1]);if(!c) throw fail(404,'circle_not_found');const b=await parse(req);if(b.nickname!==undefined&&b.nickname!==null&&typeof b.nickname!=='string') throw fail(400,'invalid_nickname');
      const id=randomToken();run('INSERT INTO circle_members (id,circleToken,nickname,pushSubscription,joinedAt) VALUES (?,?,?,?,?)',id,c.token,b.nickname?.slice(0,80)||null,b.subscription?JSON.stringify(b.subscription):null,current());return send(res,201,{id});
    }
    if((m=p.match(/^\/api\/circles\/([^/]+)$/))&&method==='GET') {
      const c=q('SELECT * FROM circles WHERE token=?',m[1]);if(!c) throw fail(404,'circle_not_found');const event=getEvent(c.eventId);
      const dep=all('SELECT d.*,b.displayName FROM departures d JOIN bands b ON d.bandToken=b.token WHERE d.eventId=? ORDER BY d.leftAt DESC',c.eventId).filter(d=>shared(d).includes(c.token));
      return send(res,200,{label:c.label,...(dep[0]?.displayName?{guestName:dep[0].displayName}:{}),event:{name:event.name},departures:dep.map(publicDeparture)});
    }
    throw fail(404,'not_found');
  }

  async function staticFile(req,res,url) {
    if(req.method!=='GET'&&req.method!=='HEAD') throw fail(405,'method_not_allowed');
    const p=decodeURIComponent(url.pathname);
    let relative;
    if(p==='/') relative='admin/index.html';
    else if(/^\/b\/[^/]+$/.test(p)) relative='guest/index.html';
    else if(/^\/c\/[^/]+$/.test(p)) relative='circle/index.html';
    else if(['/door','/monitor','/admin'].includes(p)) relative=p.slice(1)+'/index.html';
    else relative=p.slice(1);
    const full=path.resolve(webRoot,relative);
    if(!full.startsWith(webRoot+path.sep)) throw fail(403,'forbidden');
    let info;try{info=await stat(full);}catch{throw fail(404,'not_found');}
    if(info.isDirectory()) return staticFile(req,res,new URL(p.replace(/\/$/,'')+'/index.html',url));
    if(!info.isFile()) throw fail(404,'not_found');
    res.writeHead(200,{'Content-Type':types[path.extname(full)]||'application/octet-stream','Cache-Control':'no-store'});
    if(req.method==='HEAD') return res.end();res.end(await readFile(full));
  }

  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    try {const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/')) await api(req,res,url);else await staticFile(req,res,url);}
    catch(err){if(res.headersSent){res.destroy();return;}send(res,err.status||500,{error:err.error||'internal_error',message:err.status?err.message:'Internal server error'});if(!err.status) console.error(err);}
  });
  if(startJobs){server.on('listening',()=>jobs.start());server.on('close',()=>jobs.stop());}
  return server;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const server=createServer();server.listen(Number(process.env.PORT)||4400,()=>console.log(`Homebound listening on ${server.address().port}`));
}
