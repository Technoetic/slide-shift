export class IndexedDbBackend {
  constructor({name='slide-shift-v1'}={}){this.name=name;this.opening=null;}
  async open(){
    if(this.opening)return this.opening;
    if(!globalThis.indexedDB)throw Error('이 브라우저에서는 기록 저장을 사용할 수 없어요.');
    this.opening=new Promise((resolve,reject)=>{
      let settled=false;
      const request=globalThis.indexedDB.open(this.name,1);
      const timer=setTimeout(()=>{settled=true;reject(Error('기록 저장소를 열지 못했어요. 다른 탭을 닫고 다시 시도해 주세요.'));},4500);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('items'))request.result.createObjectStore('items');};
      request.onerror=()=>{clearTimeout(timer);if(!settled){settled=true;reject(Error('기록 저장소 접근이 차단됐어요.'));}};
      request.onsuccess=()=>{clearTimeout(timer);if(settled){request.result.close();return;}settled=true;const db=request.result;db.onversionchange=()=>{db.close();this.opening=null;};resolve(db);};
    });
    try{return await this.opening;}catch(error){this.opening=null;throw error;}
  }
  async transaction(mode,action){
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('items',mode);let result;let failure;
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(failure||tx.error||Error('기록을 저장하지 못했어요.'));
      tx.onabort=()=>reject(failure||tx.error||Error('기록 저장이 중단됐어요.'));
      try{action(tx.objectStore('items'),value=>{result=value;},error=>{failure=error;tx.abort();});}catch(error){failure=error;tx.abort();}
    });
  }
  async get(key){return this.transaction('readonly',(store,done)=>{const request=store.get(key);request.onsuccess=()=>done(request.result);});}
  async put(key,value){return this.transaction('readwrite',(store,done)=>{store.put(value,key);done(value);});}
  async update(key,mutate){return this.transaction('readwrite',(store,done,fail)=>{
    const request=store.get(key);request.onsuccess=()=>{try{const value=mutate(request.result);if(value===undefined)store.delete(key);else store.put(value,key);done(value);}catch(error){fail(error);}};
  });}
}

function validateCheckpoint(value){
  if(value===undefined||value===null)return null;
  if(!value||value.schema!==1||typeof value.runId!=='string'||!value.runId||!value.game||typeof value.game!=='object'||Array.isArray(value.game)||typeof value.savedAt!=='string')throw Error('저장된 진행을 읽지 못했어요. 기록은 그대로 보관되어 있어요.');
  return value;
}
function validateRecords(value){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>100||value.some(row=>!row||typeof row.id!=='string'||!['rush','practice'].includes(row.mode)||!Number.isFinite(row.score)||row.score<0||!Number.isFinite(row.completed)||!Number.isFinite(row.safeMoves)||!Number.isFinite(row.strikes)||typeof row.date!=='string'))throw Error('저장된 기록을 읽지 못했어요. 기존 기록은 지우지 않았어요.');
  return value;
}

export class StorageService {
  constructor({backend=new IndexedDbBackend()}={}){this.backend=backend;this.pending=0;}
  async _write(action){this.pending++;try{return await action();}finally{this.pending--;}}
  async loadCheckpoint(){return validateCheckpoint(await this.backend.get('checkpoint'));}
  async saveCheckpoint({runId,game}){
    if(typeof runId!=='string'||!runId||!game||typeof game!=='object')throw Error('저장할 진행이 올바르지 않아요.');
    const value={schema:1,runId,game,savedAt:new Date().toISOString()};
    return this._write(()=>this.backend.put('checkpoint',value));
  }
  async clearCheckpoint(runId){return this._write(()=>this.backend.update('checkpoint',value=>value?.runId===runId?undefined:value));}
  async loadRecords(){return validateRecords(await this.backend.get('records')).slice().sort((a,b)=>b.score-a.score).slice(0,20);}
  async recordRun(record){
    validateRecords([record]);
    return this._write(()=>this.backend.update('records',value=>{
      const rows=validateRecords(value).filter(row=>row.id!==record.id);rows.push(structuredClone(record));
      return rows.sort((a,b)=>b.score-a.score).slice(0,20);
    }));
  }
}
