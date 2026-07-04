# PRO 모드 상세페이지 생성 검증·수리 루프 설계

- **작성일**: 2026-07-04
- **작성 모델**: Claude Opus 4.8 (1M context)
- **대상**: 상품상세 자동만들기(detail-maker) PRO 모드 — `/api/ai/generate-pro-layout`

---

## 1. 배경 & 문제

PRO 모드는 참고 상세페이지 스크린샷을 Gemini Vision으로 OCR 분석한 뒤, Claude Opus(`/api/ai/generate-pro-layout`)가 전체 페이지 레이아웃을 `ClaudeLayoutContent[]` DSL로 생성한다. 그러나 생성 결과에서 다음과 같은 품질 문제가 반복 발생한다:

1. **한자/CJK·깨진 텍스트** — 결과에 한자가 남거나, 한자만 삭제되어 문장이 깨짐(예: "无线충전" → "충전")
2. **블록 타입 ↔ 내용 부적합(의미 오류)** — 사이즈(S/M/L)를 `process_flow`(순서 흐름)로 만들거나, 단순 병렬 나열을 차트로 만드는 등
3. **스키마 위반·미지원 타입** — 필수 필드 누락, 렌더러 미구현 타입(`radar_chart`, `timeline`) 사용
4. **빈·중복·이상 구조** — 빈 텍스트 블록, 연속 중복 섹션, 섹션 수 범위 이탈, 쿠팡 금지어

### 현재 상태 (기존 코드 근거)

생성 프롬프트(`generate-pro-layout/route.ts:37-78`)에는 **이미** 예방 규칙이 존재한다:
- 규칙 7: 한자 금지 + 치환 예시
- 규칙 9: `사이즈·색상·용량·구성은 process_flow 금지, 반드시 option_grid` 명시
- `option_grid` 블록 타입도 이미 정의·렌더링됨(`types/detail-page.ts:177`)

검증은 `stripCjk()`(한자 **삭제**만)와 `extractJsonArray()`(JSON 유효성만)뿐이다.

**핵심 시사점**: 예방 프롬프트에 규칙이 이미 있음에도 문제가 반복된다 → **생성 프롬프트 강화만으로는 부족하며, 생성 이후 검증·수리 단계가 반드시 필요하다.** 그리고 `stripCjk`처럼 "삭제"하는 방식은 문장을 깨뜨리므로, "삭제"가 아니라 "재작성"으로 바꿔야 한다.

---

## 2. 목표 & 비목표

### 목표
- 생성된 DSL을 반환하기 전에 **결정적 코드 검증 + LLM 리뷰·수리 루프**를 거쳐 위 4가지 문제를 자동 교정한다.
- 코드로 감지 불가능한 **의미 오류(블록 타입 부적합)** 를 LLM 리뷰어가 잡는다.
- 자동 교정 후에도 남은 문제는 사용자에게 **경고**로 표면화한다(차단하지 않음).

### 비목표
- 단일 섹션 생성 경로(`/api/ai/generate-claude-layout-section`)는 이번 범위 밖. 단, 검증기·루브릭은 재사용 가능하도록 설계한다.
- OCR 분석(`analyze-detail-page`) 품질 개선은 범위 밖.
- 디자인 미학(색상/여백) 자동 평가는 범위 밖 — 구조·의미 정합성에 집중.

---

## 3. 채택 접근 (Approach A)

**코드 결정적 검증 + 항상 1회 LLM 리뷰·수리 패스 + 재검증 루프.**

- 의미 오류는 코드 위반이 하나도 없어도 존재할 수 있으므로, **LLM 리뷰 패스는 위반 유무와 무관하게 1차에 항상 실행**한다.
- LLM 리뷰어는 생성이 Opus여도 **Sonnet**으로 호출(제약된 체크리스트 작업이라 충분, 비용 절감).
- 로컬은 Claude Max(CLI)로 무료, 배포는 API — `callClaude`가 자동 폴백하므로 코드는 모델 별칭만 지정.

---

## 4. 아키텍처

