function abortError(){return new DOMException('A newer screen replaced this request','AbortError');}

export class LevelService {
  constructor({baseUrl,validator,fetcher=globalThis.fetch.bind(globalThis),timeoutMs=7000}) {
    if(typeof validator!=='function') throw Error('Level validator is required');
    this.baseUrl=new URL(baseUrl);this.validator=validator;this.fetcher=fetcher;this.timeoutMs=timeoutMs;this.generation=0;this.controller=null;
  }
  async load({signal}={}) {
    this.controller?.abort();const controller=new AbortController();this.controller=controller;
    const generation=++this.generation;let timer;
    const abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)controller.abort();
    try {
      const request=(async()=>{
        const response=await this.fetcher(new URL('data/levels.json',this.baseUrl),{cache:'no-store',signal:controller.signal});
        if(!response.ok) throw Error('스테이지를 불러오지 못했어요. 다시 시도해 주세요.');
        const body=await response.json();
        if(controller.signal.aborted||generation!==this.generation)throw abortError();
        if(!body||body.schema!==1||!Array.isArray(body.levels)||!body.levels.length||body.levels.length>32)throw Error('스테이지 데이터가 올바르지 않아요.');
        const levels=body.levels.map(level=>this.validator(level));
        if(new Set(levels.map(level=>level.id)).size!==levels.length)throw Error('스테이지 번호가 중복됐어요.');
        return levels;
      })();
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('불러오는 시간이 길어지고 있어요. 다시 시도해 주세요.'));},this.timeoutMs);});
      return await Promise.race([request,timeout]);
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);if(this.controller===controller)this.controller=null;}
  }
  cancel(){this.generation++;this.controller?.abort();}
}
