# PRO 상세페이지 고객 후기(REVIEW) 섹션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRO 상세페이지에 스크린샷 스타일의 "고객 후기 카드" 섹션을 추가한다. 참고 이미지처럼 **닉네임 + 별점 + 제목 + 본문**을 2×2 카드 그리드로 렌더한다(사진 없는 텍스트 카드). 후기 섹션은 **완전 자동** — 업로드 화면 UI 변경 없이, `생성 시작` 단계에서 AI가 판매포인트·분석 결과로 **4개 카드**를 작성하고, 편집은 기존 에디터의 인라인 편집으로 처리한다.

**Architecture:** PRO는 모든 섹션을 `claude_layout`으로 산출하고 내부를 `LayoutBlock` 유니온으로 조립한다. 따라서 최상위 `SectionType`이 아니라 **신규 `LayoutBlock: review_cards`** 하나를 추가한다. (1) 타입 정의 → (2) 결정론적 Zod 검증(`layout-validator.ts`) → (3) 렌더러(`section-renderer.ts`, 인라인 편집 `editableText`/`basePath` 패턴 준수) → (4) 생성 프롬프트(`generate-pro-layout` `CLAUDE_SYSTEM`)에 블록 스펙 + "후기 섹션 항상 1개·정확히 4항목" 규칙 결선. 이미지 파이프라인·업로드 화면·`render/route.ts` 최상위 enum은 변경 없음(review_cards는 claude_layout의 하위 블록).

**Tech Stack:** Next.js(App Router), TypeScript, Zod, vitest, 자체 HTML 문자열 렌더러(`section-renderer.ts`). AI는 Claude Opus vision(`generate-pro-layout`).

> **환경 주의:** 이 환경에서 인자 없는 `npx vitest run`은 라이브러리 테스트까지 돌며 worker 타임아웃으로 죽을 수 있다. 반드시 **경로를 지정**(`npx vitest run <path>`)해 회귀를 판단한다. 타임아웃 시 동일 assertion을 `tsx` 하니스(`_tdd_*.ts`)로 구동해 RED/GREEN을 관찰하고 하니스는 삭제한다.

> **디자인 근거:** `scratchpad/pro-review-input-mockup.html` (3단계 플로우 목업). 스크린샷 = 강아지 쿨매트 REVIEW 섹션(2×2, 별점 5, 닉네임 마스킹).

---

## File Structure

| 파일 | 책임 | 액션 |
|---|---|---|
| `src/types/detail-page.ts` | `LayoutBlock` 유니온에 `review_cards` 추가 | Modify |
| `src/lib/detail-page/layout-validator.ts` | `zLayoutBlock` discriminatedUnion + `isEmptyBlock`에 `review_cards` 반영 | Modify |
| `src/lib/detail-page/section-renderer.ts` | `renderReviewCards` 추가 + `renderLayoutBlock` switch에 `case 'review_cards'` (editableText/basePath 지원) | Modify |
| `src/app/api/ai/generate-pro-layout/route.ts` | `CLAUDE_SYSTEM`에 블록 스펙 + "후기 섹션 항상 1개, items 정확히 4개, 별점 4~5, 닉네임 마스킹" 규칙 | Modify |
| `src/__tests__/lib/detail-page/layout-validator.test.ts` | review_cards 스키마/sanitize 단위 테스트 | Modify(or Create) |
| `src/__tests__/lib/detail-page/section-renderer-pro-blocks.test.ts` | `renderReviewCards` 렌더 스냅샷/editable 테스트 | Modify |

---

## 데이터 모델

```typescript
// src/types/detail-page.ts — LayoutBlock 유니온에 추가
| { type: 'review_cards';
    title: string;        // 예: "REVIEW"
    eyebrow?: string;     // 예: "Best Review" (스크립트체 서브)
    lead?: string;        // 예: "많은 고객님들께서 소중한 아이를 위해 …" 한 줄
    items: Array<{
      nickname: string;   // 마스킹된 닉네임. 예: "박*정"
      rating: number;     // 4 또는 5 (렌더 시 1~5로 clamp)
      title: string;      // 후기 제목 1줄
      body: string;       // 후기 본문 (40자 내외 구어체)
    }> }
```

---

## WS1 — 타입 + 검증

### Task 1: LayoutBlock 타입 확장 + Zod 스키마
**Files:**
- Modify: `src/types/detail-page.ts` (`LayoutBlock` 유니온, `option_grid` 다음 줄에 추가)
- Modify: `src/lib/detail-page/layout-validator.ts`

**layout-validator.ts 변경:**
- `zLayoutBlock` discriminatedUnion(line ~42, `option_grid` 다음)에 추가:
```typescript
z.object({
  type: z.literal('review_cards'),
  title: z.string(),
  eyebrow: z.string().optional(),
  lead: z.string().optional(),
  items: z.array(z.object({
    nickname: z.string(),
    rating: z.number(),
    title: z.string(),
    body: z.string(),
  })),
}),
```
- `isEmptyBlock`(line ~91) `itemTypes` 배열에 `'review_cards'` 추가 → items 빈 배열이면 prune.