```
generate-pro-layout/route.ts (Claude Opus 생성)
        │  GeneratedSection[] (파싱 후)
        ▼
┌──────────────────────────────────────────────────────┐
│  오케스트레이션 루프 (route.ts 내)                        │
│                                                        │
│  [A] validateProLayout(sections) → Violation[]         │  ← 결정적, 코드
│  [B] repairProLayout(sections, violations) → sections  │  ← LLM(Sonnet)
│  [C] sanitizeProLayout(sections) → { sections, warns } │  ← 결정적 폴백
└──────────────────────────────────────────────────────┘
        │  { sections, warnings }
        ▼
결과 화면(detail-maker-pro/page.tsx): 경고 배너
```

### 4.1 공유 루브릭 (신규) — `src/lib/ai/detail-page-rubric.ts`

블록 타입 의사결정 규칙을 **단일 소스**로 정의하여 생성·수리 프롬프트가 함께 import한다. (질문에서 나온 "전문가 페르소나"는 별도 항목이 아니라 이 루브릭으로 흡수 — 막연한 페르소나 문구보다 명시적 판단 규칙이 품질을 좌우함.)

```ts
export const DETAIL_PAGE_PERSONA = `You are a senior Korean e-commerce detail-page designer
specializing in mobile (390px) conversion-optimized layouts.`;

/** 블록 타입 선택 규칙 + 안티패턴. 생성/수리 양쪽에서 사용. */
export const BLOCK_TYPE_RUBRIC = `
BLOCK TYPE SELECTION RULES:
- 사이즈/색상/용량/구성 등 "순서 없는 병렬 선택 옵션" → option_grid (NEVER process_flow)
- 시간/순서가 있는 단계(세탁→건조→보관, 봄→여름) → process_flow
- 비교 수치(2개 이상 그룹의 값 비교) → layout_bar_chart
- 단일 임팩트 숫자 → stat_row
- 단순 특징 나열 → bullet_list / icon_grid (차트로 만들지 말 것)
- 렌더러 미구현: radar_chart, timeline 사용 금지
TEXT RULES:
- 모든 텍스트는 한글 또는 영어만. 한자(漢字) 절대 금지. 한자가 필요하면 한글 음차로 재작성.
`;
```

- 생성 프롬프트(`CLAUDE_SYSTEM`)는 이 상수들을 조합해 재구성한다(기존 규칙 7·9와 동일 취지 → 중복 제거).
- **단일 소스 원칙**: 규칙을 바꿀 때 이 파일만 수정하면 생성·수리 양쪽에 반영된다.

### 4.2 결정적 검증기 (신규) — `src/lib/detail-page/layout-validator.ts`

```ts
export interface Violation {
  code: string;          // 'cjk' | 'broken_text' | 'schema' | 'unsupported_type'
                         // | 'empty_block' | 'duplicate' | 'section_count' | 'prohibited'
  path: string;          // 'sections[2].blocks[1].text'
  message: string;       // 사람이 읽는 설명 (수리 프롬프트에 그대로 전달)
  severity: 'error' | 'warning';
  autoFixable: boolean;  // sanitize가 코드로 교정 가능한지
}

export interface ValidationResult {
  violations: Violation[];
  isClean: boolean;      // error severity가 하나도 없으면 true
}

export function validateProLayout(sections: unknown): ValidationResult;
```

**검사 항목:**

| code | 검사 내용 | severity |
|------|----------|----------|
| `schema` | Zod로 각 섹션/블록 union 검증. 필수 필드 누락·잘못된 enum(bgStyle 등) | error |
| `unsupported_type` | `radar_chart`, `timeline` 사용 | error |
| `cjk` | CJK 정규식(`一-鿿`, `㐀-䶿`, `豈-﫿`) 매칭 | error |
| `broken_text` | U+FFFD(치환문자), 고립 결합 자모, 빈 문자열로 깨진 흔적 | warning |
| `empty_block` | heading/subtext/badge의 text가 공백, items 빈 배열 | warning |
| `duplicate` | 연속 동일 섹션/블록 | warning |
| `section_count` | 섹션 수 6~10 범위 밖 | warning |
| `prohibited` | `checkProhibitedPhrases()`(기존 재사용) 위반 | error |

