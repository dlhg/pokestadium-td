// Run after npm run build. Exercises real loading and animation with local Chrome.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, extname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

let failLogo = false;
let releaseLogo;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.endsWith('/x214_model.glb')) {
      await new Promise(resolve => { releaseLogo = resolve; });
      if (failLogo) { res.writeHead(404).end(); return; }
    }
    res.setHeader('Content-Type', ({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png'})[extname(path)] || (path === '/' ? 'text/html' : 'application/octet-stream'));
    res.end(await readFile(new URL('../dist' + (path === '/' ? '/index.html' : path), import.meta.url)));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'stadium-title-test-'));
const chrome = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1280,720','--use-gl=angle','--use-angle=metal','about:blank'], {stdio:'ignore'});
let socket;
try {
  let port;
  for (let i=0; i<100; i++) {
    try { port = (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]; break; } catch { await delay(100); }
  }
  assert.ok(port, 'Chrome debug port available');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  let serial=0;
  const pending = new Map();
  socket.addEventListener('message',event=>{ const msg=JSON.parse(event.data); if(pending.has(msg.id)){pending.get(msg.id)(msg);pending.delete(msg.id);} });
  const send=async(method,params={})=>{
    const id=++serial;
    const response=new Promise(resolve=>pending.set(id,resolve));
    socket.send(JSON.stringify({id,method,params}));
    const msg=await response;
    assert.ok(!msg.error,JSON.stringify(msg.error)); return msg.result;
  };
  const evaluate=async(expression)=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true});
    assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const until=async(predicate,label)=>{
    for(let i=0;i<150;i++) { if(await predicate()) return; await delay(100); }
    assert.fail(`Timed out: ${label}`);
  };
  const opacity=selector=>evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity`);
  const capture=async(name)=>{
    const clip=await evaluate(`(()=>{const r=document.querySelector('.title-screen__logo-stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
    const result=await send('Page.captureScreenshot',{format:'png',clip});
    await writeFile(new URL(`../screenshot_title_${name}.png`,import.meta.url),Buffer.from(result.data,'base64'));
    return result.data;
  };
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?shot=title_screen_live`});
  await until(()=>!!releaseLogo,'GLB request');
  assert.equal(await opacity('.title-screen__fallback'),'0','Fallback hidden during pending load');
  await delay(400);
  assert.equal(await opacity('.title-screen__fallback'),'0','Fallback stays hidden on slow load');
  releaseLogo(); releaseLogo=null;
  await until(async()=>await opacity('.title-screen__model')==='1','Loaded model');
  assert.equal(await opacity('.title-screen__fallback'),'0','Successful load never reveals fallback');
  // Record the lockup's shake and the wordmark's own displacement inside it for
  // the whole intro. Both are transient, so sample every frame rather than
  // trying to catch them with a screenshot.
  await evaluate(`
    window.__jolts=[];
    (function tick(){
      const c=document.querySelector('.title-screen__content');
      const w=document.querySelector('.title-screen__wordmark');
      if(c&&w) window.__jolts.push([c.getBoundingClientRect().top, w.getBoundingClientRect().top]);
      if(document.querySelector('#title-screen')) requestAnimationFrame(tick);
    })();
  `);
  const first=await capture('start');
  await delay(2800);
  const middle=await capture('middle');
  assert.notEqual(first,middle,'Original sequence animates');
  await delay(7000);
  const end=await capture('end');
  assert.notEqual(middle,end,'Full sequence progresses beyond the old four-second cut');
  await delay(800);
  assert.equal(await capture('held'),end,'Completed intro holds still without a loop or camera jitter');

  // Falling Pokemon land on the wordmark: every landing shakes the lockup, and
  // the finale drops three at once hard enough to drive the text itself down.
  const jolts=await evaluate(`(()=>{
    const rows=window.__jolts;
    const gaps=rows.map(([c,w])=>w-c).sort((a,b)=>a-b);
    const rest=gaps[Math.floor(gaps.length/2)];
    const tops=rows.map(r=>r[0]);
    return {
      frames: rows.length,
      shake: Math.max(...tops)-Math.min(...tops),
      knock: Math.max(...rows.map(([c,w])=>w-c-rest)),
      settled: rows.slice(-60).every(([c,w])=>Math.abs(w-c-rest)<0.01),
    };
  })()`);
  assert.ok(jolts.frames>200,`Intro sampled across ${jolts.frames} frames`);
  assert.ok(jolts.shake>4,`Landings shake the lockup (travelled ${jolts.shake.toFixed(1)}px)`);
  assert.ok(jolts.knock>3,`The finale knocks the wordmark down (dropped ${jolts.knock.toFixed(1)}px)`);
  assert.ok(jolts.settled,'The wordmark springs all the way back to rest');
  await send('Input.dispatchKeyEvent',{type:'keyDown',code:'Enter',key:'Enter'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',code:'Enter',key:'Enter'});
  await until(()=>evaluate(`!document.querySelector('#title-screen')`),'Start dismisses title');

  failLogo=true;
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?shot=title_screen_live&failure=1`});
  await until(()=>!!releaseLogo,'Failure GLB request');
  assert.equal(await opacity('.title-screen__fallback'),'0','Fallback remains hidden before failure');
  releaseLogo(); releaseLogo=null;
  await until(async()=>await opacity('.title-screen__fallback')==='1','Fallback appears after failure');
  assert.equal(await opacity('.title-screen__model'),'0','Failed model remains hidden');
  console.log('PASS: pending/success/failure fallback states, full intro motion, landing shake and wordmark knock, stable final pose, and Enter dismissal.');
} finally {
  releaseLogo?.();
  socket?.close();
  chrome.kill();
  await new Promise(resolve=>chrome.exitCode!==null?resolve():chrome.once('exit',resolve));
  server.closeAllConnections(); server.close();
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
