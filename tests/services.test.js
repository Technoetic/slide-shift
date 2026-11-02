import test from 'node:test';
import assert from 'node:assert/strict';
import { VersionService } from '../src/services/version-service.js';
import { LevelService } from '../src/services/level-service.js';
import { StorageService } from '../src/services/storage-service.js';

const response = (value, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => value });
const deferred = () => { let resolve; let reject; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return { promise,resolve,reject }; };

test('loaded A remains A when the first fresh version response is B', async () => {
  const version = new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'A01',fetcher:async () => response({buildId:'B01'})});
  const decision = await version.navigation('#/guide', () => ({dirty:false,saving:false}));
  assert.equal(version.loadedBuild,'A01');
  assert.equal(decision.kind,'reload');
  assert.equal(decision.target,'#/guide');
});

test('a dirty state that starts while version fetch is pending protects the run', async () => {
  const gate = deferred(); let dirty=false;
  const version = new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'A01',fetcher:() => gate.promise});
  const decision = version.navigation('#/records', () => ({dirty,saving:false}));
  dirty=true;gate.resolve(response({buildId:'B01'}));
  assert.equal((await decision).kind,'protect');
});

test('save in flight protects navigation even if no edits are marked dirty', async () => {
  const version = new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'A01',fetcher:async () => response({buildId:'B01'})});
  assert.equal((await version.navigation('#/',() => ({dirty:false,saving:true}))).kind,'protect');
});

test('rollback is an unequal build identity and failures keep current navigation usable', async () => {
  const version = new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'B01',fetcher:async () => response({buildId:'A01'})});
  assert.equal((await version.navigation('#/',() => ({dirty:false,saving:false}))).kind,'reload');
  const offline = new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'A01',fetcher:async () => {throw Error('offline');}});
  assert.equal((await offline.navigation('#/guide',() => ({dirty:false,saving:false}))).kind,'spa');
  assert.equal(offline.loadedBuild,'A01');
  assert.equal(offline.status,'unavailable');
});

test('version checks request an absolute subpath URL and reject invalid server identities', async () => {
  let received;
  const version = new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'A01',fetcher:async (url,options) => {received={url:String(url),options};return response({buildId:''});}});
  await version.refresh();
  assert.equal(received.url,'https://example.test/game/version.json');
  assert.equal(received.options.cache,'no-store');
  assert.equal(version.pendingBuild,null);
  assert.equal(version.status,'unavailable');
});

test('a failed version check does not forget an already observed pending update', async () => {
  let fail=false;
  const version = new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'A01',fetcher:async () => {if(fail)throw Error('offline');return response({buildId:'B01'});}});
  await version.refresh();fail=true;await version.refresh();
  assert.equal(version.pendingBuild,'B01');
});

test('level load rejects HTTP failures, empty payload and malformed levels', async () => {
  const validator = level => {if(!level.id)throw Error('invalid level');return level;};
  const cases=[{value:{schema:1,levels:[{id:'one'}]},ok:false},{value:{schema:1,levels:[]},ok:true},{value:{schema:1,levels:[{}]},ok:true}];
  for (const item of cases) {
    const service = new LevelService({baseUrl:'https://example.test/game/',validator,fetcher:async () => response(item.value,item.ok)});
    await assert.rejects(service.load());
  }
});

test('a late old level response cannot overwrite the newer request', async () => {
  const gates=[deferred(),deferred()];let n=0;const urls=[];
  const service = new LevelService({baseUrl:'https://example.test/game/',validator:x=>x,fetcher:(url,options) => {urls.push([String(url),options.cache]);return gates[n++].promise;}});
  const first = service.load();const rejected = assert.rejects(first,{name:'AbortError'});
  const second = service.load();gates[1].resolve(response({schema:1,levels:[{id:'new'}]}));
  assert.equal((await second)[0].id,'new');
  gates[0].resolve(response({schema:1,levels:[{id:'old'}]}));await rejected;
  assert.deepEqual(urls,[['https://example.test/game/data/levels.json','no-store'],['https://example.test/game/data/levels.json','no-store']]);
});

class MemoryBackend {
  data = new Map();
  async get(key){return structuredClone(this.data.get(key));}
  async put(key,value){this.data.set(key,structuredClone(value));return value;}
  async update(key,fn){const value=fn(await this.get(key));if(value===undefined)this.data.delete(key);else await this.put(key,value);return value;}
}

test('saving checkpoint stays pending until durable write completes; failure remains a failure', async () => {
  const gate=deferred();const backend=new MemoryBackend();backend.put=() => gate.promise;
  const store=new StorageService({backend});
  const saved=store.saveCheckpoint({runId:'run-one',game:{schema:1,score:42}});
  assert.equal(store.pending,1);gate.reject(Error('disk blocked'));
  await assert.rejects(saved,/disk blocked/);assert.equal(store.pending,0);
});

test('checkpoint roundtrips and finishing another run does not delete it', async () => {
  const store=new StorageService({backend:new MemoryBackend()});
  await store.saveCheckpoint({runId:'run-one',game:{schema:1,score:42}});
  await store.clearCheckpoint('run-other');
  assert.equal((await store.loadCheckpoint()).runId,'run-one');
  await store.clearCheckpoint('run-one');assert.equal(await store.loadCheckpoint(),null);
});

test('corrupt checkpoint is reported and preserved rather than silently deleted', async () => {
  const backend=new MemoryBackend();backend.data.set('checkpoint',{schema:4,game:'bad'});
  const store=new StorageService({backend});await assert.rejects(store.loadCheckpoint());
  assert.equal(backend.data.get('checkpoint').schema,4);
});

test('finished run records are idempotent and ordered by score', async () => {
  const store=new StorageService({backend:new MemoryBackend()});
  const one={id:'one',mode:'rush',score:50,completed:1,safeMoves:2,strikes:0,date:new Date().toISOString()};
  await store.recordRun(one);await store.recordRun(one);await store.recordRun({...one,id:'two',score:100});
  assert.deepEqual((await store.loadRecords()).map(x=>x.id),['two','one']);
  assert.equal(store.pending,0);
});