**Test (`layout-validator.test.ts`):**
- [ ] RED: 유효한 review_cards 블록이 `sanitizeProLayout`을 통과하고 items 4개가 보존된다.
- [ ] RED: items 빈 배열 review_cards 블록은 `isEmptyBlock`/pruneBlocks로 제거된다.
- [ ] RED: body에 CJK(한자) 섞인 후기 → `stripCjk`로 한자만 제거되고 한글은 보존된다.
- [ ] GREEN: 스키마·isEmptyBlock 반영 후 통과.

---

## WS2 — 렌더러

### Task 2: renderReviewCards + switch 결선
**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts`

**구현:**
- `renderReviewCards(block, colors, theme, basePath)` 헬퍼 신규. 레이아웃:
  - 상단: `title`(크게, `colors.text`) + `eyebrow`(스크립트/이탤릭, 우측 정렬, 선택) + 구분선 + `lead`(선택).
  - 본문: `grid-template-columns: 1fr 1fr; gap`. 각 카드 = `colors.cardBg` 배경, 라운드. 카드 내부: `[닉네임 | ★별점]` 한 줄 → 제목(볼드) → 본문(뮤트).
  - 별점: `rating`을 1~5로 clamp 후 채운 ★ + 빈 ☆, 색은 `colors.text`(다크 카드 대응은 기존 `isDark` 감지 재사용).
- `renderLayoutBlock` switch(line ~710)에 `case 'review_cards': return renderReviewCards(...)` 추가.
- **인라인 편집:** 기존 WS2(pro-detail-reliability) 패턴대로 `basePath`를 받아 `title`·`eyebrow`·`lead` 및 각 item의 `title`·`body`·`nickname`을 `editableText(value, \`${basePath}.items[i].title\`)`로 감싼다. → 에디터 미리보기에서 클릭 편집 가능.
- 카드 배경·텍스트 가시성은 `section_renderer_dark_bg` 메모리 규칙 준수(하드코딩 `#f9fafb` 금지, `isDark`면 `rgba(255,255,255,0.12)`).

**Test (`section-renderer-pro-blocks.test.ts`):**
- [ ] RED: review_cards 4항목 렌더 → 닉네임·제목·본문 문자열이 출력 HTML에 포함, 카드 컨테이너 grid, 별점 문자 개수 = rating.
- [ ] RED: `rating: 7` 등 범위 밖 → 5로 clamp되어 별 5개.
- [ ] RED: basePath 주입 시 각 item title/body에 `data-edit-path` 속성이 붙는다.
- [ ] GREEN: 구현 후 통과.

---

## WS3 — 생성 프롬프트 결선

### Task 3: CLAUDE_SYSTEM에 review_cards 스펙 + 규칙
**Files:**
- Modify: `src/app/api/ai/generate-pro-layout/route.ts`

**블록 스펙 추가(다른 블록 나열부, `option_grid` 항목 근처):**
```
- review_cards: { type, title, eyebrow?, lead?, items: [{nickname, rating, title, body}] }
  — 고객 후기 카드 그리드. 사진 없음. 판매포인트·분석 결과를 근거로 실제 후기처럼 작성.
```

**DESIGN/COPYWRITING RULES 추가:**
- 페이지에 **정확히 하나의 review_cards 섹션**을 포함하라. 위치는 CTA 직전(하단).
- `title`은 "REVIEW" 또는 "고객 후기", `eyebrow`는 "Best Review"류 짧은 서브(선택), `lead`는 제품+상황 한 줄(선택).
- `items`는 **정확히 4개**. `rating`은 4 또는 5.
- `nickname`은 **마스킹 형식**(예: "박*정", "재원***") — 실명·이메일 금지.
- `title`은 후기 한 줄 요약, `body`는 구어체 리얼 후기 어조(40자 내외). 판매포인트에서 근거를 끌어오되 과장·허위 효능 표현 금지.
- 후기 문구에 한자/이모지 금지(기존 규칙 준수).

> **주의:** 생성 응답은 이후 `sanitizeProLayout`(WS1 스키마)을 통과하므로 별도 파싱 코드 변경 불필요. items가 4개가 아니거나 필드 누락 시 sanitize/repair 경로가 흡수한다. `repair-pro-layout.ts` 프롬프트에도 review_cards 규칙을 한 줄 반영할지 검토(선택).

**Test:**
- [ ] 프롬프트 문자열에 `review_cards` 스펙·"정확히 4개"·"마스킹" 지시어가 포함되는지 간단 단위 검증(있다면 기존 프롬프트 스냅샷 테스트에 반영).

---

## 검증(수동)

- [ ] `npx vitest run src/__tests__/lib/detail-page/layout-validator.test.ts`
- [ ] `npx vitest run src/__tests__/lib/detail-page/section-renderer-pro-blocks.test.ts`
- [ ] PRO 플로우 실제 구동: 참고 스크린샷 업로드 → 분석 → 생성 → 결과에 후기 카드 4개 섹션 생성 확인 → 에디터에서 후기 문구 인라인 수정 반영 확인.
- [ ] `npx tsc --noEmit` 타입 통과.

---

## Out of Scope

- 리뷰 사진(고객 실사진) 삽입 — 사진 없는 텍스트 카드로 확정.
- 업로드 화면 후기 옵션 UI(개수 선택·직접 입력) — 완전 자동·4개 고정으로 확정, UI 없음.
- 데스크톱/모바일 레거시(`section-parser`, `MOBILE_DETAIL_PAGE_*`) 리뷰 섹션 — PRO(`claude_layout`) 한정.
