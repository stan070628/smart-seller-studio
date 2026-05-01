# 플랜탭 난이도 재배치 + 채널 영상 매핑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/plan` 탭의 84개 task에 ⭐ 난이도(1~5) + 채널 영상 출처 + 예상 소요 시간을 추가하고, 매주 task를 난이도 오름차순으로 정렬하며, 별/확장 패널 UI를 추가한다.

**Architecture:** `WbsTask` 타입에 3개 필드 추가 → 84개 task 데이터 업데이트 → `PlanClient.tsx`에 disclosure 패턴 UI 추가. working tree에 이미 v2 task + steps가 작성된 상태이므로 그 base 위에 보강.

**Tech Stack:** TypeScript, Next.js App Router, React (lucide-react 아이콘), Vitest
**근거 spec:** `docs/superpowers/specs/2026-04-28-plan-difficulty-redesign-design.md`

---

## Pre-condition

Working tree에 이미 `src/lib/plan/constants.ts`가 v2 12주 task + steps + tip 포함 형태로 수정되어 있어야 함. (commit 0b43f90 직전 작업)

확인:
```bash
git status src/lib/plan/constants.ts
# Expected: modified, but not committed yet
grep -c '"w[0-9]\+-[0-9]\+"' src/lib/plan/constants.ts
# Expected: 84 (12 weeks × 평균 7 tasks)
```

---

## File Structure

| 작업 | 경로 | 책임 |
|---|---|---|
| 수정 | `src/lib/plan/constants.ts` | WbsTask 타입에 difficulty/videoRef/estimatedHours 추가, 84 task 데이터 보강, 매주 task 난이도 정렬 |
| 수정 | `src/components/plan/PlanClient.tsx` | task li에 별/확장 버튼, 확장 패널 (steps/tip/videoRef/hours 표시) |

---

## Task 1: WbsTask 타입 확장

**Files:**
- Modify: `src/lib/plan/constants.ts` (인터페이스 부분)

- [ ] **Step 1: 현재 working tree 변경분 staging (없으면 커밋되지 않은 변경 보존용)**

Run:
```bash
git status src/lib/plan/constants.ts
```

만약 modified로 표시되면 그 변경(steps 추가분)을 그대로 둔다. 수정되지 않은 상태면 후속 작업이 누락된 상태이므로 BLOCKED 보고.

- [ ] **Step 2: WbsTask 인터페이스에 3개 필드 추가**

`src/lib/plan/constants.ts`의 WbsTask 인터페이스 부분을 다음으로 교체:

기존:
```ts
export interface WbsTask {
  id: string;
  text: string;
  steps?: string[];
  tip?: string;
}
```

변경:
```ts
export interface WbsTask {
  id: string;
  text: string;
  /** 난이도 ⭐ 1~5. 1=매우쉬움, 5=매우어려움. spec §3 기준 */
  difficulty: 1 | 2 | 3 | 4 | 5;
  steps?: string[];
  tip?: string;
  /** 채널 영상 출처 (예: "회송 1편: 포장 (2025-03-17)") */
  videoRef?: string;
  /** 예상 소요 시간 (시간 단위) */
  estimatedHours?: number;
}
```

- [ ] **Step 3: 타입체크 — 모든 task에 difficulty 추가될 때까지 컴파일 에러 발생 예상**

Run: `npx tsc --noEmit 2>&1 | grep "constants.ts" | head -10`
Expected: WbsTask의 difficulty 필수 필드 누락 에러 다수 (84건)

이 에러는 Task 2에서 모든 task에 difficulty 부여하면 사라짐. Task 1에서는 정상.

- [ ] **Step 4: 커밋 보류 (Task 2와 합쳐서 한 commit)**

Task 2 완료 후 함께 커밋.

---

## Task 2: 84개 task에 difficulty + videoRef + estimatedHours 추가 + 매주 정렬

이 task는 데이터 작업. 12주 × 평균 7 task = 84개 task 모두에 3개 신규 필드 부여.

**Files:**
- Modify: `src/lib/plan/constants.ts` (WBS_DATA 객체 전체)

### 영상 매핑 표 (videoRef 부여 가이드)

각 task의 컨텍스트에 따라 아래 영상 중 적합한 것을 매핑. 직접 매핑 안 되는 task는 videoRef 생략.