- **Zod 스키마**는 `types/detail-page.ts`의 `LayoutBlock` union·`ClaudeLayoutContent`를 그대로 반영하는 `zLayoutBlock`, `zClaudeSection`을 이 파일에 정의한다(타입과 스키마의 단일 대응).
- 의미 오류(블록 타입 부적합)는 **여기서 감지하지 않음** → LLM 담당.

### 4.3 LLM 리뷰·수리 (신규) — `src/lib/ai/repair-pro-layout.ts`

```ts
export async function repairProLayout(
  sections: unknown[],
  violations: Violation[],
  productInfo: { name: string; points: string[]; category: string },
): Promise<unknown[]>;
```

- **시스템 프롬프트**: `DETAIL_PAGE_PERSONA` + `BLOCK_TYPE_RUBRIC` + "You are reviewing an already-generated layout. Fix issues and return corrected JSON only."
- **유저 프롬프트**: 원본 sections JSON + violations 목록(코드가 넘긴 결정적 위반) + 상품 정보 + 의미 점검 지시("Also verify each block type fits its content per the rubric; reassign wrong types").
- `callClaude(system, user, 'sonnet', 16000)` 호출 → `extractJsonArray()`로 파싱(기존 헬퍼를 공용 유틸로 추출해 공유).
- 파싱 실패 시 원본 `sections`를 그대로 반환(수리 실패는 다음 폴백 단계가 처리).

### 4.4 코드 최소교정 폴백 (신규) — `sanitizeProLayout`

`layout-validator.ts` 또는 별도 파일에 위치.

```ts
export function sanitizeProLayout(sections: unknown[]): {
  sections: unknown[];
  warnings: Violation[];
};
```

- `autoFixable` 위반을 코드로 강제 교정: 잔여 CJK 삭제(`stripCjk` 재사용), 빈 블록 제거, 미지원 타입 블록 제거(또는 근접 타입 변환), 섹션 수 정보는 경고로만.
- 교정 불가능하거나 정보성인 잔여 항목을 `warnings`로 수집해 반환.

### 4.5 오케스트레이션 (수정) — `generate-pro-layout/route.ts`

```ts
// ... 기존: text 생성 → extractJsonArray → JSON.parse → sections
let sections = JSON.parse(jsonStr) as unknown[];

const MAX_LLM_PASSES = 2;   // 1차 리뷰(항상) + 필요 시 2차 수리
for (let pass = 0; pass < MAX_LLM_PASSES; pass++) {
  const { violations, isClean } = validateProLayout(sections);
  // 1차(pass 0)는 isClean이어도 의미 점검을 위해 항상 실행
  if (pass > 0 && isClean) break;
  sections = await repairProLayout(sections, violations, productInfo);
}

// 최종 폴백: 남은 결정적 문제 코드 교정 + 경고 수집
const { sections: finalSections, warnings } = sanitizeProLayout(sections);

return NextResponse.json({ success: true, sections: finalSections, warnings });
```

**루프 규칙 명확화:**
- `pass 0`: **항상** `repairProLayout` 실행(결정적 위반 + 의미 점검). 위반이 없어도 의미 오류를 잡기 위함.
- 재검증 후 결정적 error가 남으면 `pass 1`에서 1회 더 수리.
- 총 **최대 2회 LLM 콜**. 이후 `sanitizeProLayout`으로 코드 교정 + `warnings` 반환. (사용자 요구: "최대 2회 재시도 후 경고 통과")
- `MAX_LLM_PASSES`는 상수로 두어 조정 가능.

**성능/타임아웃**: 현재 `maxDuration = 180`. 생성(Opus, ~30–60s) + 리뷰 최대 2회(Sonnet) 합산이 180s 안에 들어가는지 확인. 초과 위험 시 `maxDuration` 상향 또는 리뷰 `maxTokens`/모델 조정.

### 4.6 UI (수정) — `detail-maker-pro/page.tsx`

