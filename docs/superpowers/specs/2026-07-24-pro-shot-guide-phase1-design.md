# PRO 촬영 가이드 (Phase 1) 설계 문서

> 작성일: 2026-07-24
> 상태: 승인됨 (구현 대기)
> 큰 그림: "PRO 상세페이지에 자연스러운 실사진 넣기" 완결형 기능의 1단계. 전체 4 Phase 중 첫 단계.

## 0. 전체 기능 맥락 (참고)
사용자가 PRO 상세페이지의 AI 이미지 대신 **자연스러운 실사진**을 넣고 싶어 함. 완결형 루프를 4단계로 분해:
- **Phase 1 (이 문서)** — 촬영 가이드 생성·표시 (단독 가치)
- Phase 2 — 저장 & 재개 (`detail_page_drafts`에 `shoot_session` 컬럼 추가 + PRO 페이지를 draft에 연결)
- Phase 3 — 슬롯별 실사진 업로드
- Phase 4 — AI 가벼운 보정 + 섹션 삽입

범위 결정(확정): 실사진 대상은 **`detail_closeup` 슬롯만**(라이프스타일은 AI 유지). 보정은 **가벼운 수준**(노출·색·배경 정돈). 흐름은 **저장 후 재개**(Phase 2에서 구현).

## 1. Phase 1 목적
`generate-pro-layout`이 만든 레이아웃의 **`detail_closeup` 슬롯**들을, 사용자가 폰으로 실제 찍을 수 있는 **촬영 지시(리치 카드)** 로 변환해 보여준다. 표시 전용 — 업로드/보정/저장/이미지 교체는 이후 Phase.

## 2. 현재 구조 (파악 완료)
- PRO 페이지: `src/app/listing/[id]/detail-maker-pro/page.tsx`. `ScreenState` union(약 L9/L53): `'upload' | 'review' | 'generating' | 'result'`. 각 화면은 top-level early-return JSX.
- `generatedSections: GeneratedSection[]`(L53~) — 각 섹션에 `imageSlots:[{slotType, promptHint, imageRef}]`. `slotType='detail_closeup'`가 대상.
- Claude 호출: `src/lib/ai/claude-cli.ts`의 `callClaude(system, userPrompt, model, maxTokens)`.
- `result` 화면(L699~)에 "에디터에서 편집" apply 핸들러(L802~). Phase 1은 이 흐름을 **바꾸지 않는다**(가이드는 곁다리 표시).

## 3. 설계

### ① 새 API — `POST /api/ai/generate-shot-guide`
- 파일: `src/app/api/ai/generate-shot-guide/route.ts`
- 입력(zod): `{ productInfo: { name: string, points: string[], category?: string }, shots: [{ sectionTitle: string, promptHint: string }] }` (shots는 클라이언트가 `generatedSections`에서 `detail_closeup` 슬롯만 추출)
- 처리: `callClaude(SYSTEM, userPrompt, 'sonnet', ...)` — 각 슬롯의 AI 연출 지시문을 **사람용 폰 촬영 지시**로 변환. JSON 배열 반환.
- 출력: `{ success: true, data: { shots: ShotCard[] } }`
- 인증·레이트리밋: 기존 AI 라우트 패턴(`requireAuth`, `checkRateLimit`) 준수.

### ② ShotCard 스키마
```ts
// src/types/detail-page.ts (또는 신규 shot-guide.ts)
export interface ShotCard {
  sectionTitle: string;   // 이 컷이 들어갈 섹션
  subject: string;        // 촬영 대상 (제품의 어느 부위/특징)
  angle: string;          // 구도·각도 (예: "정면에서 살짝 위 45도")
  framing: string;        // 프레이밍 (접사/매크로/풀샷)
  lighting: string;       // 조명 (예: "창가 자연광, 부드러운 확산")
  background: string;     // 배경 (예: "무지 화이트 / 원목 테이블")
  tip: string;            // 한두 줄 실전 팁
}
```

### ③ 프롬프트 가드레일 (SYSTEM)
- **폰 촬영 현실성**: 매크로/접사, 자연광, 깔끔한 배경 등 개인이 폰으로 재현 가능한 지시만.
- 제품 정보/promptHint에 없는 특징을 지어내지 않음.
- 한국어, 구체적·실전적. 추상 클리셰 금지(기존 COPYWRITING C1 정신 준수).
- 입력 `shots` 각 항목당 정확히 1개의 ShotCard 생성(순서·개수 유지).

### ④ UI — 새 화면 `'shootguide'`
- `ScreenState`에 `'shootguide'` 추가.
- `result` 화면에 버튼 **"📸 촬영 가이드 만들기"** 추가(기존 "에디터에서 편집"과 나란히).
  - 클릭 → `detail_closeup` 슬롯 추출 → (없으면 안내 토스트 "이 레이아웃엔 디테일 접사 컷이 없어요", 화면 전환 안 함) → 있으면 로딩 → API 호출 → `screen='shootguide'`.
- `shootguide` 화면:
  - ShotCard 리스트(카드마다 6필드 표시, 섹션별 그룹).
  - **[체크리스트 복사]** — 카드들을 텍스트 체크리스트로 클립보드 복사.
  - **[다운로드 .txt]** — 동일 텍스트를 `촬영가이드.txt`로 저장(폰으로 보며 촬영).
  - **[에디터로 계속 →]** — 기존 apply 핸들러 호출(현행과 동일 동작).
  - **[← 뒤로]** — `screen='result'`.
- 상태: `shotGuide: ShotCard[] | null`, `shotGuideLoading: boolean` 추가.

### ⑤ 클라이언트 추출 로직
`generatedSections`를 순회하며 `imageSlots` 중 `slotType==='detail_closeup'`인 것을 모아 `{ sectionTitle: section.title, promptHint: slot.promptHint }[]` 생성.

## 4. 범위 밖 (YAGNI — 이후 Phase)
- 실사진 업로드(Phase 3), AI 보정·삽입(Phase 4), 저장·재개(Phase 2).
- 예시/목표 이미지 생성(리치카드+이미지 옵션은 채택 안 함).
- 라이프스타일 슬롯 가이드(대상 아님).
- `generate-pro-layout` 프롬프트/출력 변경 없음(가이드는 별도 패스).

## 5. 구현 산출물 요약
1. `src/app/api/ai/generate-shot-guide/route.ts` — 신규 API + SYSTEM 프롬프트 + zod 스키마 + `ShotCard` 파싱
2. `ShotCard` 타입 (신규 `src/types/shot-guide.ts` 또는 `detail-page.ts`에 추가)
3. `src/app/listing/[id]/detail-maker-pro/page.tsx` — `'shootguide'` 화면 + result 버튼 + 추출/복사/다운로드 로직 + 상태
4. 테스트: 추출 로직(순수 함수로 분리) + 체크리스트 직렬화 + API zod/파싱. (studio vitest 기본설정은 이 환경에서 행 — 순수 로직은 node-env 임시설정으로 검증)

## 6. 참고 — 테스트 환경 주의
studio 기본 `vitest.config.ts`는 이 환경에서 MSW/jsdom로 행(hang). 순수 로직 테스트는 프로젝트 루트에 임시 config(`environment:'node'`, `setupFiles:[]`, `@`→`src` alias) 만들어 `npx vitest run --config`로 돌리고 삭제. UI/화면 로직은 순수 함수(추출·직렬화)로 분리해 테스트 커버.
