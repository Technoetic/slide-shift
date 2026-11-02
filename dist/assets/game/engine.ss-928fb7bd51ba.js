// A finite, authored teaching DSL. Equivalence covers its fixtures, not arbitrary JS.
const OWN = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const GROUPS = new Set(['power','signal','cargo','scan']);
const PHASES = new Set(['ready','playing','paused','cleared','finished']);
const FORBIDDEN = new Set(['__proto__','prototype','constructor']);
const LEVEL_KEYS = ['id','title','brief','goalLabel','goalIds','statements','fixtures','observe'];
const SAVE_KEYS = ['schema','levelsSignature','mode','phase','stageIndex','blockIds','history','timeLeftMs','score','combo','safeMoves','strikes','hints','completed','lastReason'];
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value!==null && typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
function fail(message) { throw new TypeError(message); }
function object(value,label) {
  if(value===null || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(`${label}: plain object required`);
  for(const key of Reflect.ownKeys(value)) {
    if(typeof key!=='string'||FORBIDDEN.has(key))fail(`${label}: forbidden object key`);
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor.enumerable || !OWN(descriptor,'value'))fail(`${label}: data properties required`);
  }
}
function keys(value,allowed,required=allowed,label='schema') {
  object(value,label);
  if(Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!OWN(value,key)))fail(`${label}: invalid schema keys`);
}
function array(value,label,min=0,max=100000) {
  if(!Array.isArray(value)||value.length<min||value.length>max)fail(`${label}: invalid array length`);
  const ownKeys=Reflect.ownKeys(value);
  if(ownKeys.length!==value.length+1)fail(`${label}: extra array properties`);
  for(let index=0;index<value.length;index++){
    const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
    if(!descriptor||!descriptor.enumerable||!OWN(descriptor,'value'))fail(`${label}: dense data array required`);
  }
  return value;
}
function text(value,label,max=240) { if(typeof value!=='string'||value.trim().length===0||value.length>max)fail(`${label}: nonempty string required`);return value; }
function name(value,label='variable') { text(value,label,64);if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)||FORBIDDEN.has(value))fail(`${label}: forbidden or invalid identifier`);return value; }
function id(value) { text(value,'id',64);if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)||FORBIDDEN.has(value))fail('invalid id');return value; }
function primitive(value) { if(!['number','boolean','string'].includes(typeof value)||(typeof value==='number'&&!Number.isFinite(value)))fail('finite primitive required');if(typeof value==='string'&&value.length>1000)fail('primitive string too long');return value; }
function expression(value,depth=0) {
  if(depth>24)fail('expression nesting too deep');
  if(value===null||typeof value!=='object')return primitive(value);
  object(value,'expression');const expressionKeys=Object.keys(value);
  if(expressionKeys.length!==1)fail('expression needs one operator');
  const operator=expressionKeys[0];
  if(operator==='var')return {var:name(value.var)};
  if(!['add','mul'].includes(operator))fail('invalid expression operator or operands');
  return {[operator]:array(value[operator],'operands',2,2).map(item=>expression(item,depth+1))};
}
function statement(value) {
  object(value,'statement');
  if(value.op==='set')keys(value,['id','group','label','code','op','target','value']);
  else if(value.op==='emit')keys(value,['id','group','label','code','op','value','channel'],['id','group','label','code','op','value']);
  else fail('invalid statement op');
  const result={id:id(value.id),group:value.group,label:text(value.label,'label'),code:text(value.code,'code',500),op:value.op};
  if(!GROUPS.has(value.group))fail('unknown statement group');
  if(value.op==='set')result.target=name(value.target);
  result.value=expression(value.value);
  if(value.op==='emit'&&OWN(value,'channel'))result.channel=text(value.channel,'channel',64);
  return result;
}
function input(value) {
  object(value,'input');const result={};
  for(const key of Object.keys(value)){name(key);result[key]=primitive(value[key]);}
  return result;
}
function evaluate(value,state) {
  if(value===null||typeof value!=='object')return value;
  if(OWN(value,'var')){if(!OWN(state,value.var))fail(`undefined variable: ${value.var}`);return state[value.var];}
  const operator=OWN(value,'add')?'add':'mul';const [a,b]=value[operator].map(item=>evaluate(item,state));
  if(typeof a!=='number'||typeof b!=='number')fail('arithmetic operands must be numbers');
  const result=operator==='add'?a+b:a*b;if(!Number.isFinite(result))fail('arithmetic result must be finite');return result;
}
function execute(blocks,inputs) {
  const state={...inputs},outputs=[];
  for(const block of blocks){const value=evaluate(block.value,state);if(block.op==='set')state[block.target]=value;else outputs.push({channel:block.channel??'output',value});}
  return {state,outputs};
}
function checkedBlocks(blocks) {
  const result=array(blocks,'blocks',1,8).map(statement);if(new Set(result.map(block=>block.id)).size!==result.length)fail('duplicate statement id');return result;
}
export function runProgram(blocks,inputs) { return execute(checkedBlocks(blocks),input(inputs)); }