| 영상 식별자 | 게시일 | 매핑 컨텍스트 |
|---|---|---|
| `회송 1편: 포장 (2025-03-17)` | 2025-03-17 | 입고 검수, 포장 점검 |
| `회송 2편: 사이즈 (2025-03-18)` | 2025-03-18 | 사이즈 측정, 50cm 변, 무게 25kg |
| `회송 3편: 바코드 (2025-03-18)` | 2025-03-18 | 바코드 부착, CODE128 |
| `1688 사입 노하우 (2026-03-03)` | 2026-03-03 | 1688 첫 발주, 검수 옵션 |
| `1688 가격흥정 팁 (2025-06-22)` | 2025-06-22 | 사입 가격 협상 (2차/3차 사입) |
| `1688 공장찾기 가이드 (2025-06-24)` | 2025-06-24 | 셀러 비교 선정 |
| `1688 회원가입~카드등록 (2026-02-09)` | 2026-02-09 | 1688 계정/알리페이 셋업 |
| `위너 분리 방법 (2025-12-15)` | 2025-12-15 | 아이템위너 점유, 그로스 활성화 |
| `위너 회피 심화 (2026-03-11)` | 2026-03-11 | 옵션 분리 |
| `억대셀러 소싱법 (2025-09-29)` | 2025-09-29 | 위너 선정 기준, 위너 후보 선별 |
| `100만원으로 시작 (2025-11-04)` | 2025-11-04 | 단계적 사입 전환, 첫 발주 소량 |
| `망하는 상품 (2025-11-24)` | 2025-11-24 | 회피 리스트, KC 인증 점검 |
| `도매꾹 위탁 (2025-07-09)` | 2025-07-09 | 위탁 단계 SKU 선정, 도매꾹 import |
| `키워드 찾는법 (2026-03-10)` | 2026-03-10 | 시드 키워드 발굴 |
| `그로스 보관료 (2025-03-27)` | 2025-03-27 | 부피 차단, 그로스 운영비 |
| `수입대행지 (2025-05-19)` | 2025-05-19 | 1688 입고 자동화, 한국 통관 |

### 난이도 부여 가이드 (spec §3 재요약)

| 난이도 | 시간 | 판정 기준 |
|---|---|---|
| ⭐ 1 | 30분 이내 | 클릭 한 번 / 단일 등록 / 메시지 작성 |
| ⭐⭐ 2 | 1~2시간 | 가입·셋업 / 일괄 import / 정형화된 작업 |
| ⭐⭐⭐ 3 | 반나절 | 데이터 분석 / 키워드 발굴 / 의사결정 1단계 |
| ⭐⭐⭐⭐ 4 | 1~2일 | 외부 협상 / 자본 결정 / 입고 검수 / 광고 최적화 |
| ⭐⭐⭐⭐⭐ 5 | 며칠 | 대량 사입 / 전략 회고 / 다중 변수 의사결정 |

### estimatedHours 가이드

- 난이도 1 → `0.5`
- 난이도 2 → `1.5`
- 난이도 3 → `4`
- 난이도 4 → `8`
- 난이도 5 → `16`

(task의 specific 시간이 더 명확하면 그 값 사용)

### 12주 평균 난이도 곡선 (검증 기준)

부여 후 각 주의 난이도 평균이 다음 범위 이내인지 확인:

| Week | 평균 difficulty 범위 |
|---|---|
| 1 | 1.8 ~ 2.5 |
| 2 | 1.8 ~ 2.5 |
| 3 | 2.5 ~ 3.5 |
| 4 | 3.3 ~ 4.2 |
| 5 | 3.3 ~ 4.2 |
| 6 | 2.5 ~ 3.5 |
| 7 | 3.3 ~ 4.2 |
| 8 | 2.5 ~ 3.5 |
| 9 | 2.5 ~ 3.5 |
| 10 | 4.0 ~ 5.0 |
| 11 | 3.3 ~ 4.2 |
| 12 | 3.3 ~ 4.2 |

### 진행 절차

- [ ] **Step 1: 12주 task 일괄 보강**

`src/lib/plan/constants.ts`의 `WBS_DATA` 객체 안에 있는 84개 task 각각에 다음을 추가:

1. `difficulty: N` (1~5 중 하나)
2. `videoRef: "..."` (영상 매핑 표에서 적합한 것이 있을 때만)
3. `estimatedHours: N` (난이도 가이드 기반)

기존 `id`, `text`, `steps`, `tip`은 유지.

