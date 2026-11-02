import {validateLevel} from './game/engine.ss-7d78cc817c24.js';
import {GameScreen} from './screens/game-screen.ss-7d78cc817c24.js';
import {HomeScreen,GuideScreen,RecordsScreen,MissingScreen} from './screens/info-screens.ss-7d78cc817c24.js';
import {LevelService} from './services/level-service.ss-7d78cc817c24.js';
import {StorageService} from './services/storage-service.ss-7d78cc817c24.js';
import {VersionService} from './services/version-service.ss-7d78cc817c24.js';
import {Router} from './services/router.ss-7d78cc817c24.js';
import {SoundService} from './services/sound-service.ss-7d78cc817c24.js';
import {escapeHtml as esc} from './shared/dom.ss-7d78cc817c24.js';

class SlideShiftApp {
  constructor(){
    this.baseUrl=new URL(document.querySelector('meta[name="app-base"]').content,location.href);
    this.loadedBuild=document.querySelector('meta[name="app-build"]').content;
    this.storage=new StorageService();this.sound=new SoundService();
    this.levels=new LevelService({baseUrl:this.baseUrl,validator:validateLevel});
    this.version=new VersionService({baseUrl:this.baseUrl,loadedBuild:this.loadedBuild});
    this.modalOpen=false;this.currentScreen=null;this.screenGeneration=0;
  }
  async start(){
    const app=document.querySelector('#app');
    app.replaceChildren(document.querySelector('#header-template').content.cloneNode(true));
    this.updateNotice=document.createElement('div');this.updateNotice.className='update-notice';this.updateNotice.setAttribute('role','status');this.updateNotice.hidden=true;app.append(this.updateNotice);
    this.screenRoot=document.createElement('div');this.screenRoot.id='screen';app.append(this.screenRoot);
    this.toastRoot=document.createElement('div');this.toastRoot.className='toast';this.toastRoot.hidden=true;this.toastRoot.setAttribute('role','status');this.toastRoot.setAttribute('aria-live','polite');document.body.append(this.toastRoot);
    this.router=new Router({baseUrl:this.baseUrl,version:this.version,readState:()=>({dirty:!!this.currentScreen?.isDirty(),saving:this.storage.pending>0}),onNavigate:route=>this.renderRoute(route),onProtect:request=>this.protect(request),onUpdate:version=>this.showUpdate(version),onError:error=>this.toast(error.message,'error')});
    const soundButton=document.querySelector('[data-action="sound"]');
    soundButton.addEventListener('click',()=>{const enabled=this.sound.toggle();soundButton.setAttribute('aria-pressed',String(enabled));soundButton.setAttribute('aria-label',enabled?'소리 끄기':'소리 켜기');soundButton.querySelector('.sound-label').textContent=enabled?'소리 켬':'소리 끔';});
    addEventListener('beforeunload',event=>{if(this.currentScreen?.isDirty()||this.storage.pending){event.preventDefault();event.returnValue='';}});
    await this.router.start();
  }
  async renderRoute(route){
    const generation=++this.screenGeneration;
    this.currentScreen?.dispose();this.currentScreen=null;this.levels.cancel();
    for(const link of document.querySelectorAll('.site-nav a[data-route]')){
      const current=link.dataset.route===(route.path==='/play'?'/':route.path);if(current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    }
    const env={storage:this.storage,levels:this.levels,sound:this.sound,toast:(message,kind)=>this.toast(message,kind),burst:()=>this.burst(),get modalOpen(){return document.querySelector('.leave-dialog[open]')!==null;}};
    const Type=route.path==='/'?HomeScreen:route.path==='/play'?GameScreen:route.path==='/guide'?GuideScreen:route.path==='/records'?RecordsScreen:MissingScreen;
    const screen=new Type(this.screenRoot,env,route);this.currentScreen=screen;
    await screen.mount();if(generation!==this.screenGeneration)return;
    document.title=route.path==='/play'?'플레이 — SLIDE / SHIFT':route.path==='/guide'?'플레이 가이드 — SLIDE / SHIFT':route.path==='/records'?'내 기록 — SLIDE / SHIFT':'SLIDE / SHIFT — 순서는 바꿔라. 결과는 지켜라.';
    scrollTo({top:0,behavior:'instant'});
  }
  showUpdate(version){
    if(version.pendingBuild){this.updateNotice.hidden=false;this.updateNotice.textContent='새 버전이 준비됐어요. 진행 중인 도전은 보호하고, 다음 안전한 화면 이동에 적용해요.';}
    else this.updateNotice.hidden=true;
  }
  async protect({changed}){
    this.currentScreen?.pauseForNavigation?.();
    const screen=this.currentScreen;const dialog=document.createElement('dialog');dialog.className='leave-dialog';
    dialog.setAttribute('aria-labelledby','leave-title');
    dialog.innerHTML=`<section class="dialog"><p class="kicker">KEEP YOUR FLOW</p><h2 id="leave-title">진행을 남겨 둘까요?</h2><p>블록과 남은 시간을 저장하면 나중에 이어 할 수 있어요.${changed?' 새 버전은 저장 뒤 이동할 때 적용돼요.':''}</p><p class="dialog-message muted" aria-live="polite"></p><div class="dialog-actions"><button class="button button-primary" data-choice="save">저장하고 이동</button><button class="button button-secondary" data-choice="stay">계속 머무르기</button><button class="button button-ghost" data-choice="discard">저장하지 않고 이동</button></div></section>`;
    document.body.append(dialog);this.modalOpen=true;dialog.showModal();
    return new Promise(resolve=>{
      const finish=value=>{this.modalOpen=false;dialog.close();dialog.remove();resolve(value);};
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
      dialog.addEventListener('click',async event=>{
        const choice=event.target.closest('[data-choice]')?.dataset.choice;if(!choice)return;
        if(choice==='stay'){finish(false);return;}
        if(choice==='discard'){
          if(this.storage.pending){dialog.querySelector('.dialog-message').textContent='저장이 진행 중이에요. 완료 후 다시 선택해 주세요.';return;}
          screen?.discard?.();finish(true);return;
        }
        if(this.storage.pending){dialog.querySelector('.dialog-message').textContent='이전 저장을 마치는 중이에요. 잠시 뒤 다시 눌러 주세요.';return;}
        const button=dialog.querySelector('[data-choice="save"]');button.disabled=true;dialog.querySelector('.dialog-message').textContent='진행을 저장하고 있어요…';
        try{await screen?.saveForNavigation?.();if(this.storage.pending||screen?.isDirty())throw Error('저장이 아직 끝나지 않았어요.');finish(true);}
        catch(error){dialog.querySelector('.dialog-message').textContent=error.message||'저장하지 못했어요. 진행은 그대로예요.';button.disabled=false;}
      });
    });
  }
  toast(message,kind='info'){
    clearTimeout(this.toastTimer);this.toastRoot.textContent=message;this.toastRoot.dataset.kind=kind;this.toastRoot.hidden=false;
    this.toastTimer=setTimeout(()=>{this.toastRoot.hidden=true;},3300);
  }
  burst(){
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const burst=document.createElement('div');burst.className='flow-burst';burst.setAttribute('aria-hidden','true');
    for(let i=0;i<16;i++){const particle=document.createElement('i');particle.style.setProperty('--dx',`${Math.cos(i*Math.PI/8)*(130+Math.random()*140)}px`);particle.style.setProperty('--dy',`${Math.sin(i*Math.PI/8)*(100+Math.random()*140)}px`);particle.style.setProperty('--turn',`${i*41}deg`);burst.append(particle);}
    document.body.append(burst);setTimeout(()=>burst.remove(),900);
  }
}

const app=new SlideShiftApp();
app.start().catch(error=>{document.querySelector('#app').innerHTML=`<main class="page-screen error-state"><h1>게임을 시작하지 못했어요.</h1><p>${esc(error.message)}</p><a class="button button-primary" href="${esc(location.href)}">다시 열기</a></main>`;});
