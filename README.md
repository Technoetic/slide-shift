# SLIDE / SHIFT

**순서는 바꿔라. 결과는 지켜라.**

관련된 명령 카드를 모으면서 실행 결과를 지키는 액션 퍼즐입니다.
Martin Fowler의 [Slide Statements](https://refactoring.com/catalog/slideStatements.html) 예제에서 착안했습니다.

[플레이하기](https://technoetic.github.io/slide-shift/)

- 90초 도전 / 시간 제한 없는 연습, 8개 스테이지
- 드래그·카드의 화살표 버튼·키보드 조작
- 콤보·힌트·되돌리기·진행 저장·로컬 기록
- 키보드: ↑↓ 선택, W/S 이동, Z 되돌리기, H 힌트, P 일시정지

기록은 해당 브라우저의 IndexedDB에만 저장됩니다. 계정이나 서버 DB는 사용하지 않습니다.

## 실행

Node.js 24에서 검증했습니다. 설치할 실행 의존성은 없습니다.

```sh
npm test
npm run dev
```

개발 서버 주소는 `http://127.0.0.1:8792/slide-shift/`입니다.

## 구조와 배포

- `src/game`: 제한된 명령의 실행·동등성 검사·게임 규칙
- `src/screens`: 화면과 입력 수명주기
- `src/services`: 데이터·저장·라우팅·새 버전 전환
- `src/styles`: 토큰·기본·컴포넌트 스타일
- `tests`: 규칙·저장·경합·라우팅·빌드·중단된 시계의 회귀 검사
- `scripts/build.mjs`: 빌드 ID가 포함된 JS/CSS와 정적 `dist` 생성
- GitHub Actions: 전체 테스트 → 빌드 → GitHub Pages 배포

빌드는 기존 `dist/assets`를 지우지 않습니다. 새 배포를 준비할 때 생성된 `dist`도 소스와 함께 커밋하면 이전에 열린 탭의 자산을 유지할 수 있습니다. HTML의 실행 빌드와 새 버전 응답을 비교하고, 진행 중인 게임·저장을 보호한 뒤 다음 안전한 이동에서 새 문서를 받습니다.

## 범위

게임은 직접 작성한 8개 스테이지와 지정 입력 사례에서 최종 관찰 값·순서 있는 출력을 비교합니다. 임의 JavaScript의 모든 입력에 대한 동등성 증명 도구는 아닙니다. Fowler의 책 본문이나 예제 코드를 복제하지 않고 게임용 명령을 별도로 작성했습니다.