**예시 (Week 1 첫 task):**

기존:
```ts
{
  id: 'w1-1',
  text: '회피 리스트 자동 필터 적용된 도매꾹 시드 키워드 30개 발굴',
  steps: [
    'SmartSellerStudio /sourcing 페이지 접속 → 키워드/도매꾹 탭 선택',
    '...'
  ],
  tip: '...',
},
```

변경:
```ts
{
  id: 'w1-1',
  text: '회피 리스트 자동 필터 적용된 도매꾹 시드 키워드 30개 발굴',
  difficulty: 3,
  steps: [
    'SmartSellerStudio /sourcing 페이지 접속 → 키워드/도매꾹 탭 선택',
    '...'
  ],
  tip: '...',
  videoRef: '키워드 찾는법 (2026-03-10)',
  estimatedHours: 3,
},
```

12주 모두 동일 패턴으로 보강.

- [ ] **Step 2: 매주 task 난이도 오름차순 정렬**

각 주의 `tasks` 배열을 `difficulty` 오름차순으로 재정렬. 같은 난이도면 기존 순서 유지.

예시 (Week 1 정렬 후):
```ts
1: {
  // ...
  tasks: [
    // difficulty 1 (있으면 먼저)
    { id: 'w1-6', text: 'CS 자동 응답 메시지 사전 작성', difficulty: 1, ... },
    // difficulty 2
    { id: 'w1-3', text: '사업자등록증 / 네이버스토어 / 쿠팡 윙 가입', difficulty: 2, ... },
    { id: 'w1-4', text: '쿠팡 로켓그로스 진입 신청', difficulty: 2, ... },
    { id: 'w1-5', text: '광고 계정 세팅', difficulty: 2, ... },
    // difficulty 3
    { id: 'w1-1', text: '시드 키워드 30개 발굴', difficulty: 3, ... },
    { id: 'w1-2', text: 'SKU 80~100개 선별', difficulty: 3, ... },
    { id: 'w1-7', text: 'SmartSellerStudio /sourcing 워크플로우 숙지', difficulty: 3, ... },
  ],
},
```

`id`는 변경하지 않음 (체크 상태 호환). 정렬 후 배열 순서만 바뀜.

- [ ] **Step 3: 타입체크 통과 확인**

Run: `npx tsc --noEmit 2>&1 | grep "constants.ts"`
Expected: 출력 0건 (모든 task에 difficulty 부여 완료)

- [ ] **Step 4: 12주 평균 난이도 곡선 검증**

`/tmp/plan-check.mjs` 임시 스크립트 작성:

```js
import { WBS_DATA } from '/Users/seungminlee/projects/smart_seller_studio/src/lib/plan/constants.ts';

const ranges = {
  1: [1.8, 2.5], 2: [1.8, 2.5], 3: [2.5, 3.5],
  4: [3.3, 4.2], 5: [3.3, 4.2], 6: [2.5, 3.5],
  7: [3.3, 4.2], 8: [2.5, 3.5], 9: [2.5, 3.5],
  10: [4.0, 5.0], 11: [3.3, 4.2], 12: [3.3, 4.2],
};

let allPass = true;
for (const [week, data] of Object.entries(WBS_DATA)) {
  const avg = data.tasks.reduce((s, t) => s + t.difficulty, 0) / data.tasks.length;
  const [lo, hi] = ranges[week];
  const pass = avg >= lo && avg <= hi;
  console.log(`Week ${week}: avg ${avg.toFixed(2)} ${pass ? '✓' : '✗ (range ' + lo + '~' + hi + ')'}`);
  if (!pass) allPass = false;
}
console.log(allPass ? '\nAll weeks pass.' : '\nFailed — adjust difficulty values.');
```

ts 직접 import는 안 되므로 대안: 12주 평균을 수동 계산하거나 vitest 단위 테스트로 작성.

대안 (vitest 단위 테스트):

