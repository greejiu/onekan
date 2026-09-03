# 공용 state-store — 설계 메모

**상태: 1단계 구현 완료 + 고빈도 writer 직접 이전 진행 중 (2026-09-04).**

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
  - 기존 모듈이 코드를 당장 전부 바꾸지 않아도 보호를 받을 수 있도록 `onekan_state`의 `select / insert / upsert`를 공용 store를 거치게 한다.
  - 다른 Supabase 테이블은 기존과 동일하게 동작한다.
- 새 코드에서는 가능하면 `onekanStateStore.read()` / `onekanStateStore.mutate()` / `onekanStateStore.subscribe()`를 직접 사용한다.

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

다음 후보:
1. habit/project 계열 writer

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
- `onekan_state.update()` / `delete()`를 통한 전체 상태 변경은 아직 3-way merge 대상이 아니다. 현재 주된 전체 상태 writer는 `upsert` 패턴이다.
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
- `app.js`, `focus-task-card.js`, `project-popup-planning.js`, `unified-workspace.js`가 `onekan_state`를 직접 `select / upsert`하지 않음