export function validateLevel(level) {
  keys(level,LEVEL_KEYS);
  const result={id:id(level.id),title:text(level.title,'title'),brief:text(level.brief,'brief',1000),goalLabel:text(level.goalLabel,'goalLabel'),goalIds:[],statements:checkedBlocks(level.statements),fixtures:[],observe:[]};
  result.goalIds=array(level.goalIds,'goalIds',2,8).map(id);
  if(new Set(result.goalIds).size!==result.goalIds.length||result.goalIds.some(goal=>!result.statements.some(block=>block.id===goal)))fail('invalid goalIds');
  result.fixtures=array(level.fixtures,'fixtures',2,32).map(input);
  result.observe=array(level.observe,'observe',1,32).map(item=>name(item));if(new Set(result.observe).size!==result.observe.length)fail('duplicate observed variable');
  for(const fixture of result.fixtures){const run=execute(result.statements,fixture);for(const observed of result.observe)if(!OWN(run.state,observed))fail(`undefined observed variable: ${observed}`);}
  return result;
}
function equivalent(valid,blocks) {
  if(blocks.length!==valid.statements.length)return {equivalent:false,reason:'문장이 누락되거나 추가되었습니다.'};
  const originals=new Map(valid.statements.map(block=>[block.id,canonical(block)]));
  if(new Set(blocks.map(block=>block.id)).size!==blocks.length||blocks.some(block=>originals.get(block.id)!==canonical(block)))return {equivalent:false,reason:'원래 문장과 다른 카드입니다.'};
  for(let index=0;index<valid.fixtures.length;index++) {
    const baseline=execute(valid.statements,valid.fixtures[index]);let candidate;
    try { candidate=execute(blocks,valid.fixtures[index]); }
    catch(error) { return {equivalent:false,reason:`입력 ${index+1}: 정의되기 전 값을 읽습니다. (${error.message})`}; }
    if(canonical(baseline.outputs)!==canonical(candidate.outputs))return {equivalent:false,reason:`입력 ${index+1}: 출력 값 또는 출력 순서가 달라집니다.`};
    if(valid.observe.some(variable=>!OWN(candidate.state,variable)||baseline.state[variable]!==candidate.state[variable]))return {equivalent:false,reason:`입력 ${index+1}: 최종 관찰 값이 달라집니다.`};
  }
  return {equivalent:true,reason:'모든 입력에서 관찰 값과 출력 순서를 보존합니다.'};
}
export function isEquivalent(level,blocks) {
  const valid=validateLevel(level);
  try { return equivalent(valid,checkedBlocks(blocks)); }
  catch(error) { return {equivalent:false,reason:`유효하지 않은 문장: ${error.message}`}; }
}
function progress(level,blocks) {
  const goals=new Set(level.goalIds);let current=0,longest=0;
  for(const block of blocks){current=goals.has(block.id)?current+1:0;longest=Math.max(longest,current);}
  return {current:longest,total:goals.size};
}
const solved = (level,blocks) => {const p=progress(level,blocks);return p.current===p.total;};
function freeze(value) { if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value; }
function reordered(blocks,from,to) { const result=blocks.slice();const [block]=result.splice(from,1);result.splice(to,0,block);return result; }
function hintPath(level,blocks) {
  const key = order => order.map(block=>block.id).join('|');
  const queue=[{blocks,first:null}],seen=new Set([key(blocks)]);
  for(let cursor=0;cursor<queue.length;cursor++) {
    const node=queue[cursor];
    for(let from=0;from<blocks.length;from++)for(let to=0;to<blocks.length;to++) {
      if(from===to)continue;const next=reordered(node.blocks,from,to),nextKey=key(next);
      if(seen.has(nextKey))continue;seen.add(nextKey);
      if(!equivalent(level,next).equivalent)continue;
      const first=node.first??{blockId:node.blocks[from].id,toIndex:to,reason:'관찰 결과를 지키면서 관련 문장을 모으는 안전한 경로입니다.'};
      if(solved(level,next))return first;queue.push({blocks:next,first});
    }
  }
  return null;
}
function integer(value,label,max=Number.MAX_SAFE_INTEGER) { if(!Number.isSafeInteger(value)||value<0||value>max)fail(`invalid ${label}`);return value; }

