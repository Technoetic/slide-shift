import {escapeHtml as esc,focusHeading} from '../shared/dom.ss-7d78cc817c24.js';

class Screen {
  constructor(root,env){this.root=root;this.env=env;this.alive=true;this.abort=new AbortController();}
  isDirty(){return false;}
  dispose(){this.alive=false;this.abort.abort();}
}

export class HomeScreen extends Screen {
  async mount(){
    this.root.replaceChildren(document.querySelector('#home-template').content.cloneNode(true));
    const slot=document.createElement('div');slot.className='resume-slot';this.root.querySelector('.hero-actions').after(slot);
    focusHeading(this.root);
    try{const checkpoint=await this.env.storage.loadCheckpoint();if(!this.alive)return;
      if(checkpoint)slot.innerHTML='<a class="text-link resume-link" href="#/play?resume=1" data-route="/play?resume=1">저장한 도전 이어 하기 ↗</a>';
    }catch{if(this.alive)slot.innerHTML='<p class="muted">저장된 진행을 읽지 못했어요. 새 도전은 시작할 수 있어요.</p>';}
  }
}

export class GuideScreen extends Screen {
  async mount(){
    this.root.innerHTML=`<main class="page-screen guide-screen"><p class="kicker">THE ART OF MOVING</p><h1>움직여도 되는 순서가 있다.</h1><p class="page-lead">같은 일을 하는 카드는 가까이.<br>그렇다고 결과까지 바꾸면 안 되겠죠.</p>
      <section class="guide-grid"><article class="guide-card"><span class="rule-index">01</span><h2>◆ 카드를 모으세요</h2><p>각 단계의 목표 카드를 한 줄로 이어 붙이세요. 손잡이를 끌거나 카드의 ↑ ↓ 버튼을 눌러 순서를 바꿔요.</p></article><article class="guide-card"><span class="rule-index">02</span><h2>준비한 다음에 사용하세요</h2><p>전력을 채우기 전에 사용하면 결과가 달라져요. 값을 준비하는 카드와 그 값을 쓰는 카드의 순서를 지켜 주세요.</p></article><article class="guide-card"><span class="rule-index">03</span><h2>결과는 그대로 유지</h2><p>카드를 옮길 때 여러 입력에서 원래 결과와 비교해요. 값이나 출력 순서가 달라지는 이동은 막히고, 도전 시간에서 3초가 줄어요.</p></article><article class="guide-card"><span class="rule-index">04</span><h2>콤보를 이어 가세요</h2><p>단계를 연달아 끝내면 콤보 점수를 얻어요. 힌트는 5초를 사용하고 콤보를 끊어요. 연습 모드에서는 시간을 신경 쓰지 않아도 돼요.</p></article></section>
      <section class="guide-controls"><h2>당신에게 편한 조작으로.</h2><div class="table-wrap"><table><thead><tr><th>키</th><th>동작</th></tr></thead><tbody><tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>카드 선택</td></tr><tr><td><kbd>W</kbd> <kbd>S</kbd></td><td>선택한 카드 위·아래로</td></tr><tr><td><kbd>Z</kbd></td><td>한 수 되돌리기</td></tr><tr><td><kbd>H</kbd></td><td>힌트</td></tr><tr><td><kbd>P</kbd></td><td>일시정지·계속하기</td></tr></tbody></table></div><p class="muted">휴대전화에서는 카드의 화살표 버튼으로도 플레이할 수 있어요. 다른 탭으로 가면 자동으로 멈추고, 돌아와 계속하기를 누르면 이어져요.</p></section>
      <section class="guide-origin"><p class="kicker">INSPIRED BY REFACTORING</p><h2>Slide Statements, 문장 이동하기</h2><p>마틴 파울러의 리팩토링 예제는 관련된 문장을 가까이 옮기는 모습을 보여 줍니다. 이 게임은 그 생각을 ‘흩어진 블록을 모으면서 결과를 지키는 퍼즐’로 바꿨어요.</p><p>실제 코드에서는 값의 의존 관계와 외부에 드러나는 동작을 살펴야 해요. 이 게임은 정해진 명령과 입력 사례 안에서 검사하며, 모든 JavaScript 코드가 안전하다는 것을 증명하지는 않아요.</p><a class="text-link" href="https://refactoring.com/catalog/slideStatements.html" target="_blank" rel="noopener noreferrer">마틴 파울러의 공식 예제 보기 ↗</a></section>
      <div class="controls"><a class="button button-primary" href="#/play?mode=rush" data-route="/play?mode=rush">90초 도전 ↗</a><a class="button button-secondary" href="#/play?mode=practice" data-route="/play?mode=practice">천천히 연습</a></div></main>`;
    focusHeading(this.root);
  }
}

export class RecordsScreen extends Screen {
  async mount(){
    this.root.innerHTML='<main class="page-screen"><p class="kicker">YOUR BEST FLOW</p><h1>내 기록</h1><div data-records class="loading-state" aria-live="polite">기록을 불러오고 있어요.</div><div class="controls"><a class="button button-primary" href="#/play?mode=rush" data-route="/play?mode=rush">다시 도전 ↗</a><a class="button button-ghost" href="#/" data-route="/">홈으로</a></div><p class="muted">기록은 이 기기의 이 브라우저에만 저장돼요.</p></main>';
    focusHeading(this.root);const slot=this.root.querySelector('[data-records]');
    try{const rows=await this.env.storage.loadRecords();if(!this.alive)return;
      slot.className='record-list';
      slot.innerHTML=rows.length?rows.map((row,index)=>`<article class="record-row"><span class="record-rank">${String(index+1).padStart(2,'0')}</span><div><strong>${row.score.toLocaleString()}점</strong><p class="muted">${row.mode==='rush'?'90초 도전':'연습'} · ${row.completed}/8 단계 · ${row.safeMoves}회 이동</p></div><time datetime="${esc(row.date)}">${esc(new Date(row.date).toLocaleDateString('ko-KR'))}</time></article>`).join(''):'<div class="empty-state"><span class="empty-symbol" aria-hidden="true">↕</span><h2>첫 흐름을 만들어 보세요.</h2><p>도전을 마치면 여기에 기록이 쌓여요.</p></div>';
    }catch(error){if(this.alive){slot.className='error-state';slot.innerHTML=`<p>${esc(error.message)}</p><button class="button button-secondary" data-retry>다시 불러오기</button>`;slot.querySelector('[data-retry]').addEventListener('click',()=>this.mount(),{once:true,signal:this.abort.signal});}}
  }
}

export class MissingScreen extends Screen {
  async mount(){this.root.innerHTML='<main class="page-screen empty-state"><p class="kicker">404 / LOST IN THE FLOW</p><h1>이 순서에는 화면이 없어요.</h1><p class="muted">홈으로 돌아가 새 흐름을 시작해 보세요.</p><a class="button button-primary" href="#/" data-route="/">홈으로 →</a></main>';focusHeading(this.root);}
}
