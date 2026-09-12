// Run after npm run build. Uses local Chrome; no browser package required.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, extname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Content-Type', ({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(path)] || (path === '/' ? 'text/html' : 'application/octet-stream'));
    res.end(await readFile(new URL('../dist' + (path === '/' ? '/index.html' : path), import.meta.url)));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'stadium-capture-test-'));
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
  const click=async(selector)=>{
    const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await delay(250); // Multiple animation frames between press and release.
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    await delay(150);
  };
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?shot=stadium_overview`});
  for(let i=0;i<100;i++) { if(await evaluate(`!!document.querySelector('[data-ball-type="poke"]')`)) break; await delay(100); }
  await delay(1000);
  await evaluate(`window.savedBall=document.querySelector('[data-ball-type="poke"]')`);
  await delay(300);
  assert.equal(await evaluate(`window.savedBall===document.querySelector('[data-ball-type="poke"]')`),true,'Button survives frame updates');
  for (const type of ['poke','great','ultra']) {
    if(type!=='poke') await click(`[data-buy-ball="${type}"]`);
    await click(`[data-ball-type="${type}"]`);
    assert.equal(await evaluate(`document.querySelector('[data-ball-type="${type}"]').getAttribute('aria-pressed')`),'true',`${type} arms on held click`);
    await click(`[data-ball-type="${type}"]`);
    assert.equal(await evaluate(`document.querySelector('[data-ball-type="${type}"]').getAttribute('aria-pressed')`),'false',`${type} disarms`);
  }
  assert.equal(await evaluate(`(()=>{const a=document.querySelector('#poke-mart').getBoundingClientRect(),b=document.querySelector('#course-info').getBoundingClientRect(); return a.bottom<=b.top})()`),true,'Mart clears map controls');
  await click('#btn-maps');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#poke-mart')).visibility`),'hidden','Mart hidden during map selection');
  assert.equal(await evaluate(`document.querySelector('#poke-mart').inert`),true,'Mart cannot receive input during map selection');
  console.log('PASS: persistent buttons, held clicks for all ball types, toggling, Maps access, and Mart visibility.');
} finally {
  socket?.close();
  chrome.kill();
  await new Promise(resolve=>chrome.exitCode!==null?resolve():chrome.once('exit',resolve));
  server.closeAllConnections(); server.close();
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
