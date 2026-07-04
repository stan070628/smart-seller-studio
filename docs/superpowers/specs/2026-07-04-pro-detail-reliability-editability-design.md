# PRO 상세페이지 — 신뢰성 + 편집가능화 패키지 (설계)

- **작성일**: 2026-07-04
- **상태**: 승인됨 (구현 대기)
- **목표 축**: A(결과물 품질) + D(편집 자유도)
- **범위**: 첫 서브프로젝트. 이후 S1-lite(골든 few-shot·프리셋·CVR 블록) → S4 나머지 → 쿠팡 export 검증 → S3 이미지 편집기로 이어진다.

## 배경 / 문제

경쟁 프로그램(에디봇·망고보드·미리캔버스·캔바)은 템플릿·에셋 중심 수동 디자인이고, 이 제품의 PRO 모드는 AI-first 완전 자동 생성이 강점이다. 사용자는 "결과물 품질(A)"과 "편집 자유도(D)"를 목표로 골랐다.

Fable 5 독립 검증 + 직접 코드 확인으로 밝혀진 사실: **품질 편차의 원인은 "템플릿 부재"가 아니라 파이프라인 결함**이다. 3중 결함을 코드로 확인했다.

1. **무검증 생성** — `generate-pro-layout/route.ts:172-185`는 Claude 출력을 `JSON.parse` → `stripCjk` 후 `unknown[]`로 **Zod 검증 없이 반환**. `render/route.ts:35`도 `content: z.record(z.string(), z.unknown())`로 블록 내부 무검증. 블록 하나가 `items`를 빠뜨리면 `renderLayoutBlock`의 `block.items.map`에서 throw → **페이지 전체 렌더 실패**.
2. **편집 불가** — `editableText`/`editableMarkupText`는 레거시 섹션 렌더러(`section-renderer.ts:146~359`)에만 있고 **`renderLayoutBlock`(697~880) 내부엔 0개**. PRO 산출물(claude_layout) 텍스트는 미리보기 클릭 편집이 안 되고, "재생성"은 블록을 통째로 다시 뽑는 재추첨이다.
3. **영속성 제로** — migrations에 detail_page 스키마 없음, 저장/draft API 없음. PRO→에디터 전달은 `sessionStorage` 1회용(`detail-maker-pro/page.tsx`, `DetailMakerClient.tsx`). **새로고침 = 전부 소실**.

추가 확인: `src/lib/ai/detail-page-rubric.ts`는 "생성·수리 프롬프트가 공유하는 단일 소스"라 선언하지만 **아무도 import 안 하는 고아 파일**이고 repair 라우트는 존재하지 않는다.

이 3중 결함 위에 템플릿(S1)을 얹으면 렌더 실패·편집 불가·소실을 그대로 상속하므로, 파이프라인 신뢰성과 편집가능화를 **선행**한다.

## 목표 / 비목표

**목표**
- 생성된 DSL이 무엇이든 페이지가 깨지지 않는다(렌더 실패 제거).
- PRO 산출물 텍스트를 미리보기에서 직접 클릭 편집한다.
- 작업물이 새로고침·재접속에도 보존된다.
- 고아 rubric을 실제 단일 소스로 배선한다.

**비목표 (YAGNI — 이 스펙 밖)**
- LLM 기반 repair 1-pass (훅만 남기고 미구현).
- undo/history, 블록 복사·이동, 섹션 타입 변환, 다중 선택 (후속 S4).
- 차트 블록(SVG) 인라인 편집.
- 템플릿 갤러리 (후속 S1).
- 쿠팡 직접 업로드 / 원장 이미지 export (후속).

## 아키텍처 — 데이터 흐름

```
generate-pro-layout
  → stripCjk → sanitizeProLayout()            [WS1] 검증/수리
  → 섹션 배열
  → autosave (디바운스 upsert)                 [WS3] 영속화
  → 에디터 렌더 (renderLayoutBlock + editableText)  [WS2] 인라인 편집
  → 인라인 편집 → updatePathValue → 재렌더 → autosave
  → render 라우트 (ClaudeLayoutContentSchema 검증)   [WS1]
  → HTML export
```

---

## WS1 — LayoutBlock 검증 + 수리

**목표:** 불량 DSL이 페이지 렌더를 깨지 않게. 고아 rubric을 실제 단일 소스로.

