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
// --autoplay-policy: the intro's sound plays before anyone has clicked
// anything, which a browser normally refuses. That refusal is a real path, and
// the ?mute=1 pass below is the one that exercises it; the rest of the run wants
// the cues to actually reach the graph.
const chrome = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1280,720','--use-gl=angle','--use-angle=metal','--autoplay-policy=no-user-gesture-required','about:blank'], {stdio:'ignore'});
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
  // Listen in on the page's audio for the run. Every stone cue puts one
  // oscillator into the graph as its body -- a sine for a landing, a triangle
  // for the stone -- over noise bursts, so the bodies are a readable transcript
  // of the intro: what fired, how hard, and where across the stage. The tap on
  // the destination measures what the mix actually comes out at, since a set
  // piece that clips is as broken as one that is silent.
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__cues=[]; window.__peak=0;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    // ?mute=1 stands in for a browser that has not granted audio yet.
    if (location.search.includes('mute=1')) {
      Object.defineProperty(Ctx.prototype,'state',{get(){return 'suspended';},configurable:true});
    }
    const proto = Ctx.prototype;
    const base = Object.getPrototypeOf(proto);
    const realDestination = Object.getOwnPropertyDescriptor(base,'destination').get;
    Object.defineProperty(proto,'destination',{configurable:true,get(){
      if (!this.__tap) {
        const tap = this.createGain(), analyser = this.createAnalyser();
        analyser.fftSize = 2048;
        tap.connect(analyser); analyser.connect(realDestination.call(this));
        this.__tap = tap;
        const window_ = new Float32Array(analyser.fftSize);
        const poll = () => {
          analyser.getFloatTimeDomainData(window_);
          for (const sample of window_) window.__peak = Math.max(window.__peak, Math.abs(sample));
          setTimeout(poll, 12);
        };
        poll();
      }
      return this.__tap;
    }});
    const makeOsc = proto.createOscillator;
    proto.createOscillator = function(){
      const node = makeOsc.call(this), start = node.start.bind(node), set = node.frequency.setValueAtTime.bind(node.frequency);
      let hz = null;
      node.frequency.setValueAtTime = (value, at) => { if (hz === null) hz = value; return set(value, at); };
      node.start = when => { window.__cues.push({wave:node.type, hz, when: when ?? this.currentTime, now: this.currentTime}); return start(when); };
      return node;
    };
  `});
  const opacity=selector=>evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity`);
  // Opaque texels left in the stone cast over the wordmark.
  const standing=()=>evaluate(`(()=>{
    const canvas=document.querySelector('.title-screen__wordmark-cover');
    if(!canvas||!canvas.width) return -1;
    const probe=document.createElement('canvas');
    probe.width=canvas.width; probe.height=canvas.height;
    probe.getContext('2d').drawImage(canvas,0,0);
    const pixels=probe.getContext('2d').getImageData(0,0,probe.width,probe.height).data;
    let opaque=0;
    for(let i=3;i<pixels.length;i+=4) if(pixels[i]>128) opaque++;
    return opaque;
  })()`);
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
    window.__cover=[];
    (function tick(){
      const c=document.querySelector('.title-screen__content');
      const w=document.querySelector('.title-screen__wordmark');
      const s=document.querySelector('.title-screen__wordmark-stage');
      if(c&&w&&s) window.__jolts.push([c.getBoundingClientRect().top, s.getBoundingClientRect().top]);
      if(document.querySelector('#title-screen')) requestAnimationFrame(tick);
    })();
  `);
  const first=await capture('start');
  const cast=await standing();
  assert.ok(cast>20000,`The wordmark starts under a solid cast (${cast} texels standing)`);
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

  // Those same landings are what the sound is drawn from, so the transcript has
  // to tell the same story the motion does: thuds throughout, the stone
  // complaining before any of it comes away, pieces breaking off through the
  // middle, and one collapse on the last blow with nothing breaking after it.
  const cues=await evaluate('JSON.stringify(window.__cues)').then(JSON.parse);
  const bodies=cues.filter(cue=>cue.hz!==null);
  const impacts=bodies.filter(cue=>cue.wave==='sine'&&cue.hz>100);
  const cracks=bodies.filter(cue=>cue.wave==='triangle'&&cue.hz===255);
  const shatters=bodies.filter(cue=>cue.wave==='triangle'&&cue.hz<=150);
  const collapse=bodies.filter(cue=>cue.wave==='sine'&&cue.hz===96);
  const peak=await evaluate('window.__peak');
  console.log(`  cues: ${impacts.length} landings, ${cracks.length} cracks, ${shatters.length} shatters, ${collapse.length} collapse, mix peak ${peak.toFixed(3)}`);
  assert.ok(impacts.length>5,`Every landing is heard (${impacts.length} thuds)`);
  assert.ok(shatters.length>2,`Pieces coming away are heard (${shatters.length} shatters)`);
  assert.ok(cracks.length>0&&cracks[0].when<shatters[0].when,'The stone strains before any of it breaks');
  assert.equal(collapse.length,1,`The cast lets go exactly once (${collapse.length} collapses)`);
  // Same frame, not same instant: the finale drops three Pokemon inside a couple
  // of frames, and the one that takes the last letters off is not always the one
  // the cast lets go under. What must not happen is stone breaking after it.
  assert.ok(Math.max(...shatters.map(cue=>cue.when))<collapse[0].when+0.05,'Nothing breaks off after the collapse');
  assert.ok(collapse[0].when>impacts[0].when+0.5,'The collapse comes at the end of the landings, not on the first');
  assert.ok(peak>0.05,`The intro is audible (mix peaked at ${peak.toFixed(3)})`);
  assert.ok(peak<0.99,`The finale has headroom left (mix peaked at ${peak.toFixed(3)})`);

  // The stone cast over the wordmark starts solid and is broken off by those
  // same landings, leaving nothing behind by the time the intro settles.
  const left=await standing();
  assert.equal(left,0,`The cast is entirely gone once the intro settles (${left} texels standing)`);
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
  // No logo means no Pokemon to break the cast, so it must never go up at all
  // -- otherwise the wordmark stays buried for the life of the title.
  assert.equal(await standing(),0,'A failed logo leaves the wordmark uncovered');

  // A browser that has not granted audio yet: the intro must play silently
  // rather than bank a clip's worth of thuds against a stopped clock and fire
  // them all on the first click.
  failLogo=false;
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?shot=title_screen_live&mute=1`});
  await until(()=>!!releaseLogo,'Muted GLB request');
  releaseLogo(); releaseLogo=null;
  await until(async()=>await opacity('.title-screen__model')==='1','Muted model loads');
  const held=await standing();
  await delay(4500);
  const broken=await standing();
  const silent=await evaluate('window.__cues.length');
  console.log(`  held audio: cast ${held} -> ${broken} texels, ${silent} cues scheduled`);
  assert.ok(broken<held,`Pokemon still land on the cast with audio held (${held} -> ${broken} texels)`);
  assert.equal(silent,0,`Nothing is scheduled while audio is held (${silent} cues)`);

  // Same again for a visitor who has asked for less motion.
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?shot=title_screen_live&reduced=1`});
  await until(()=>!!releaseLogo,'Reduced-motion GLB request');
  releaseLogo(); releaseLogo=null;
  await until(async()=>await opacity('.title-screen__model')==='1','Reduced-motion model loads');
  await delay(2500);
  assert.equal(await standing(),0,'Reduced motion leaves the wordmark uncovered');
  console.log('PASS: pending/success/failure fallback states, full intro motion, landing shake, wordmark knock, stone cast broken clear, cast skipped where nothing can break it, impact/crack/shatter/collapse cues in order with headroom left, silence while audio is held, stable final pose, and Enter dismissal.');
} finally {
  releaseLogo?.();
  socket?.close();
  chrome.kill();
  await new Promise(resolve=>chrome.exitCode!==null?resolve():chrome.once('exit',resolve));
  server.closeAllConnections(); server.close();
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
