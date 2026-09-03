# app.js state-store 직접 이전

상태: 구현 (2026-09-04)

- app.js의 onekan_state 직접 select/upsert를 제거하고 onekanStateStore.read/mutate API를 사용한다.
- 저장 시 app이 마지막으로 성공적으로 저장한 로컬 기준(baseState), 현재 로컬 스냅샷, mutate가 받은 최신 원격 상태를 threeWayMerge한다.
- 저장 성공 뒤 app의 기준은 방금 저장을 요청한 로컬 스냅샷으로 전진한다. 원격에서만 추가된 데이터는 app 메모리에 억지로 덮어쓰지 않으면서 다음 저장에서도 보존된다.
- 같은 사용자가 빠르게 여러 번 저장해도 app의 기존 saveChain 순서를 유지한다.
- state-store 자체 API/호환 proxy는 건드리지 않았다. 다음 이전 대상은 focus-task-card.js, project-popup-planning.js 순서다.