`src/lib/plan/__tests__/difficulty-curve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { WBS_DATA } from '../constants';

const RANGES: Record<number, [number, number]> = {
  1: [1.8, 2.5], 2: [1.8, 2.5], 3: [2.5, 3.5],
  4: [3.3, 4.2], 5: [3.3, 4.2], 6: [2.5, 3.5],
  7: [3.3, 4.2], 8: [2.5, 3.5], 9: [2.5, 3.5],
  10: [4.0, 5.0], 11: [3.3, 4.2], 12: [3.3, 4.2],
};

describe('12주 난이도 곡선 — spec §4', () => {
  for (const week of Object.keys(RANGES).map(Number)) {
    it(`Week ${week} 평균 난이도가 spec 범위 내`, () => {
      const data = WBS_DATA[week];
      const avg = data.tasks.reduce((s, t) => s + t.difficulty, 0) / data.tasks.length;
      const [lo, hi] = RANGES[week];
      expect(avg).toBeGreaterThanOrEqual(lo);
      expect(avg).toBeLessThanOrEqual(hi);
    });
  }
});

describe('매주 task 난이도 오름차순 정렬', () => {
  for (const week of [1,2,3,4,5,6,7,8,9,10,11,12]) {
    it(`Week ${week} task가 difficulty 오름차순`, () => {
      const tasks = WBS_DATA[week].tasks;
      for (let i = 1; i < tasks.length; i++) {
        expect(tasks[i].difficulty).toBeGreaterThanOrEqual(tasks[i-1].difficulty);
      }
    });
  }
});
```

Run: `npx vitest run src/lib/plan/__tests__/difficulty-curve.test.ts`
Expected: PASS — 24 tests (12 곡선 + 12 정렬)

만약 FAIL하는 주차 있으면 해당 주차 task의 difficulty 값을 spec §4 곡선에 맞게 조정.

- [ ] **Step 5: 빌드 검증**

Run: `npm run build 2>&1 | tail -10`
Expected: 빌드 성공, `/plan` 경로 포함

- [ ] **Step 6: 커밋 (Task 1 + Task 2 묶음)**

```bash
git add src/lib/plan/constants.ts src/lib/plan/__tests__/difficulty-curve.test.ts
git commit -m "feat(plan): add difficulty/videoRef/estimatedHours to 84 tasks + sort by difficulty

전략 v2 spec 2026-04-28 §3-§5 반영. 12주 평균 난이도 곡선 + 매주 task 정렬 +
채널 영상 16개 출처 매핑 + 예상 소요 시간."
```

---

## Task 3: PlanClient.tsx 별 표시 + 확장 버튼

`task` li에 별 ⭐⭐⭐ + 확장 토글 버튼 추가. 확장 패널은 Task 4에서 추가.

**Files:**
- Modify: `src/components/plan/PlanClient.tsx` (task 렌더링 부분, 약 295~342 라인)

- [ ] **Step 1: 확장 상태 useState 추가**

`PlanClient.tsx`에서 `tasks.map` 위쪽 적당한 위치에 다음 state 추가:

```tsx
const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

function toggleExpanded(id: string) {
  setExpandedTasks((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}
```

기존 `useState`가 어디에 있는지 grep으로 찾아서 그 근처에 추가:

Run: `grep -n "useState" src/components/plan/PlanClient.tsx | head -5`

- [ ] **Step 2: lucide-react ChevronDown/ChevronRight 아이콘 import 추가**

기존 lucide-react import 라인을 찾아서 `ChevronDown`, `ChevronRight` 추가:

Run: `grep -n "lucide-react" src/components/plan/PlanClient.tsx`

기존 import (예시):
```tsx
import { CheckSquare, Square, ClipboardList } from 'lucide-react';
```

변경:
```tsx
import { CheckSquare, Square, ClipboardList, ChevronDown, ChevronRight } from 'lucide-react';
```

- [ ] **Step 3: 별 색상 헬퍼 함수 추가**

PlanClient 컴포넌트 외부 상단(혹은 별도 상수 영역)에 추가:

```tsx
function difficultyColor(d: 1 | 2 | 3 | 4 | 5): string {
  return ['#16A34A', '#65A30D', '#CA8A04', '#EA580C', '#DC2626'][d - 1];
}

function renderStars(d: 1 | 2 | 3 | 4 | 5): string {
  return '⭐'.repeat(d);
}
```

- [ ] **Step 4: task li 영역에 별 + 확장 버튼 추가**

기존 `weekData.tasks.map` 안의 li 렌더링 부분(295~342 라인)에서 task 텍스트 우측에 별과 확장 버튼 추가.

기존:
```tsx
<span style={{ ... }}>{task.text}</span>
```

