import {GameEngine,runProgram} from '../game/engine.js';
import {escapeHtml as esc,groupNames,countCompleted,listen,focusHeading} from '../shared/dom.js';

export class GameScreen {
  constructor(root,env,route){
    Object.assign(this,{root,env,route});this.abort=new AbortController();this.alive=true;this.engine=null;
    this.selectedId=null;this.revision=0;this.savedRevision=-1;this.discarded=false;this.resultSaved=false;
    this.recordSaving=false;this.recordError='';this.frame=0;this.lastFrame=0;this.hintId=null;this.drag=null;
    this.runId=crypto.randomUUID();this.phase=null;this.timers=new Set();
  }
  async mount(){
    this.root.innerHTML='<main class="page-screen loading-state" aria-live="polite"><p class="kicker">GET READY</p><h1>블록을 준비하고 있어요.</h1><p class="muted">같은 결과, 더 좋은 흐름.</p></main>';
    try{
      const levels=await this.env.levels.load({signal:this.abort.signal});
      if(!this.alive)return;
      if(this.route.params.get('resume')==='1'){
        const checkpoint=await this.env.storage.loadCheckpoint();if(!this.alive)return;
        if(!checkpoint)throw Error('저장된 진행이 없어요. 새 도전을 시작해 주세요.');
        this.engine=GameEngine.fromSave(levels,checkpoint.game);this.runId=checkpoint.runId;this.savedRevision=0;
      }else{
        const mode=this.route.params.get('mode')==='practice'?'practice':'rush';
        this.engine=new GameEngine(levels,{mode});this.engine.start();
      }
      if(document.hidden&&this.engine.getSnapshot().phase==='playing')this.engine.pause();
      this.selectedId=this.engine.getSnapshot().blocks[0]?.id;this.bind();this.render();
      this.lastFrame=performance.now();this.frame=requestAnimationFrame(time=>this.tick(time));focusHeading(this.root);
    }catch(error){
      if(!this.alive||error.name==='AbortError')return;
      this.root.innerHTML=`<main class="page-screen error-state"><p class="kicker">잠시만요</p><h1>스테이지를 열지 못했어요.</h1><p>${esc(error.message)}</p><div class="controls"><button class="button button-primary" data-retry>다시 시도</button><a class="button button-secondary" data-route="/" href="#/">홈으로</a></div></main>`;
      this.root.querySelector('[data-retry]').addEventListener('click',()=>this.mount(),{once:true,signal:this.abort.signal});
    }
  }
  bind(){
    const signal=this.abort.signal;
    listen(this.root,'click',event=>{
      const action=event.target.closest('[data-game-action]');
      if(action){this.action(action.dataset.gameAction,action.dataset.id);return;}
      const row=event.target.closest('[data-block-id]');if(row)this.select(row.dataset.blockId);
    },signal);
    listen(document,'keydown',event=>{
      if(this.env.modalOpen||(event.target instanceof Element&&event.target.matches('input,textarea,[contenteditable="true"]'))||event.ctrlKey||event.metaKey||event.altKey)return;
      const key=event.key.toLowerCase();
      if(event.repeat&&['p','h','z'].includes(key))return;
      if(['arrowup','arrowdown','w','s','z','h','p'].includes(key))event.preventDefault();else return;
      const snapshot=this.engine.getSnapshot();
      if(key==='p'){this.action('pause');return;}
      if(snapshot.phase!=='playing')return;
      if(key==='arrowup'||key==='arrowdown'){
        const n=snapshot.blocks.findIndex(row=>row.id===this.selectedId);this.select(snapshot.blocks[Math.max(0,Math.min(snapshot.blocks.length-1,n+(key==='arrowup'?-1:1)))].id);
      }else this.action({w:'up',s:'down',z:'undo',h:'hint'}[key]);
    },signal);
    listen(document,'visibilitychange',()=>{if(document.hidden&&this.engine.getSnapshot().phase==='playing'){this.engine.pause();this.revision++;this.render();}},signal);
    listen(this.root,'pointerdown',event=>this.dragStart(event),signal);
    listen(document,'pointermove',event=>this.dragMove(event),signal,{passive:false});
    listen(document,'pointerup',event=>this.dragEnd(event),signal);
    listen(document,'pointercancel',()=>this.clearDrag(),signal);
  }
  tick(time){
    if(!this.alive)return;
    const before=this.engine.getSnapshot().phase;
    const delta=Math.max(0,time-this.lastFrame);
    // Some minimized windows suspend frames without firing visibilitychange.
    if(before==='playing'&&delta>1800){this.engine.pause();this.revision++;}
    else this.engine.advance(delta);
    this.lastFrame=time;
    const after=this.engine.getSnapshot();
    if(after.phase!==before)this.render();else this.renderTime(after);
    this.frame=requestAnimationFrame(next=>this.tick(next));
  }
  select(id){
    this.selectedId=id;
    for(const row of this.root.querySelectorAll('[data-block-id]')){
      const selected=row.dataset.blockId===id;row.classList.toggle('is-selected',selected);row.tabIndex=selected?0:-1;
      if(selected)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
    }
  }
  action(action,id){
    if(!this.engine||this.env.modalOpen)return;
    const state=this.engine.getSnapshot();
    if(action==='pause'){
      if(state.phase==='playing'){this.engine.pause();this.revision++;}
      else if(state.phase==='paused'){this.engine.resume();this.revision++;this.lastFrame=performance.now();}
      this.render();return;
    }
    if(action==='next'&&state.phase==='cleared'){
      this.engine.nextLevel();this.revision++;this.selectedId=this.engine.getSnapshot().blocks[0]?.id;this.hintId=null;this.render();return;
    }
    if(action==='retry-save'&&state.phase==='finished'){this.finishRecord();return;}
    if(state.phase!=='playing')return;
    if(id)this.select(id);
    if(action==='up'||action==='down'){
      const index=state.blocks.findIndex(row=>row.id===this.selectedId);this.move(this.selectedId,index+(action==='up'?-1:1));
    }else if(action==='undo'){
      if(this.engine.undo()){this.revision++;this.hintId=null;this.env.toast('한 수 되돌렸어요. 시간은 돌아가지 않아요.');this.render();}
    }else if(action==='hint'){
      const hint=this.engine.hint();this.revision++;
      if(hint){this.hintId=hint.blockId;this.select(hint.blockId);this.env.toast(`${state.mode==='rush'?'−5초 · ':''}이 카드를 ${hint.toIndex+1}번째 자리로 옮겨 보세요.`, 'hint');}
      else this.env.toast('지금은 표시할 힌트가 없어요. 다른 블록을 골라 보세요.');
      this.render();
    }
  }
  move(id,index){
    const before=this.engine.getSnapshot();
    if(before.phase!=='playing'||index<0||index>=before.blocks.length||before.blocks[index]?.id===id)return;
    const result=this.engine.move(id,index);this.revision++;this.hintId=null;
    if(result.accepted){this.env.sound.play(result.solved?'clear':'move');if(result.solved){this.env.toast(`FLOW! +${result.points}점 · 결과는 그대로`,'success');this.env.burst();}}
    else{this.env.sound.play('invalid');this.env.toast(`${before.mode==='rush'?'−3초 · ':''}${result.reason||'실행 결과가 달라져 이동을 막았어요.'}`,'error');}
    this.render();
    if(!result.accepted){const row=this.root.querySelector(`[data-block-id="${CSS.escape(id)}"]`);row?.classList.add('is-invalid');this.later(()=>row?.classList.remove('is-invalid'),430);}
  }
  dragStart(event){
    const handle=event.target.closest('[data-drag-id]');
    if(!handle||event.button!==0||this.env.modalOpen||this.engine.getSnapshot().phase!=='playing')return;
    event.preventDefault();const id=handle.dataset.dragId;this.select(id);
    const row=handle.closest('[data-block-id]');
    this.drag={id,pointerId:event.pointerId,fromY:event.clientY,target:this.engine.getSnapshot().blocks.findIndex(block=>block.id===id),row,handle};
    handle.setPointerCapture?.(event.pointerId);row.classList.add('is-dragging');
  }
  dragMove(event){
    if(!this.drag||event.pointerId!==this.drag.pointerId)return;event.preventDefault();
    const rows=[...this.root.querySelectorAll('[data-block-id]')];
    let closest=0,distance=Infinity;
    rows.forEach((row,index)=>{const rect=row.getBoundingClientRect();const next=Math.abs(event.clientY-(rect.top+rect.height/2));if(next<distance){distance=next;closest=index;}row.classList.remove('drop-target');});
    this.drag.target=closest;rows[closest]?.classList.add('drop-target');
  }
  dragEnd(event){
    if(!this.drag||event.pointerId!==this.drag.pointerId)return;
    const {id,target,fromY}=this.drag;this.clearDrag();if(Math.abs(event.clientY-fromY)>6)this.move(id,target);
  }
  clearDrag(){
    if(!this.drag)return;
    try{this.drag.handle.releasePointerCapture?.(this.drag.pointerId);}catch{}
    for(const row of this.root.querySelectorAll('.is-dragging,.drop-target'))row.classList.remove('is-dragging','drop-target');this.drag=null;
  }
  renderTime(state){
    const times=this.root.querySelectorAll('[data-time]');if(!times.length)return;
    const practice=state.mode==='practice';for(const time of times)time.textContent=practice?'∞':Math.max(0,state.timeLeftMs/1000).toFixed(1);
    const fill=this.root.querySelector('.timer-fill');if(fill)fill.style.width=`${practice?100:Math.max(0,Math.min(100,state.timeLeftMs/900))}%`;
    this.root.classList.toggle('time-critical',!practice&&state.timeLeftMs<15000);
  }
  observation(blocks,level){
    try{const result=runProgram(blocks,level.fixtures[0]);const values=level.observe.map(key=>`${key}: ${result.state[key]}`);return [...values,...result.outputs.map(item=>`${item.channel}: ${item.value}`)].join(' · ');}
    catch{return '결과를 계산하지 못했어요.';}
  }
  render(){
    if(!this.alive||!this.engine)return;
    this.clearDrag();const state=this.engine.getSnapshot();this.phase=state.phase;
    if(state.phase==='finished'){this.renderResult(state);this.finishRecord();return;}
    const level=state.level;const playable=state.phase==='playing';
    if(!state.blocks.some(block=>block.id===this.selectedId))this.selectedId=state.blocks[0]?.id;
    const rows=state.blocks.map((block,index)=>{
      const goal=level.goalIds.includes(block.id);
      return `<li class="statement ${this.selectedId===block.id?'is-selected':''} ${this.hintId===block.id?'is-hinted':''}" data-group="${esc(block.group)}" data-block-id="${esc(block.id)}" tabindex="${this.selectedId===block.id?0:-1}" ${this.selectedId===block.id?'aria-current="true"':''}>
        <button class="statement-handle" data-drag-id="${esc(block.id)}" aria-label="${esc(block.label)} 드래그하여 옮기기" ${playable?'':'disabled'}>⠿</button>
        <span class="statement-number">${String(index+1).padStart(2,'0')}</span><div class="statement-body"><span class="statement-label">${esc(block.label)} ${goal?'<span class="goal-mark" aria-label="목표 카드">◆</span>':''}</span><code class="statement-code">${esc(block.code)}</code></div>
        <span class="statement-group">${esc(groupNames[block.group]||block.group)}</span><span class="statement-actions"><button data-game-action="up" data-id="${esc(block.id)}" aria-label="${esc(block.label)} 위로" ${playable&&index>0?'':'disabled'}>↑</button><button data-game-action="down" data-id="${esc(block.id)}" aria-label="${esc(block.label)} 아래로" ${playable&&index<state.blocks.length-1?'':'disabled'}>↓</button></span></li>`;
    }).join('');
    this.root.innerHTML=`<main class="game-layout"><section class="game-main" aria-labelledby="stage-title">
      <div class="game-topline"><a class="text-link" href="#/" data-route="/">← 나가기</a><p class="kicker">${state.mode==='practice'?'PRACTICE':'RUSH'} / ${String(state.stageIndex+1).padStart(2,'0')} <span class="muted">OF ${state.levelsTotal}</span></p></div>
      <h1 id="stage-title">${esc(level.title)}</h1><p class="game-brief muted">${esc(level.brief)}</p>
      <div class="hud mobile-hud" aria-label="진행 상황"><div class="hud-cell"><span>${state.mode==='practice'?'시간 제한 없음':'남은 시간'}</span><strong data-time>90.0</strong></div><div class="hud-cell"><span>점수</span><strong data-score>${state.score.toLocaleString()}</strong></div><div class="hud-cell"><span>콤보</span><strong>${state.combo} ×</strong></div></div>
      <div class="goal-line"><span>◆ ${esc(level.goalLabel)}</span><strong data-progress>${state.progress.current} / ${state.progress.total}</strong></div>
      <ol class="board" aria-label="실행 순서. 위아래 화살표로 카드를 고르고 W와 S로 옮기세요.">${rows}</ol>
      <div class="controls game-controls">${state.phase==='cleared'?'<button class="button button-primary next-stage-control" data-game-action="next">다음 스테이지 →</button>':`<button class="control-btn" data-game-action="up" ${playable?'':'disabled'}>↑ 위로 <kbd>W</kbd></button><button class="control-btn" data-game-action="down" ${playable?'':'disabled'}>↓ 아래로 <kbd>S</kbd></button><button class="control-btn" data-game-action="undo" ${playable&&state.canUndo?'':'disabled'}>되돌리기 <kbd>Z</kbd></button><button class="control-btn" data-game-action="hint" ${playable?'':'disabled'}>힌트 <kbd>H</kbd></button><button class="control-btn" data-game-action="pause">${state.phase==='paused'?'계속하기':'일시정지'} <kbd>P</kbd></button>`}</div>
      <p class="play-help muted">↑ ↓ 선택 · W S 이동 · 손잡이를 끌어서 이동 · ◆ 목표 카드를 이으세요</p>
      ${state.phase==='cleared'?`<section class="stage-banner" aria-live="polite"><p class="kicker">FLOW LOCKED</p><h2>같은 결과, 더 좋은 흐름.</h2><p>목표 카드가 한곳에 모였어요. ${state.combo} 콤보!</p><button class="button button-primary" data-game-action="next">다음 스테이지 →</button></section>`:''}
      ${state.phase==='paused'?`<section class="stage-banner pause-panel"><p class="kicker">PAUSED</p><h2>잠깐 쉬어가도 좋아요.</h2><p>시간과 블록을 그대로 멈췄어요.</p><button class="button button-primary" data-game-action="pause">계속하기 →</button></section>`:''}
      </section><aside class="game-aside"><div class="hud desktop-hud"><div class="hud-cell"><span>${state.mode==='practice'?'시간 제한 없음':'남은 시간'}</span><strong data-time>90.0</strong></div><div class="hud-cell"><span>점수</span><strong data-score>${state.score.toLocaleString()}</strong></div><div class="hud-cell"><span>콤보</span><strong data-combo>${state.combo}<small> ×</small></strong></div><div class="hud-cell"><span>성공한 이동</span><strong>${state.safeMoves}</strong></div></div>
      <div class="timer-track" aria-hidden="true"><div class="timer-fill"></div></div>
      <section class="output-panel"><div class="output-heading"><span>결과 비교</span><strong class="output-status">그대로 유지</strong></div><div class="output-row"><span>원래</span><code>${esc(this.observation(level.statements,level))}</code></div><div class="output-row"><span>지금</span><code>${esc(this.observation(state.blocks,level))}</code></div><p class="muted">${level.fixtures.length}가지 입력에서 확인해요.<br>값을 쓰기 전에 준비하는 순서를 지켜 주세요.</p></section>
      <section class="rules-note"><p class="kicker">KEEP THE FLOW</p><p>관련된 카드는 가까이.<br>실행 결과는 그대로.</p><ul class="muted"><li>결과가 달라지면 ${state.mode==='practice'?'이동 차단':'이동 차단 · −3초'}</li><li>힌트 ${state.mode==='practice'?'시간 차감 없음':'−5초'}</li><li>완료한 단계만 점수 획득</li></ul></section>
      <a class="text-link" href="#/guide" data-route="/guide">플레이 가이드 ↗</a></aside></main>`;
    this.renderTime(state);
  }
  renderResult(state){
    const complete=countCompleted(state.completed);const win=complete===state.levelsTotal;
    this.root.innerHTML=`<main class="page-screen result-panel"><p class="kicker">${win?'ALL SYSTEMS FLOW':'RUN COMPLETE'}</p><h1>${win?'흐름의 마스터.':'좋은 한 수였어요.'}</h1><p class="result-score" data-final-score>${state.score.toLocaleString()}<small>점</small></p><p>${complete} / ${state.levelsTotal} 단계 완료 · 안전한 이동 ${state.safeMoves}회</p><p class="muted">${state.mode==='practice'?'천천히 이해한 순서가 다음 도전의 힘이 돼요.':'관련된 문장은 가까이, 결과는 그대로. 한 번 더 흐름을 이어 볼까요?'}</p><p data-save-status aria-live="polite">${this.resultSaved?'이 브라우저에 기록을 저장했어요.':this.recordError?esc(this.recordError):'기록을 저장하고 있어요…'}</p><div class="controls"><a class="button button-primary" href="#/play?mode=${state.mode}" data-route="/play?mode=${state.mode}">다시 도전 ↗</a><a class="button button-secondary" href="#/records" data-route="/records">내 기록</a>${this.recordError?'<button class="button button-secondary" data-game-action="retry-save">저장 다시 시도</button>':''}<a class="button button-ghost" href="#/" data-route="/">홈으로</a></div></main>`;
  }
  async finishRecord(){
    if(this.resultSaved||this.recordSaving||!this.engine||this.engine.getSnapshot().phase!=='finished')return;
    this.recordSaving=true;this.recordError='';const state=this.engine.getSnapshot();if(this.alive)this.renderResult(state);
    try{
      await this.env.storage.recordRun({id:this.runId,mode:state.mode,score:state.score,completed:countCompleted(state.completed),safeMoves:state.safeMoves,strikes:state.strikes,date:new Date().toISOString()});
      this.resultSaved=true;this.savedRevision=this.revision;
      try{await this.env.storage.clearCheckpoint(this.runId);}catch{this.env.toast('기록은 저장했지만 이전 진행을 정리하지 못했어요.');}
    }catch{this.recordError='기록을 저장하지 못했어요. 결과는 이 화면에 남아 있어요.';}
    finally{this.recordSaving=false;if(this.alive)this.renderResult(this.engine.getSnapshot());}
  }
  isDirty(){if(this.discarded||!this.engine)return false;if(this.engine.getSnapshot().phase==='finished')return !this.resultSaved;return this.revision!==this.savedRevision;}
  pauseForNavigation(){if(this.engine?.getSnapshot().phase==='playing'){this.engine.pause();this.revision++;this.render();}}
  async saveForNavigation(){
    if(!this.engine)return;
    if(this.engine.getSnapshot().phase==='finished'){
      await this.finishRecord();if(!this.resultSaved)throw Error(this.recordError||'기록 저장이 아직 끝나지 않았어요.');return;
    }
    this.pauseForNavigation();const revision=this.revision;
    await this.env.storage.saveCheckpoint({runId:this.runId,game:this.engine.exportSave()});
    if(this.revision===revision)this.savedRevision=revision;
  }
  discard(){this.discarded=true;}
  later(action,delay){const timer=setTimeout(()=>{this.timers.delete(timer);if(this.alive)action();},delay);this.timers.add(timer);}
  dispose(){this.alive=false;this.abort.abort();cancelAnimationFrame(this.frame);this.clearDrag();for(const timer of this.timers)clearTimeout(timer);}
}