- `handleGenerate`의 응답 타입에 `warnings?: Violation[]` 추가(라인 175 부근).
- `result` 화면 상단에 경고 배너: `warnings.length > 0`일 때 "N개 항목 자동 보정됨, M개 확인 필요"와 접을 수 있는 상세 목록.
- 경고 없으면 배너 미표시(정상 경로 방해 없음).
- (선택) 경고를 sessionStorage로 에디터까지 전달하는 것은 이번 범위 밖 — 결과 화면 표시로 한정.

---

## 5. 데이터 흐름 요약

```
OCR(analyze-detail-page) → editedSections
  → POST generate-pro-layout { productInfo, analyzedSections, productImageCount }
    → Claude Opus 생성 → parse → sections
    → [pass0] validate → repair(Sonnet, 루브릭+위반)   ← 항상
    → [pass1] validate → (error 남으면) repair          ← 조건부
    → sanitize → { sections, warnings }
  → 결과 화면: 섹션 미리보기 + 경고 배너
  → "에디터에서 편집" → sessionStorage(pro_sections) → detail-maker
```

---

## 6. 테스트 계획 (Vitest, 경로 지정 실행)

> 프로젝트 특성상 인자 없는 `npx vitest run`은 라이브러리 테스트까지 돌려 대량 선재 실패가 나므로, 신규 테스트는 **경로를 지정해** 실행한다.

- **`layout-validator.test.ts`**: 각 검사 항목별 케이스 — 한자 포함, 깨진 자모, 스키마 위반, 미지원 타입, 빈 블록, 연속 중복, 섹션 수 이탈, 금지어. clean 케이스가 `isClean:true`인지.
- **`repair-pro-layout.test.ts`**: `callClaude` 모킹 — 프롬프트에 루브릭·위반 목록이 포함되는지, 응답 파싱 성공/실패 처리, 파싱 실패 시 원본 반환.
- **오케스트레이션(route) 통합**: `callClaude`·`repairProLayout` 모킹 — pass0 항상 실행, clean이면 pass1 미실행, error 잔존 시 pass1 실행, 최종 `warnings` 반환.
- **`sanitizeProLayout`**: 잔여 CJK 삭제, 빈/미지원 블록 제거, 경고 수집.

---

## 7. 파일 변경 요약

| 파일 | 변경 |
|------|------|
| `src/lib/ai/detail-page-rubric.ts` | **신규** — 페르소나 + 블록 타입 루브릭(단일 소스) |
| `src/lib/detail-page/layout-validator.ts` | **신규** — `validateProLayout`, `sanitizeProLayout`, Zod 스키마 |
| `src/lib/ai/repair-pro-layout.ts` | **신규** — `repairProLayout` (Sonnet) |
| `src/app/api/ai/generate-pro-layout/route.ts` | **수정** — 루브릭 import로 프롬프트 재구성, 오케스트레이션 루프, `warnings` 반환 |
| `src/app/listing/[id]/detail-maker-pro/page.tsx` | **수정** — `warnings` 타입, 결과 화면 경고 배너 |
| (기존 `extractJsonArray`) | 공용 유틸로 추출해 route·repair 공유 |
| `src/__tests__/...` | **신규** — 위 테스트 |

---

## 8. 리스크 & 판단

- **의미 리뷰 항상 실행 → 생성마다 LLM 콜 +1**: 품질 우선 결정(사용자 승인). Sonnet으로 비용 완화. 조정 필요 시 `MAX_LLM_PASSES`/모델 변경.
- **리뷰어가 정상 레이아웃을 오히려 개악할 위험**: 수리 프롬프트에 "문제 없으면 그대로 반환" 명시 + 재검증으로 완화. 그래도 남는 리스크는 경고 배너로 사용자 확인.
- **타임아웃(180s)**: 3개 LLM 콜 합산 확인 필요(§4.5).
- **단일 소스 루브릭**: 생성/수리가 같은 규칙을 공유 → 규칙 변경이 양쪽에 자동 반영(유지보수 이점).
