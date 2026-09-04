# 공용 state-store — 설계 메모

**상태: 런타임 `onekan_state` 직접 접근 이전 완료 + Supabase 호환 Proxy 런타임 제거 (2026-09-04).**

## 목적

`onekan_state`의 전체 JSON을 여러 모듈이 각각 `read → mutate → upsert` 하면서 서로의 최신 변경을 덮어쓰는 문제를 줄인다.

## 현재 구조

- `js/state-store.js`
  - `onekan_state` 쓰기를 하나의 Promise queue로 직렬화한다.
  - Chromium 계열 등 Web Locks API가 있는 브라우저에서는 같은 origin의 여러 탭도 `onekan-state-write` lock으로 직렬화한다.
  - 읽은 상태에 임시 base token을 붙이고, 저장 직전에 DB 최신 상태를 다시 읽는다.
  - 동일한 상태를 여러 모듈이 반복해서 읽어도 같은 fingerprint token을 재사용해 base cache가 불필요하게 늘어나지 않게 한다.
  - `base / local / remote` 3-way merge를 수행한다.
  - `tasks`, `projects`, `sessions`, `timeBlocks`처럼 `id`가 있는 배열은 항목 단위로 병합한다.
  - 임시 base token은 DB에 저장하기 전에 제거한다.
- `js/supabase.js`
  - 일반 Supabase 접근은 더 이상 Proxy를 거치지 않고 원본 client를 그대로 export한다.
  - `onekan_state`만 별도 `onekanStateStore` 인스턴스로 접근한다.
- 런타임의 `onekan_state` 접근은 `onekanStateStore.read()` / `onekanStateStore.mutate()` / `onekanStateStore.subscribe()`를 사용한다.

## 직접 이전 현황

완료:
1. `app.js`
   - `read()` / `mutate()` 직접 사용
   - 마지막 app 저장본을 base로 두고 최신 remote와 3-way merge
2. `focus-task-card.js`
   - `onekan_state` 직접 `select / upsert` 제거
   - 하위할일 추가·삭제·체크, 집중 할일 선택을 `mutate()` 한 트랜잭션 흐름에서 처리
3. `project-popup-planning.js`
   - 프로젝트 팝업의 할일·습관 추가/완료 저장을 `mutate()`로 이전
   - 팝업 갱신은 store 커밋 상태를 사용하고, 기존 앱 상태 동기화를 위한 서버 새로고침 트리거는 유지
4. `unified-workspace.js`
   - 일정·할일·습관·타임라인의 고빈도 저장을 `mutate()`로 이전
   - mutator 실행 중에는 최신 store 상태를 임시 전역 state로 연결해 기존 helper의 동작을 유지
   - store가 상태변경 이벤트를 발행하므로 수동 `onekan:state-changed` dispatch는 제거
5. `project-status-automation.js`
   - 프로젝트·목표 상태 자동 승격/재계산을 `read() / mutate()`로 이전
   - 변경 필요 여부는 읽은 snapshot으로 먼저 확인해 불필요한 자동 저장을 줄임
   - 실제 커밋 시 최신 remote 상태에서 다시 상태를 계산하고 store 이벤트를 사용
6. 나머지 런타임 상태 모듈
   - 프로젝트·습관·컨텍스트·인증·설정·통계 모듈을 순차적으로 직접 store API로 이전
   - `backup-manager.js`의 현재 상태 백업/복원도 store를 거치며, history 테이블은 별도 보관소로 유지
   - `time-block-v2-settings.js` 저장은 최신 remote 상태에서 mutate하고 `tracking-stats.js`는 read-only store 조회 사용
   - `scripts/state-store-direct-access-regression.mjs`가 이제 `state-store.js` 외 직접 `onekan_state` 접근을 허용하지 않음
7. Supabase 호환 Proxy 런타임 제거
   - `supabase.js`가 원본 Supabase client를 그대로 export하도록 전환
   - `onekanStateStore`는 원본 client 위에 별도 생성해 상태 접근 책임을 분리
   - 기존 Proxy 생성 함수는 런타임에서 더 이상 사용하지 않으며 후속 단계에서 dead helper로 정리 가능

다음 후보:
1. `state-store.js`의 사용 종료된 Proxy helper/deferred writer 코드 물리 삭제

## 왜 기존 모듈을 한꺼번에 안 바꾸는가

현재 `onekan_state`를 다루는 모듈이 많아서 한 번에 전환하면 회귀 범위가 너무 커진다. 공용 transport로 먼저 데이터 유실 위험을 줄인 뒤, 쓰기 빈도가 높은 모듈부터 직접 store API로 옮긴다.

## merge 규칙

- local이 base와 같으면 remote를 유지한다.
- remote가 base와 같으면 local 변경을 적용한다.
- 서로 다른 필드를 동시에 바꾸면 재귀적으로 합친다.
- `id` 배열은 항목 단위로 합쳐 서로 다른 항목 추가/수정을 보존한다.
- 같은 scalar 필드를 양쪽이 동시에 다르게 바꾼 충돌은 현재 실행 중인 local 변경을 우선한다.
- 기존 읽기 base token을 잃어버린 레거시 쓰기는 기능 호환을 위해 기존 local 우선 방식으로 처리한다.

## 제한

- Web Locks API가 없는 브라우저에서는 queue가 **현재 탭 안에서만** 직렬화된다.
- Web Locks를 써도 다른 기기까지 원자적으로 잠글 수는 없다. 다른 기기에서 정확히 동시에 쓰는 경우 `최신 읽기 → upsert` 사이에 DB 레벨 race가 남는다. 완전한 해결에는 revision/version 기반 optimistic locking 또는 RPC가 필요하다.
- 공용 store 밖의 `onekan_state.update()` / `delete()`는 3-way merge 대상이 아니다. 현재 런타임 모듈은 더 이상 이 직접 경로를 사용하지 않는다.
- base token은 내부 병합용 임시 값이며 DB 저장 시 제거한다.

## 검증

`scripts/state-store-regression.mjs`와 모듈별 회귀검사에서 다음을 확인한다.
- 외부 모듈의 하위할일 변경 뒤 stale app snapshot 저장 시 변경 보존
- 동일 상태 반복 read 시 base token 재사용
- 동시에 추가된 서로 다른 `id` 항목 보존
- 같은 항목의 서로 다른 필드 병합
- 삭제와 원격 신규 추가 병합
- 같은 탭 동시 write 직렬화
- base token DB 미저장
- `state-store.js` 외 런타임 JS가 `onekan_state`를 직접 `select / insert / update / upsert`하지 않음