변경:
```tsx
<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
  <span
    style={{
      fontSize: 14,
      color: done ? C.textMuted : C.text,
      textDecoration: done ? 'line-through' : 'none',
      lineHeight: 1.6,
      flex: 1,
    }}
  >
    {task.text}
  </span>
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
    <span
      style={{
        fontSize: 12,
        color: difficultyColor(task.difficulty),
        fontWeight: 600,
      }}
      title={`난이도 ${task.difficulty}/5`}
    >
      {renderStars(task.difficulty)}
    </span>
    {(task.steps || task.tip || task.videoRef) && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleExpanded(task.id);
        }}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 4,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
        }}
        aria-label={expandedTasks.has(task.id) ? '접기' : '펼치기'}
      >
        {expandedTasks.has(task.id) ? (
          <ChevronDown size={16} color={C.textMuted} />
        ) : (
          <ChevronRight size={16} color={C.textMuted} />
        )}
      </button>
    )}
  </div>
</div>
```

기존 li의 onClick은 toggleTask (체크 토글)인데, 확장 버튼 클릭 시에는 stopPropagation으로 체크 토글 방지.

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit 2>&1 | grep "PlanClient"`
Expected: 출력 0건

- [ ] **Step 6: 커밋**

```bash
git add src/components/plan/PlanClient.tsx
git commit -m "feat(plan): add difficulty stars + expand toggle button to task UI"
```

---

## Task 4: PlanClient.tsx 확장 패널

확장된 task 아래에 단계별 가이드 / 팁 / 영상 출처 / 예상 시간 표시.

**Files:**
- Modify: `src/components/plan/PlanClient.tsx`

- [ ] **Step 1: 확장 패널 영역 추가**

기존 li 닫는 태그 직전에 expanded 시 패널 추가.

기존 li 구조:
```tsx
<li ...>
  <div>{checkbox}</div>
  <div>{task text + stars + toggle}</div>