### 구성요소
- **새 파일** `src/lib/detail-page/layout-block-schema.ts`
  - `LayoutBlockSchema`: `types/detail-page.ts`의 `LayoutBlock` union과 1:1 대응하는 Zod discriminated union. 각 블록의 필수 필드(`items` 배열, `label` 등) 강제.
  - `ClaudeLayoutContentSchema`: `{ type:'claude_layout', title, points?, blocks: LayoutBlockSchema[], bgStyle?, padding? }`.
  - 단일 책임 파일. `types/detail-page.ts`의 타입이 진실의 원천이고 이 파일은 그 런타임 반영.
- **`sanitizeProLayout(sections: unknown[]): DetailSection[]`** (같은 파일 또는 `pro-layout-sanitize.ts`)
  - 결정론적. LLM 호출 없음 → 빠르고 저렴하고 안정적.
  - 절차:
    1. 섹션 배열을 순회. 각 섹션의 `content.blocks`를 블록별 `safeParse`.
    2. **통과 못 한 블록만 드롭**(섹션은 유지). 블록이 전부 드롭돼 빈 섹션이 되면 그 섹션 제거.
    3. 빈 라벨(stripCjk 잔해로 `''`가 된 텍스트) 블록/항목 정리.
  - **절대 throw 하지 않는다.** 전량 실패 시 빈 배열 반환 + `console.warn`으로 드롭 통계 로깅.

### 배선
- `generate-pro-layout/route.ts`: `sections = stripCjk(sections)` 다음 줄에 `sections = sanitizeProLayout(sections)` 추가 후 반환. 드롭 개수 로깅.
- `generate-pro-layout` 인라인 `CLAUDE_SYSTEM`의 블록 선택 규칙 문단을 `import { DETAIL_PAGE_PERSONA, BLOCK_TYPE_RUBRIC } from '@/lib/ai/detail-page-rubric'`로 교체(문자열 결합). → 고아 파일이 실제 단일 소스가 됨. (rubric에 이미 있는 option_grid 규칙과 정합.)
- `render/route.ts`: `RequestSchema`의 section `content: z.record(...)`를 유지하되, `type === 'claude_layout'`인 섹션에 대해 `ClaudeLayoutContentSchema`로 추가 검증(superRefine 또는 렌더 직전 sanitize 재적용). 다른 레거시 타입은 기존 동작 유지.
- `renderLayoutBlock`: 각 case에 방어 가드(예: `if (!Array.isArray(block.items)) return ''`) — 스키마를 우회한 경로에 대한 이중 안전.

### 에러 처리
- sanitize: throw 금지, 빈 배열 폴백 + 경고.
- 렌더러 가드: 누락 필드 시 해당 블록만 빈 문자열, 페이지 전체는 생존.

### 테스트 (TDD)
- `layout-block-schema.test.ts`: 유효 블록 통과 / `items` 누락 블록 드롭 / 빈 섹션 제거 / 정상 섹션·블록 보존 / 전량 불량 시 빈 배열.

---

## WS2 — claude_layout 인라인 편집

**목표:** PRO 산출물 텍스트를 미리보기에서 클릭 편집 → 재추첨 루프 탈출. (D의 최저비용 핵심)

### 구성요소
- `renderLayoutBlock(block, images, colors)` → **`renderLayoutBlock(block, images, colors, basePath)`**로 시그니처 확장.
- `renderClaudeLayout`이 각 블록에 `content.blocks.${i}`를 `basePath`로 전달.
- 텍스트 필드 렌더를 `escapeHtml(x)` → `editableText(\`${basePath}.<field>\`, x)`로 교체:
  - `badge.text`, `heading.text`, `subtext.text`
  - `stat_row` items[n]: `.items.${n}.label` / `.value` / `.unit`
  - `bullet_list` items[n]: `.items.${n}`
  - `process_flow` / `option_grid` items[n]: `.items.${n}.label` / `.sublabel`
  - `icon_grid` items[n]: `.items.${n}.title` / `.subtitle`
  - `columns`: 재귀 호출 시 `${basePath}.cols.${c}.${r}` 전달
  - `layout_bar_chart` / `radar_chart` / `timeline`: 텍스트가 SVG 이미지라 편집 대상 제외(스킵).

### 배선
- **클라이언트 무변경.** `updatePathValue`(`DetailPageEditor.tsx:67-86`)가 배열 인덱스+객체 키를 재귀 처리하여 `content.blocks.0.items.1.label` 같은 깊은 경로를 이미 해석함(직접 확인).
- 편집 후 재렌더는 기존 `refreshRenderedHtml` 경로 그대로.