export class GameEngine {
  #levels;#mode;#phase='ready';#stageIndex=0;#blocks;#timeLeftMs;#score=0;#combo=0;#safeMoves=0;#strikes=0;#hints=0;#completed=[];#history=[];#lastReason='관련 문장을 모으고 실행 결과를 지키세요.';
  constructor(levels,options={}) {
    keys(options,['mode'],[],'options');const mode=options.mode??'rush';
    this.#levels=array(levels,'levels',1,32).map(validateLevel);
    if(new Set(this.#levels.map(level=>level.id)).size!==levels.length)fail('duplicate level id');
    if(!['rush','practice'].includes(mode))fail('invalid mode');
    this.#mode=mode;this.#timeLeftMs=mode==='rush'?90000:null;this.#blocks=this.#level.statements.slice();
  }
  get #level(){return this.#levels[this.#stageIndex];}
  #penalty(ms){this.#combo=0;if(this.#mode==='rush'){this.#timeLeftMs=Math.max(0,this.#timeLeftMs-ms);if(this.#timeLeftMs===0){this.#phase='finished';this.#lastReason='시간이 끝났습니다.';}}}
  start(){if(this.#phase!=='ready')return false;this.#phase='playing';return true;}
  pause(){if(this.#phase!=='playing')return false;this.#phase='paused';return true;}
  resume(){if(this.#phase!=='paused')return false;this.#phase='playing';return true;}
  advance(deltaMs){if(typeof deltaMs!=='number'||!Number.isFinite(deltaMs)||deltaMs<0)fail('deltaMs must be finite and nonnegative');if(this.#phase==='playing'&&this.#mode==='rush'){this.#timeLeftMs=Math.max(0,this.#timeLeftMs-deltaMs);if(this.#timeLeftMs===0){this.#phase='finished';this.#lastReason='시간이 끝났습니다.';}}return this.#phase;}
  nextLevel(){
    if(this.#phase!=='cleared')return false;
    if(this.#stageIndex===this.#levels.length-1){this.#phase='finished';this.#lastReason='모든 단계를 완료했습니다.';return true;}
    this.#stageIndex++;this.#blocks=this.#level.statements.slice();this.#history=[];this.#phase='playing';this.#lastReason='다음 단계입니다. 관련 문장을 모으세요.';return true;
  }
  move(blockId,targetIndex){
    const reject=reason=>({accepted:false,reason,solved:false,points:0});
    if(this.#phase!=='playing')return reject('진행 중인 게임에서만 이동할 수 있습니다.');
    const from=this.#blocks.findIndex(block=>block.id===blockId);
    if(from<0||!Number.isInteger(targetIndex)||targetIndex<0||targetIndex>=this.#blocks.length||from===targetIndex)return reject('이동할 카드와 다른 유효한 위치를 고르세요.');
    const next=reordered(this.#blocks,from,targetIndex),check=equivalent(this.#level,next);
    if(!check.equivalent){this.#strikes++;this.#lastReason=check.reason;this.#penalty(3000);return reject(check.reason);}
    this.#history.push(this.#blocks.map(block=>block.id));this.#blocks=next;this.#safeMoves++;this.#lastReason=check.reason;
    const done=solved(this.#level,next);let points=0;
    if(done){points=100+this.#combo*25;this.#score+=points;this.#combo++;this.#completed.push(this.#level.id);this.#phase='cleared';this.#history=[];this.#lastReason='관찰 결과를 지키며 관련 문장을 모두 모았습니다.';}
    return {accepted:true,reason:this.#lastReason,solved:done,points};
  }
  undo(){if(this.#phase!=='playing'||this.#history.length===0)return false;const ids=this.#history.pop();this.#blocks=ids.map(id=>this.#level.statements.find(block=>block.id===id));this.#lastReason='이전 배치로 돌아왔습니다. 시간은 되돌리지 않습니다.';return true;}
  hint(){if(this.#phase!=='playing')return null;const hint=hintPath(this.#level,this.#blocks);if(!hint)return null;this.#hints++;this.#lastReason=hint.reason;this.#penalty(5000);return hint;}
  getSnapshot(){return freeze(copy({phase:this.#phase,mode:this.#mode,stageIndex:this.#stageIndex,levelsTotal:this.#levels.length,level:this.#level,blocks:this.#blocks,timeLeftMs:this.#timeLeftMs,score:this.#score,combo:this.#combo,safeMoves:this.#safeMoves,strikes:this.#strikes,hints:this.#hints,completed:this.#completed,canUndo:this.#phase==='playing'&&this.#history.length>0,progress:progress(this.#level,this.#blocks),lastReason:this.#lastReason}));}
  exportSave(){return copy({schema:1,levelsSignature:canonical(this.#levels),mode:this.#mode,phase:this.#phase,stageIndex:this.#stageIndex,blockIds:this.#blocks.map(block=>block.id),history:this.#history,timeLeftMs:this.#timeLeftMs,score:this.#score,combo:this.#combo,safeMoves:this.#safeMoves,strikes:this.#strikes,hints:this.#hints,completed:this.#completed,lastReason:this.#lastReason});}
  static fromSave(levels,save){
    keys(save,SAVE_KEYS);if(save.schema!==1)fail('unsupported save schema');
    const mode=save.mode;if(!['rush','practice'].includes(mode))fail('invalid saved mode');
    const engine=new GameEngine(levels,{mode});
    if(save.levelsSignature!==canonical(engine.#levels))fail('레벨 signature가 달라 저장본을 복원할 수 없습니다.');
    if(!PHASES.has(save.phase))fail('invalid phase');engine.#stageIndex=integer(save.stageIndex,'stageIndex',engine.#levels.length-1);
    if(mode==='rush'){if(typeof save.timeLeftMs!=='number'||!Number.isFinite(save.timeLeftMs)||save.timeLeftMs<0||save.timeLeftMs>90000)fail('invalid timeLeftMs');}
    else if(save.timeLeftMs!==null)fail('practice timeLeftMs must be null');
    for(const key of ['score','combo','safeMoves','strikes','hints'])integer(save[key],key);
    array(save.completed,'completed',0,engine.#levels.length);
    if(save.completed.some((id,index)=>id!==engine.#levels[index].id))fail('invalid completed levels');
    const expectedCompleted=save.phase==='cleared'?engine.#stageIndex+1:engine.#stageIndex;
    const allFinished=save.phase==='finished'&&save.completed.length===engine.#levels.length&&engine.#stageIndex===engine.#levels.length-1;
    if(!allFinished&&save.completed.length!==expectedCompleted)fail('phase and completed levels disagree');
    if(save.combo>save.completed.length)fail('invalid combo');
    const count=save.completed.length;
    if(save.score<100*count||save.score>100*count+25*count*(count-1)/2||save.score%25!==0||save.safeMoves<count)fail('invalid score or completion statistics');
    if(save.phase==='ready'&&(engine.#stageIndex!==0||save.completed.length!==0))fail('invalid ready checkpoint');
    if(mode==='rush'&&((save.timeLeftMs===0&&save.phase!=='finished')||(save.phase==='finished'&&!allFinished&&save.timeLeftMs!==0)))fail('timer and phase disagree');
    if(mode==='practice'&&save.phase==='finished'&&!allFinished)fail('incomplete practice result');
    const readOrder=ids=>{
      array(ids,'blockIds',engine.#level.statements.length,engine.#level.statements.length);
      if(new Set(ids).size!==ids.length)fail('invalid saved blockIds');
      const blocks=ids.map(id=>engine.#level.statements.find(block=>block.id===id));
      if(blocks.some(block=>!block)||!equivalent(engine.#level,blocks).equivalent)fail('saved board is not equivalent');return blocks;
    };
    engine.#blocks=readOrder(save.blockIds);
    if(save.phase!=='ready'&&(save.phase==='cleared'||allFinished)!==solved(engine.#level,engine.#blocks))fail('board and phase disagree');
    array(save.history,'history',0,save.safeMoves);
    engine.#history=save.history.map(ids=>{const board=readOrder(ids);if(solved(engine.#level,board))fail('undo history cannot contain a cleared board');return ids.slice();});
    if((save.phase==='cleared'||allFinished)&&engine.#history.length)fail('completed checkpoint has undo history');
    if(engine.#history.length){
      if(canonical(engine.#history[0])!==canonical(engine.#level.statements.map(block=>block.id)))fail('undo history must start at the original board');
      const orders=[...engine.#history,save.blockIds];
      for(let index=1;index<orders.length;index++){
        let adjacent=false;
        for(let from=0;from<orders[index-1].length&&!adjacent;from++)for(let to=0;to<orders[index-1].length&&!adjacent;to++)if(from!==to&&canonical(reordered(orders[index-1],from,to))===canonical(orders[index]))adjacent=true;
        if(!adjacent)fail('undo history has an impossible move');
      }
    }
    if(save.phase==='ready'&&(save.score||save.combo||save.safeMoves||save.strikes||save.hints||save.history.length||canonical(save.blockIds)!==canonical(engine.#level.statements.map(block=>block.id))||(mode==='rush'&&save.timeLeftMs!==90000)))fail('ready checkpoint contains gameplay');
    text(save.lastReason,'lastReason',2000);
    engine.#phase=['playing','paused'].includes(save.phase)?'paused':save.phase;
    engine.#timeLeftMs=save.timeLeftMs;engine.#score=save.score;engine.#combo=save.combo;engine.#safeMoves=save.safeMoves;engine.#strikes=save.strikes;engine.#hints=save.hints;engine.#completed=save.completed.slice();engine.#lastReason=save.lastReason;
    return engine;
  }
}
