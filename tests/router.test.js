import test from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../src/services/router.js';
import { VersionService } from '../src/services/version-service.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

// Only browser-owned objects and the network are doubled; routing/version logic is real.
function setup(t,{hashes=['#/guide','#/play'],position=hashes.length-1,build='A01',fetcher,dirty=false,onProtect=async()=>false}={}){
  const events=new EventTarget();const document=new EventTarget();
  const entries=hashes.map((hash,index)=>({url:'https://example.test/game/'+hash,state:{slideShift:{key:'test-session',index}}}));
  let cursor=position;let current=new URL(entries[cursor].url);let isDirty=dirty;
  const documents=[];const rendered=[];const errors=[];const traversals=[];
  const location={get href(){return current.href;},get hash(){return current.hash;},assign:url=>documents.push({kind:'assign',url:new URL(url)}),replace:url=>documents.push({kind:'replace',url:new URL(url)})};
  const history={get state(){return entries[cursor].state;},replaceState:(state,unused,url)=>{current=new URL(url);entries[cursor]={url:current.href,state};},pushState:(state,unused,url)=>{current=new URL(url);entries.splice(cursor+1);entries.push({url:current.href,state});cursor++;},go:delta=>traversals.push(delta)};
  const globals={addEventListener:events.addEventListener.bind(events),document,location,history};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const version=new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'A01',fetcher:fetcher||(async()=>({ok:true,json:async()=>({buildId:build})}))});
  const router=new Router({baseUrl:'https://example.test/game/',version,readState:()=>({dirty:isDirty,saving:false}),onNavigate:async route=>rendered.push(route.path),onProtect:args=>onProtect(args,()=>{isDirty=false;}),onUpdate:()=>{},onError:error=>errors.push(error)});
  const traverse=(index,{emitHash=true,emitPop=true}={})=>{assert.ok(index>=0&&index<entries.length);cursor=index;current=new URL(entries[cursor].url);if(emitPop)events.dispatchEvent(new Event('popstate'));if(emitHash)events.dispatchEvent(new Event('hashchange'));};
  const flushOneHistory=async()=>{const delta=traversals.shift();assert.notEqual(delta,undefined);traverse(cursor+delta);await flush();};
  const flushHistory=async()=>{for(let count=0;traversals.length&&count<12;count++)await flushOneHistory();};
  t.after(()=>{router.dispose();for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  return {router,version,location,history,documents,rendered,errors,events,traversals,traverse,flushHistory,flushOneHistory,setDirty:value=>{isDirty=value;},get cursor(){return cursor;}};
}

test('changed build links change the document URL outside the intended hash',async t=>{
  const app=setup(t,{build:'B01'});
  await app.router.navigate('/guide');
  assert.equal(app.documents.length,1);
  const first=app.documents[0];
  assert.equal(first.kind,'assign');assert.equal(first.url.origin,'https://example.test');assert.equal(first.url.pathname,'/game/');assert.equal(first.url.hash,'#/guide');
  assert.ok(first.url.searchParams.get('_ss')?.startsWith('B01-'),'a fragment-only assign keeps the old document');
  await app.router.navigate('/records');
  assert.notEqual(app.documents[1].url.search,first.url.search,'every document transition has a fresh URL');
});

test('changed build Back replaces the traversed entry with a fresh document URL',async t=>{
  const app=setup(t,{build:'B01'});app.traverse(0);await flush();
  assert.equal(app.documents.length,1);assert.equal(app.documents[0].kind,'replace');assert.equal(app.documents[0].url.hash,'#/guide');
  assert.ok(app.documents[0].url.searchParams.has('_ss'),'Back must replace the document as well as its hash');
});

test('cancel after Back then a link during version lookup restores the displayed route and index',async t=>{
  const lookup=deferred();let protects=0;
  const app=setup(t,{dirty:true,fetcher:()=>lookup.promise,onProtect:async()=>{protects++;return false;}});
  app.traverse(0);const clicked=app.router.navigate('/records');await flush();await app.flushHistory();
  lookup.resolve({ok:true,json:async()=>({buildId:'A01'})});await clicked;await flush();
  assert.equal(protects,1);assert.equal(app.location.hash,'#/play');assert.equal(app.router.committedUrl,'https://example.test/game/#/play');
  assert.equal(app.router.index,1);assert.equal(app.history.state.slideShift.index,1);assert.deepEqual(app.rendered,[]);assert.deepEqual(app.errors,[]);
});

test('discard after a superseded Back keeps the original entry before the new route',async t=>{
  const lookup=deferred();
  const app=setup(t,{dirty:true,fetcher:()=>lookup.promise,onProtect:async(args,discard)=>{discard();return true;}});
  app.traverse(0);const clicked=app.router.navigate('/records');await flush();await app.flushHistory();
  lookup.resolve({ok:true,json:async()=>({buildId:'A01'})});await clicked;await flush();
  assert.equal(app.location.hash,'#/records');assert.equal(app.router.index,2);assert.equal(app.cursor,2);assert.deepEqual(app.rendered,['/records']);
  app.traverse(1);await flush();assert.equal(app.location.hash,'#/play');assert.equal(app.router.index,1);assert.deepEqual(app.rendered,['/records','/play']);assert.deepEqual(app.errors,[]);
});

test('a delayed duplicate history event does not render the same traversal twice',async t=>{
  const app=setup(t);app.traverse(0,{emitHash:false});await flush();
  app.events.dispatchEvent(new Event('hashchange'));await flush();
  assert.deepEqual(app.rendered,['/guide']);assert.deepEqual(app.errors,[]);
});

test('a late edit on approved Back still restores history when a newer link is cancelled',async t=>{
  const lookup=deferred();let requests=0;let protects=0;
  const reply=()=>({ok:true,json:async()=>({buildId:'A01'})});
  const app=setup(t,{dirty:true,fetcher:()=>++requests>=3?lookup.promise:Promise.resolve(reply()),onProtect:async(args,discard)=>{protects++;if(protects===1){discard();return true;}return false;}});
  app.traverse(0);await flush();await app.flushOneHistory();
  app.setDirty(true);await app.flushOneHistory();
  const clicked=app.router.navigate('/records');await flush();await app.flushHistory();
  lookup.resolve(reply());await clicked;await flush();
  assert.equal(protects,2);assert.equal(app.location.hash,'#/play');assert.equal(app.router.index,1);assert.equal(app.history.state.slideShift.index,1);assert.deepEqual(app.rendered,[]);assert.deepEqual(app.errors,[]);
});

test('disposing a pending history restoration cancels its timeout immediately',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const app=setup(t);app.traverse(0,{emitPop:false,emitHash:false});
  const restored=app.router.restoreHistory(0);const rejected=assert.rejects(restored,{name:'AbortError'});
  app.router.dispose();t.mock.timers.tick(2500);await rejected;
});