### 주의
- `editableText`는 `<span data-edit-path>`로 감싼다. 기존 레거시에서 h1/div 내부 인라인으로 쓰였으므로 flex/grid item 내부에서도 동일하게 안전. 시각 회귀는 렌더 스냅샷으로 확인.

### 테스트 (TDD)
- `section-renderer-claude-layout.test.ts` 확장: claude_layout 렌더 시 badge/heading/각 items 텍스트에 `data-edit-path="content.blocks.0…"` 속성이 존재.

---

## WS3 — 드래프트 영속화

**목표:** 새로고침·재접속에도 작업물 보존. sessionStorage 1회용 대체. (편집 투자의 전제)

### 데이터 모델 — 마이그레이션 `063_detail_page_drafts.sql`
`assets_drafts`(062) 패턴을 따른다.

```sql
create table if not exists detail_page_drafts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  listing_id    uuid,
  product_name  text,
  sections      jsonb not null default '[]',
  theme         jsonb not null default '{}',
  thumbnail_url text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists detail_page_drafts_user_updated
  on detail_page_drafts (user_id, updated_at desc);
alter table detail_page_drafts enable row level security;
create policy "본인 데이터만" on detail_page_drafts for all using (auth.uid() = user_id);
```
- `listing_id`는 nullable — PRO 모드는 `/listing/[id]/detail-maker-pro`에서 채우고, 일반 모드는 비운다.

### API — `src/app/api/detail-page/draft/route.ts`
- `POST` (upsert): body `{ id?, listingId?, productName, sections, theme, thumbnailUrl? }`. `requireAuth` 후 `user_id` 서버 주입. `id` 있으면 update(본인 소유 확인), 없으면 insert. 저장된 `id` 반환.
- `GET ?id=<uuid>` 또는 `?listingId=<uuid>`: 본인 소유 드래프트 로드.
- Zod로 body 검증. sections/theme는 저장 전 `sanitizeProLayout` 재적용(WS1 재사용)해 오염 저장 방지.

### 클라이언트 배선 — `DetailMakerClient.tsx`
- sections/theme 상태 변경 시 **디바운스 자동저장(~1.5s)** → `POST /api/detail-page/draft`. 반환 `id`를 `draftId` state로 유지.
- 진입 시: URL의 `listingId` 또는 `draftId`가 있으면 `GET`으로 복원. 없고 sessionStorage 핸드오프가 있으면 최초 1회 시드 후 즉시 첫 저장 → 이후 draft로 승격(sessionStorage 의존 제거).
- 저장 상태 표시("저장 중…" / "저장됨").

### 에러 처리
- 저장 실패: 조용히 지수 백오프 재시도 + 실패 지속 시 사용자 토스트. 로컬 React state는 유지(기존 동작 보존)라 데이터 손실 없음.

### 범위 경계
- undo/history는 이 스펙 밖(S4). 단 `sections`/`theme` 스냅샷을 저장하는 이 구조가 history의 상태 토대가 된다.

### 테스트
- draft API 통합 테스트: 인증 필요 / 본인 격리(타인 드래프트 접근 거부) / upsert(insert→update) / load.
- 마이그레이션 테스트: 기존 `src/__tests__/migrations` 패턴.

---

## 테스트 전략 (전체)
- WS1: schema unit + sanitize unit (TDD).
- WS2: renderer unit — `data-edit-path` 존재 (TDD).
- WS3: API 통합 + migration.
- **환경 주의:** 이 환경에서 `vitest` 러너가 worker 생성 60초 타임아웃으로 죽는다. 커밋된 vitest 테스트와 동일한 assertion을 `tsx` 하니스로 병행 구동해 RED/GREEN을 실제 관찰한다(정상 환경에선 vitest 그대로 통과).

## 구현 순서 (권장)
1. WS1 (schema → sanitize → 배선 → rubric 결선) — 바닥을 먼저 올린다.
2. WS2 (renderer editableText 배선) — WS1로 안전해진 위에서 편집 가능화.
3. WS3 (migration → API → autosave 배선) — 편집 투자를 보존.

## 리스크 / 오픈 이슈
- `render/route.ts`의 claude_layout 추가 검증이 기존 유효 페이지를 거부하지 않도록 스키마를 실제 생성 출력으로 역검증할 것(회귀 방지).
- 자동저장 빈도 vs 요청량: 디바운스 1.5s로 시작, 필요 시 조정.
- 차트 블록(SVG)의 쿠팡 Wing 생존은 별도 후속 스펙(export 검증)에서 다룬다 — 이 스펙 범위 아님.
