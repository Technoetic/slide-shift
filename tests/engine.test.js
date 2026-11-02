import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runProgram, validateLevel, isEquivalent, GameEngine } from '../src/game/engine.js';

const v = name => ({var:name});
const set = (id,target,value,group='cargo') => ({id,target,value,group,op:'set',label:id,code:`${target} = …`});
const emit = (id,value,channel='dispatch') => ({id,value,channel,group:'cargo',op:'emit',label:id,code:'emit(…)'});
function fixtureLevel() {
  return {id:'test-stage',title:'정리 시험',brief:'결과를 보존하세요.',goalLabel:'계산과 발송',goalIds:['a','c'],
    statements:[set('a','amount',{mul:[v('qty'),v('price')]}),set('b','pulse',{add:[v('signal'),1]},'signal'),emit('c',v('amount')),emit('d',v('pulse'),'audit')],
    fixtures:[{qty:2,price:3,signal:0},{qty:5,price:4,signal:7}],observe:['amount','pulse']};
}
function undoLevel() {
  const l=fixtureLevel();l.statements.splice(2,0,set('e','independent',7,'scan'));return l;
}
const clone = value => JSON.parse(JSON.stringify(value));
const levelsURL = new URL('../data/levels.json',import.meta.url);

test('DSL computes finite arithmetic and preserves the ordered channel trace',()=>{
  const result=runProgram(fixtureLevel().statements,{qty:2,price:3,signal:0});
  assert.deepEqual({...result.state},{qty:2,price:3,signal:0,amount:6,pulse:1});
  assert.deepEqual(result.outputs,[{channel:'dispatch',value:6},{channel:'audit',value:1}]);
});
test('DSL rejects a read before assignment, including inherited inputs',()=>{
  assert.throws(()=>runProgram([emit('e',v('missing'))],{}),/undefined|정의/i);
  assert.throws(()=>runProgram([emit('e',v('inherited'))],Object.create({inherited:3})),/input|object|객체|입력/i);
});
test('DSL forbids prototype names and unknown expression operators',()=>{
  assert.throws(()=>runProgram([set('a','__proto__',1)],{}));
  assert.throws(()=>runProgram([set('a','safe',{divide:[1,2]})],{}));
  assert.throws(()=>runProgram([set('a','safe',{var:'constructor'})],{}));
});
test('DSL rejects coercion, infinity, excessive nesting, and unknown statement keys',()=>{
  assert.throws(()=>runProgram([set('a','x',{add:['1',2]})],{}));
  assert.throws(()=>runProgram([set('a','x',{mul:[Number.MAX_VALUE,2]})],{}));
  assert.throws(()=>runProgram([{...set('a','x',1),extra:true}],{}));
  let expression=1; for(let n=0;n<40;n++) expression={add:[expression,1]};
  assert.throws(()=>runProgram([set('a','x',expression)],{}));
});
test('validateLevel copies valid data and strictly enforces the bounded schema',()=>{
  const source=fixtureLevel(), valid=validateLevel(source); source.goalIds.push('d');
  assert.deepEqual(valid.goalIds,['a','c']);
  for(const alter of [l=>l.extra=1,l=>l.statements[0].extra=1,l=>l.fixtures.pop(),l=>l.goalIds=['a'],l=>l.goalIds=['a','missing'],l=>l.statements[1].id='a',l=>l.statements[1].group='unknown',l=>l.observe=['missing']]) {
    const invalid=fixtureLevel(); alter(invalid); assert.throws(()=>validateLevel(invalid));
  }
  const tooLong=fixtureLevel(); while(tooLong.statements.length<9)tooLong.statements.push(set(`extra${tooLong.statements.length}`,`v${tooLong.statements.length}`,1));
  assert.throws(()=>validateLevel(tooLong));
});
test('schema rejects sparse arrays, decorated arrays, and accessor properties without executing them',()=>{
  const sparse=fixtureLevel();delete sparse.goalIds[0];assert.throws(()=>validateLevel(sparse));
  const decorated=fixtureLevel();decorated.observe.extra=1;assert.throws(()=>validateLevel(decorated));
  let accessed=false;const l=fixtureLevel();Object.defineProperty(l.fixtures[0],'qty',{enumerable:true,get(){accessed=true;return 2;}});
  assert.throws(()=>validateLevel(l));assert.equal(accessed,false);
});
test('equivalence accepts an independent reorder but rejects missing and tampered blocks',()=>{
  const l=fixtureLevel(), [a,b,c,d]=l.statements;
  assert.equal(isEquivalent(l,[a,c,b,d]).equivalent,true);
  assert.equal(isEquivalent(l,[b,c,a,d]).equivalent,false);
  assert.equal(isEquivalent(l,[a,b,d,c]).equivalent,false);
  assert.equal(isEquivalent(l,[a,b,c]).equivalent,false);
  assert.equal(isEquivalent(l,[{...a,value:99},b,c,d]).equivalent,false);
});
test('equivalence evaluates every input case even when the first masks a dependency',()=>{
  const l={...fixtureLevel(),goalIds:['first','independent'],observe:['x'],fixtures:[{x:2,toggle:0},{x:1,toggle:1}],
    statements:[emit('first',{mul:[v('x'),v('toggle')]}),set('change','x',2),set('independent','other',1),emit('last',0)]};
  const [a,b,c,d]=l.statements;
  assert.equal(isEquivalent(l,[b,a,c,d]).equivalent,false);
});
test('goals use explicit IDs even when other cards share their group',()=>{
  const g=new GameEngine([fixtureLevel()]);g.start();
  assert.deepEqual(g.getSnapshot().progress,{current:1,total:2});
  const result=g.move('c',1);
  assert.equal(result.accepted,true);assert.equal(result.solved,true);assert.equal(result.points,100);
  assert.equal(g.getSnapshot().phase,'cleared');assert.deepEqual(g.getSnapshot().completed,['test-stage']);
});
test('unsafe movement keeps the board intact and costs three seconds',()=>{
  const g=new GameEngine([fixtureLevel()]);g.start();
  const before=g.getSnapshot().blocks.map(x=>x.id);const result=g.move('a',2);
  assert.equal(result.accepted,false);assert.equal(result.solved,false);
  assert.deepEqual(g.getSnapshot().blocks.map(x=>x.id),before);
  assert.equal(g.getSnapshot().timeLeftMs,87000);assert.equal(g.getSnapshot().strikes,1);
});
test('invalid and no-op input does not penalize or increment move counters',()=>{
  const g=new GameEngine([fixtureLevel()]);g.start();
  for(const pair of [['missing',0],['a',-1],['a',4],['a',0],['a',1.5]])assert.equal(g.move(...pair).accepted,false);
  assert.equal(g.getSnapshot().timeLeftMs,90000);assert.equal(g.getSnapshot().safeMoves,0);assert.equal(g.getSnapshot().strikes,0);
});
test('undo restores the previous safe board without recovering elapsed time',()=>{
  const g=new GameEngine([undoLevel()]);g.start();
  assert.equal(g.move('b',0).accepted,true);g.advance(1200);
  assert.equal(g.undo(),true);assert.deepEqual(g.getSnapshot().blocks.map(x=>x.id),['a','b','e','c','d']);
  assert.equal(g.getSnapshot().timeLeftMs,88800);assert.equal(g.getSnapshot().score,0);assert.equal(g.undo(),false);
});
test('safe back-and-forth movements cannot farm points',()=>{
  const g=new GameEngine([undoLevel()]);g.start();
  g.move('b',0);g.move('b',1);g.move('b',0);g.undo();
  assert.equal(g.getSnapshot().score,0);g.move('c',1);assert.equal(g.getSnapshot().score,100);
  assert.equal(g.undo(),false);assert.equal(g.move('c',2).accepted,false);assert.equal(g.getSnapshot().score,100);
});
test('hint follows a safe reachable path and charges five seconds without moving',()=>{
  const g=new GameEngine([fixtureLevel()]);g.start();const before=g.getSnapshot().blocks.map(x=>x.id);
  const h=g.hint();assert.ok(h);assert.equal(typeof h.reason,'string');
  assert.deepEqual(g.getSnapshot().blocks.map(x=>x.id),before);assert.equal(g.getSnapshot().timeLeftMs,85000);assert.equal(g.getSnapshot().hints,1);
  const result=g.move(h.blockId,h.toIndex);assert.equal(result.accepted,true);assert.equal(result.solved,true);
});
test('pause and ready phases consume no timer and accept no moves',()=>{
  const g=new GameEngine([fixtureLevel()]);g.advance(9000);assert.equal(g.getSnapshot().timeLeftMs,90000);
  g.start();g.advance(1000);g.pause();g.advance(30000);
  assert.equal(g.getSnapshot().timeLeftMs,89000);assert.equal(g.move('c',1).accepted,false);assert.equal(g.hint(),null);assert.equal(g.undo(),false);
  g.resume();g.advance(500);assert.equal(g.getSnapshot().timeLeftMs,88500);
});
test('timeout and penalties finish a rush game at zero',()=>{
  const g=new GameEngine([fixtureLevel()]);g.start();g.advance(88000);g.move('a',2);
  assert.equal(g.getSnapshot().phase,'finished');assert.equal(g.getSnapshot().timeLeftMs,0);
  assert.equal(g.move('c',1).accepted,false);assert.equal(g.nextLevel(),false);
});
test('practice has no countdown while retaining strike and hint counters',()=>{
  const g=new GameEngine([fixtureLevel()],{mode:'practice'});g.start();g.advance(1e9);g.move('a',2);g.hint();
  assert.equal(g.getSnapshot().timeLeftMs,null);assert.equal(g.getSnapshot().phase,'playing');assert.equal(g.getSnapshot().strikes,1);assert.equal(g.getSnapshot().hints,1);
});
test('nextLevel advances once and finishing all stages retains cumulative statistics',()=>{
  const second=fixtureLevel();second.id='second';const g=new GameEngine([fixtureLevel(),second]);
  assert.equal(g.nextLevel(),false);g.start();g.move('c',1);assert.equal(g.nextLevel(),true);
  assert.equal(g.getSnapshot().stageIndex,1);assert.equal(g.getSnapshot().phase,'playing');
  g.move('c',1);assert.equal(g.getSnapshot().score,225);assert.equal(g.nextLevel(),true);
  assert.equal(g.getSnapshot().phase,'finished');assert.equal(g.getSnapshot().completed.length,2);
});
test('snapshots are immutable copies and constructor inputs cannot alter the run',()=>{
  const l=fixtureLevel(),g=new GameEngine([l]);l.statements[0].value=999;
  const snapshot=g.getSnapshot();assert.ok(Object.isFrozen(snapshot));assert.ok(Object.isFrozen(snapshot.blocks[0]));
  assert.throws(()=>snapshot.blocks.reverse());assert.equal(g.getSnapshot().blocks[0].id,'a');
  g.start();assert.equal(g.move('c',1).accepted,true);
});
test('checkpoint round trip preserves exact board, timer, score and undo history, restoring paused',()=>{
  const g=new GameEngine([undoLevel()]);g.start();g.advance(1234);g.move('b',0);g.move('a',3);
  const before=g.getSnapshot(),save=JSON.parse(JSON.stringify(g.exportSave()));const restored=GameEngine.fromSave([undoLevel()],save),after=restored.getSnapshot();
  for(const key of ['mode','stageIndex','timeLeftMs','score','combo','safeMoves','strikes','hints','completed','blocks'])assert.deepEqual(after[key],before[key],key);
  assert.equal(after.phase,'paused');assert.equal(after.canUndo,false);restored.resume();assert.equal(restored.getSnapshot().canUndo,true);assert.equal(restored.undo(),true);
});
test('a timed-out checkpoint with earlier safe moves restores its result',()=>{
  const g=new GameEngine([undoLevel()]);g.start();g.move('b',0);g.advance(90000);
  const restored=GameEngine.fromSave([undoLevel()],g.exportSave());
  assert.equal(restored.getSnapshot().phase,'finished');assert.equal(restored.getSnapshot().safeMoves,1);assert.equal(restored.undo(),false);
});
test('cleared and finished checkpoints preserve their progression phase',()=>{
  const g=new GameEngine([fixtureLevel()]);g.start();g.move('c',1);
  assert.equal(GameEngine.fromSave([fixtureLevel()],g.exportSave()).getSnapshot().phase,'cleared');
  g.nextLevel();assert.equal(GameEngine.fromSave([fixtureLevel()],g.exportSave()).getSnapshot().phase,'finished');
});
test('malformed saves and a different level signature are rejected explicitly',()=>{
  const g=new GameEngine([fixtureLevel()]);g.start();const saved=g.exportSave();
  for(const alter of [s=>s.schema=99,s=>s.timeLeftMs=-1,s=>s.score='100',s=>s.score=100,s=>s.blockIds=['a'],s=>s.phase='bogus',s=>s.stageIndex=9,s=>s.extra=1,s=>s.history=[['a','b']],s=>s.completed=['fake'],s=>s.combo=Infinity]) {
    const bad=clone(saved);alter(bad);assert.throws(()=>GameEngine.fromSave([fixtureLevel()],bad));
  }
  const different=fixtureLevel();different.title='다른 레벨';assert.throws(()=>GameEngine.fromSave([different],saved),/signature|서명|레벨/i);
});
test('saved modes must be explicit rush or practice and cannot disable the rush countdown',()=>{
  const g=new GameEngine([fixtureLevel()]);g.start();
  for(const mode of [null,undefined,false,0,'',{},[]]) {
    const bad=g.exportSave();bad.mode=mode;bad.timeLeftMs=null;
    assert.throws(()=>GameEngine.fromSave([fixtureLevel()],bad),/mode/);
  }
});
test('restored mode keeps its required timer and result phase invariants',()=>{
  const rush=new GameEngine([fixtureLevel()]);rush.start();rush.advance(1234);
  const restoredRush=GameEngine.fromSave([fixtureLevel()],rush.exportSave());restoredRush.resume();restoredRush.advance(1000);
  assert.equal(restoredRush.getSnapshot().mode,'rush');assert.equal(restoredRush.getSnapshot().timeLeftMs,87766);
  for(const alter of [s=>s.timeLeftMs=null,s=>s.timeLeftMs=0,s=>s.phase='finished']) {
    const bad=rush.exportSave();alter(bad);assert.throws(()=>GameEngine.fromSave([fixtureLevel()],bad));
  }
  const practice=new GameEngine([fixtureLevel()],{mode:'practice'});practice.start();
  const restoredPractice=GameEngine.fromSave([fixtureLevel()],practice.exportSave());restoredPractice.resume();restoredPractice.advance(1000000);
  assert.equal(restoredPractice.getSnapshot().mode,'practice');assert.equal(restoredPractice.getSnapshot().timeLeftMs,null);
  for(const alter of [s=>s.timeLeftMs=90000,s=>s.phase='finished']) {
    const bad=practice.exportSave();alter(bad);assert.throws(()=>GameEngine.fromSave([fixtureLevel()],bad));
  }
});
test('public inputs reject unsupported modes, duplicate levels and invalid deltas',()=>{
  assert.throws(()=>new GameEngine([]));assert.throws(()=>new GameEngine([fixtureLevel()],{mode:'other'}));
  assert.throws(()=>new GameEngine([fixtureLevel(),fixtureLevel()]));
  const g=new GameEngine([fixtureLevel()]);assert.throws(()=>g.advance(-1));assert.throws(()=>g.advance(NaN));
});
test('all eight authored levels validate, begin unsolved, and hints lead safely to completion',async()=>{
  const levels=JSON.parse(await readFile(levelsURL,'utf8'));assert.equal(levels.length,8);
  const g=new GameEngine(levels,{mode:'practice'});g.start();
  for(let n=0;n<8;n++) {
    assert.equal(g.getSnapshot().stageIndex,n);assert.equal(g.getSnapshot().phase,'playing');
    assert.ok(levels[n].statements.length<=8);assert.ok(levels[n].fixtures.length>=2);
    let moves=0;while(g.getSnapshot().phase==='playing'&&moves++<10) {
      const h=g.hint();assert.ok(h,`level ${n+1} has a safe route`);const r=g.move(h.blockId,h.toIndex);assert.equal(r.accepted,true);
      assert.equal(isEquivalent(levels[n],g.getSnapshot().blocks).equivalent,true);
    }
    assert.equal(g.getSnapshot().phase,'cleared');assert.equal(g.nextLevel(),true);
  }
  assert.equal(g.getSnapshot().phase,'finished');assert.equal(g.getSnapshot().completed.length,8);
});