</li>
```

변경:
```tsx
<React.Fragment key={task.id}>
  <li ...>
    <div>{checkbox}</div>
    <div>{task text + stars + toggle}</div>
  </li>
  {expandedTasks.has(task.id) && (
    <li
      style={{
        padding: '12px 24px 16px 54px',
        borderBottom: idx < weekData.tasks.length - 1 ? `1px solid ${C.border}` : 'none',
        background: '#FAFAFA',
        listStyle: 'none',
      }}
    >
      {task.steps && task.steps.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>
            📋 단계별 가이드
          </div>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: C.text }}>
            {task.steps.map((s, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {task.tip && (
        <div
          style={{
            background: '#FEF3C7',
            border: '1px solid #FCD34D',
            borderRadius: 4,
            padding: '8px 12px',
            fontSize: 12,
            color: '#78350F',
            marginBottom: 8,
          }}
        >
          💡 {task.tip}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          gap: 16,
          fontSize: 11,
          color: C.textMuted,
          marginTop: 8,
        }}
      >
        {task.videoRef && <span>📺 {task.videoRef}</span>}
        {task.estimatedHours !== undefined && (
          <span>⏱️ 약 {task.estimatedHours}시간</span>
        )}
      </div>
    </li>
  )}
</React.Fragment>
```

`React.Fragment`를 사용해 li를 두 개 (task + expanded panel) 렌더링. key 충돌 방지를 위해 panel li에는 key 생략 (Fragment에 key 부여).

`React`가 import 되어 있는지 확인:

Run: `head -5 src/components/plan/PlanClient.tsx`

`import React from 'react'` 또는 `import { Fragment } from 'react'` 필요. 없으면 추가.

기존 ul 안의 .map 콜백 return 구조 변경:

기존:
```tsx
{weekData.tasks.map((task, idx) => {
  const done = !!checks[task.id];
  return (
    <li key={task.id} ...>...</li>
  );
})}
```

변경:
```tsx
{weekData.tasks.map((task, idx) => {
  const done = !!checks[task.id];
  return (
    <React.Fragment key={task.id}>
      <li onClick={...} ...>
        ...{checkbox + text + stars + toggle}...
      </li>
      {expandedTasks.has(task.id) && (
        <li ...>{expanded panel}</li>
      )}
    </React.Fragment>
  );
})}
```

- [ ] **Step 2: 타입체크 + lint**

Run: `npx tsc --noEmit 2>&1 | grep "PlanClient"`
Expected: 출력 0건

Run: `npx eslint src/components/plan/PlanClient.tsx 2>&1 | tail -5`
Expected: 에러 0건 (warning 무시 가능)

- [ ] **Step 3: 빌드 검증**

Run: `npm run build 2>&1 | tail -8`
Expected: 빌드 성공

- [ ] **Step 4: 커밋**

```bash
git add src/components/plan/PlanClient.tsx
git commit -m "feat(plan): add expandable detail panel with steps/tip/videoRef/hours"
```

---

## Task 5: 수동 동작 검증

**Files:** (없음 — 검증만)

- [ ] **Step 1: dev 서버 시작**

Run: `npm run dev`
Expected: localhost:3000

- [ ] **Step 2: /plan 페이지 접속**

URL: `http://localhost:3000/plan`
Expected: Week 1 활성 + 7개 task 표시 + 우측 별 + 확장 버튼

- [ ] **Step 3: 각 주차 별 표시 확인**

Week 1~12 클릭하면서:
- 각 task에 ⭐~⭐⭐⭐⭐⭐ 표시되는지 확인
- 별 색상이 난이도별로 변하는지 (초록→연두→노랑→주황→빨강)
- 매주 task가 별 적은 것부터 정렬되어 있는지 확인

- [ ] **Step 4: 확장 패널 토글 검증**

Week 1 첫 번째 task의 ▶ 클릭:
- 확장 패널 펼쳐짐
- 단계별 가이드 (📋) 표시
- 팁 (💡) 노란 배경
- 영상 출처 (📺) + 예상 시간 (⏱️) 표시
- ▶가 ▼로 변경

다시 ▼ 클릭:
- 패널 접힘
- 체크박스 토글 영향 없음

- [ ] **Step 5: 체크박스 토글 검증 (회귀)**

task 영역(별/확장 버튼 제외) 클릭 → 체크 토글 정상 동작
- 체크 시 task 텍스트 줄긋기 + 회색
- 진행률 카운트 증가
- 새로고침 후에도 체크 유지 (localStorage)

- [ ] **Step 6: 모바일 반응형 점검**

브라우저 개발자 도구 → 모바일 뷰 (iPhone 14)
- task 텍스트가 줄바꿈 정상
- 별/확장 버튼이 잘 보임
- 확장 패널이 화면 안에 수렴

- [ ] **Step 7: 검증 결과 메모**

발견된 UX 이슈가 있으면 issue 또는 retrospective 노트로 기록.

---

## Task 6: 운영 배포

- [ ] **Step 1: push**

```bash
git push origin main
```

- [ ] **Step 2: Vercel 자동 재배포 확인**

Run: `/Users/seungminlee/.npm-global/bin/vercel ls 2>&1 | grep -E "Building|Ready" | head -2`
Expected: 가장 최근 deploy가 Building 상태로 시작

빌드 완료까지 약 1분 대기.

- [ ] **Step 3: 운영 환경 검증**

가장 최근 deploy URL의 `/plan` 페이지 접속 → 별 + 확장 패널 정상 동작 확인.

---

## Self-Review

**1. Spec coverage** ✅
- §2 데이터 구조 → Task 1
- §3 난이도 기준 → Task 2 가이드
- §4 12주 곡선 → Task 2 검증 테스트
- §5 매주 정렬 → Task 2 Step 2 + 검증 테스트
- §6 채널 영상 인용 → Task 2 영상 매핑 표
- §7 UI 변경 → Task 3 (별/토글) + Task 4 (패널)
- §8 변경 파일 → Task 1~4
- §9 작업 순서 → Task 1~6
- §11 검증 항목 → Task 5

**2. Placeholder scan** ✅
- 모든 step에 정확한 코드 또는 명령
- "TBD"/"TODO" 0건
- 영상 매핑/난이도 가이드 표 명시 (구체)

**3. Type consistency** ✅
- WbsTask 인터페이스 — Task 1에서 정의, Task 2에서 사용, Task 3·4에서 access
- expandedTasks Set — Task 3에서 정의, Task 4에서 .has() 호출
- difficultyColor / renderStars 함수 — Task 3에서 정의, Task 3·4에서 사용

**4. 실행 시간 추정**
- Task 1: 5분 (타입 확장)
- Task 2: 30~45분 (84 task 데이터 작업이 핵심)
- Task 3: 15분 (UI 추가)
- Task 4: 20분 (확장 패널)
- Task 5: 10분 (수동 검증)
- Task 6: 5분 (push + 모니터링)

**총 약 90분**
