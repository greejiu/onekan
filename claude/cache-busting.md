# 캐시 버전 관리

**상태: 적용됨 (2026-09-04)**

오늘한칸은 GitHub Pages에서 정적 파일을 직접 배포하므로 CSS/JS URL의 `?v=N`을 캐시 무효화 용도로 사용한다. 예전에는 각 파일을 수정할 때 참조 위치의 숫자를 사람이 직접 기억해서 올려야 했고, 숫자를 놓치면 배포 후 브라우저가 이전 파일을 계속 사용할 수 있었다.

## 현재 규칙

- `index.html`에서 직접 불러오는 로컬 JS/CSS는 항상 `?v=숫자`를 붙인다.
- 이미 버전이 붙은 JS/CSS 파일을 수정하면 그 파일을 가리키는 모든 로컬 참조의 버전을 함께 올린다.
- 버전 없이 참조되는 레거시 의존 파일을 수정하면 CI가 실패한다. 이때 해당 참조에 처음으로 `?v=1`을 붙인다.
- 같은 변경에서 한 파일을 여러 곳이 참조한다면 모두 같은 새 버전으로 맞춘다.

## 자동 검사

`scripts/cache-buster-regression.mjs`가 두 단계로 검사한다.

1. 일반 회귀 검사에서는 `index.html`의 엔트리 JS/CSS가 버전 없이 로드되지 않는지 확인한다.
2. PR/main push에서는 Git 기준 변경 파일을 찾아, 변경된 JS/CSS의 참조가 버전 없이 남았거나 이전 버전을 그대로 쓰는 경우 실패시킨다.

PR 비교를 위해 `.github/workflows/regression.yml`의 checkout은 `fetch-depth: 0`을 사용한다.

## 버전 올리는 방법

예를 들어 `js/app.js`를 수정했다면 다음 명령으로 모든 로컬 참조를 한 번에 올릴 수 있다.

```bash
node scripts/cache-buster-regression.mjs --bump js/app.js
```

여러 파일도 한 번에 가능하다.

```bash
node scripts/cache-buster-regression.mjs --bump js/app.js css/unified-workspace.css
```

이 스크립트는 현재 참조 중 가장 큰 숫자보다 1 큰 값으로 통일하며, 버전이 없던 참조에는 새 버전을 추가한다.

## 범위

이 단계는 빌드 시스템이나 해시 파일명으로 전환하는 작업이 아니다. 기존 정적 배포 구조를 유지하면서 **사람이 캐시 숫자 증가를 빼먹어 생기는 오류를 CI로 차단하는 안전장치**다. 이후 빌드 파이프라인을 도입한다면 content hash 기반 파일명으로 교체할 수 있다.
