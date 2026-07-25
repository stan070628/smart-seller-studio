# PRO 촬영 가이드 (Phase 2 — 저장 & 재개) 설계 문서

> 작성일: 2026-07-24
> 상태: 승인됨 (구현 대기)
> 선행: Phase 1(촬영 가이드 표시, 브랜치 `feat-pro-shot-guide`) 완료. 이 문서는 Phase 2.

## 0. 맥락
"PRO 상세페이지에 실사진 넣기" 4단계 중 2단계. 사용자가 촬영 가이드를 받고 **나갔다가(촬영) 나중에 돌아와** 이어서 작업할 수 있게, PRO 진행 상태를 DB에 저장/재개한다. (현재 PRO 흐름은 완전 휘발성 — sessionStorage만 사용, DB 저장 없음.)

## 1. 목적
- 촬영 가이드까지 만든 상태(레이아웃 + 상품정보 + shotGuide)를 `detail_page_drafts`에 저장.
- "촬영 진행중" 초안 리스트에서 다시 열어 같은 지점(`shootguide` 화면)으로 복귀.
- Phase 3(컷별 업로드)·Phase 4(보정·삽입)의 지속성 토대.

## 2. 현재 구조 (확인됨)
- 테이블 `detail_page_drafts` (`supabase/migrations/084_detail_page_drafts.sql`): `id, user_id, listing_id, product_name, sections jsonb, theme jsonb, thumbnail_url, created_at, updated_at`. RLS는 service-role `using(true)`, 앱이 `requireAuth`+`.eq('user_id',userId)`로 스코프.
- 라우트 `src/app/api/detail-page/draft/route.ts`: `DraftUpsertSchema`(L12) `{ id?, listingId?, productName?, sections, theme, thumbnailUrl? }`. POST upsert(L21), GET는 `?id=`/`?listingId=` 단건(L83, select L107). **둘 다 없으면 400**(L91).
- PRO 페이지 `src/app/listing/[id]/detail-maker-pro/page.tsx`: `[id]`는 하드코딩 `"new"`(미사용). DB 저장 없음. 최종 핸드오프만 sessionStorage(`pro_sections`)→에디터. 에디터(`DetailMakerClient.tsx:140-158`)는 1.5s 디바운스로 draft POST 자동저장 — **이 패턴을 PRO에 이식**.
- 마이그레이션: `NNN_snake.sql` 순차, 최신 091 → 다음 **092**. 084 패턴(FK 없음, service-role 정책) 따름.

## 3. 설계

### ① 마이그레이션 `supabase/migrations/092_detail_page_drafts_shoot_session.sql`
```sql
-- PRO 촬영 세션 상태 (촬영 가이드 + 컷별 업로드 진행)
alter table detail_page_drafts
  add column if not exists shoot_session jsonb not null default '{}';
```
(별도 인덱스 불필요 — 리스트는 기존 `(user_id, updated_at desc)` 인덱스로 충분.)

### ② draft API 확장 (`src/app/api/detail-page/draft/route.ts`)
- `DraftUpsertSchema`에 `shootSession: z.record(z.string(), z.unknown()).optional()` 추가. POST의 `row`에 `shoot_session: shootSession ?? {}`(단, 값이 없으면 기존 유지 위해 partial update 고려 — 최소구현: 넘어오면 저장).
- GET 단건 `select`에 `shoot_session` 추가, 응답에 `shootSession: d.shoot_session` 포함.
- **리스트 모드**: `GET ...?list=1` → 사용자의 **촬영 초안만** 반환.
  - 쿼리: `.eq('user_id', userId).neq('shoot_session', '{}')` (또는 `shoot_session->>'step' is not null`), `.order('updated_at', desc)`, `.limit(50)`.
  - 응답: `{ success:true, drafts:[{ id, productName, updatedAt, step, shotCount }] }` (step·shotCount는 `shoot_session`에서 파생).
  - `?list=1`가 있으면 id/listingId 없어도 400 아님(현재 L91 분기 앞에 list 분기 추가).

### ③ PRO 페이지 배선 (`detail-maker-pro/page.tsx`)
- **상태**: `draftId: string | null` 추가.
- **저장(생성)**: `handleShotGuide` 성공 직후(shotGuide 세팅 후) draft를 POST:
  ```
  { id: draftId ?? undefined, productName, sections: generatedSections, theme: {},
    shootSession: { shotGuide, step: 'guide' } }
  ```
  → 응답 `id`를 `draftId`에 저장 → URL을 `?draftId=<id>`로 shallow 갱신(`history.replaceState` 또는 router).
- **자동저장**: `draftId`가 있고 관련 상태(shotGuide 등)가 바뀌면 1.5s 디바운스로 재 POST(에디터 패턴 이식).
- **재개(mount)**: `useSearchParams`의 `draftId`가 있으면 GET `?id=<draftId>` → 복원: `productName`, `productPoints`(가능하면), `generatedSections`(sections), `shotGuide`(shootSession.shotGuide) → `setScreen('shootguide')`.
- shoot_session 스키마(Phase 2 범위): `{ shotGuide: ShotCard[], step: 'guide' }`. (Phase 3에서 `slots:[{...,assetUrl,status}]` 추가.)

### ④ "촬영 진행중" 리스트 UI
- PRO 업로드 화면(`upload`) 상단에 **"이어서 진행할 촬영"** 섹션.
- mount 시 `GET /api/detail-page/draft?list=1` 호출 → 초안 있으면 카드/행 리스트(상품명 · 수정일 · step · 컷수) 렌더, 없으면 미표시.
- 항목 클릭 → `?draftId=<id>`로 이동(같은 PRO 페이지) → ③의 재개 경로로 복원.

### ⑤ 범위 밖 (YAGNI — Phase 3·4)
- 컷별 실사진 업로드 UI/로직(Phase 3), AI 보정·섹션 삽입(Phase 4).
- 실제 listing 엔티티 신설(대신 draft `id`를 식별자로 사용).
- 썸네일·theme 저장 정교화(현행 유지).

## 4. 구현 산출물 요약
1. `supabase/migrations/092_detail_page_drafts_shoot_session.sql`
2. `src/app/api/detail-page/draft/route.ts` — `shootSession` 저장/조회 + `?list=1` 리스트 모드
3. `detail-maker-pro/page.tsx` — draft 저장/자동저장/재개 배선 + `draftId` 상태 + URL 동기화
4. `detail-maker-pro/page.tsx`(upload 화면) — "촬영 진행중" 리스트 UI
5. (구현 전) Supabase 마이그레이션 적용 방법 확인(로컬 `supabase db push`/원격 적용), studio dirty 브랜치 처리, Phase 2용 feature 브랜치

## 5. 참고 — 검증
- draft API 순수 로직(리스트 파생 `step/shotCount`, 스키마 파싱)은 순수 함수로 분리해 테스트. 라우트 자체는 인증/DB라 tsc + 수동 스모크(브라우저)로 커버.
- studio vitest 기본설정 행 이슈 → 순수 테스트는 node 임시 config recipe로.
- 마이그레이션은 로컬/원격 DB에 실제 적용 후, 저장→새로고침/재접속→리스트에서 복귀 스모크로 검증.
