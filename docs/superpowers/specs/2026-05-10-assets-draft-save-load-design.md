# 썸네일·상세만 만들기 — 임시저장·불러오기 기능 설계

## 개요

"썸네일·상세만 만들기" 탭(`AssetsTab`)에 임시저장(이름 붙여 여러 개)·불러오기 기능을 추가한다.
저장 대상은 입력값(mode, url, 이미지 파일 URL)과 생성 결과(썸네일, 상세 HTML, 섹션 편집 상태, 테마) 모두이며, Supabase에 보관한다.

---

## 1. DB 스키마

Supabase SQL Editor에서 아래 DDL을 직접 실행한다.

```sql
create table if not exists assets_drafts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  draft_data  jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index assets_drafts_user_created
  on assets_drafts (user_id, created_at desc);
```

`draft_data` JSONB 구조 (UI 전용 필드 제외):

```ts
{
  mode: 'url' | 'upload';
  url: string;
  thumbnailFiles: string[];
  detailFiles: string[];
  generatedThumbnails: string[];
  generatedDetailHtml: string;
  detailPageSections: DetailSection[];
  detailPageTheme: DetailPageTheme;
}
```

제외 필드: `isGenerating`, `generatingMessage`, `lastError` (런타임 UI 상태)

---

## 2. API Routes

### GET/POST `/api/listing/assets/drafts`

- **GET**: 로그인 사용자의 임시저장 목록 반환 (최신 30개, `created_at DESC`)
  - 응답: `{ drafts: AssetsDraftMeta[] }`
- **POST**: 새 draft 저장
  - 요청: `{ name: string, draftData: object }`
  - 응답: `{ id: string }` (HTTP 201)

### DELETE `/api/listing/assets/drafts/[id]`

- 소유자 확인 후 삭제
- 응답: `{ success: true }`

인증: 기존 `requireAuth()` 유틸 사용. PUT(업데이트) 없음 — 덮어쓰기는 삭제 후 재저장.

---

## 3. 클라이언트 라이브러리

`src/lib/listing/assets-drafts.ts` 신규 파일.

```ts
export interface AssetsDraftMeta {
  id: string;
  name: string;
  draftData: Record<string, unknown>;
  createdAt: string;
}

export async function getAssetsDrafts(): Promise<AssetsDraftMeta[]>
export async function saveAssetsDraft(name: string, draftData: Record<string, unknown>): Promise<AssetsDraftMeta>
export async function deleteAssetsDraft(id: string): Promise<void>
```

패턴은 `src/lib/label/label-templates.ts`와 동일 (fetch + 에러 throw).

---

## 4. AssetsSaveLoad 컴포넌트

`src/components/listing/assets/AssetsSaveLoad.tsx` 신규 파일.

UI 구조 (`LabelSaveLoad.tsx`와 동일):

```
[ 드롭다운: 저장 목록 선택... ] [불러오기] [삭제]
[ 이름 입력 (이름 입력 후 저장) ] [저장    ]
[ 성공/실패 메시지 (12px)       ]
```

동작:
- 마운트 시 `getAssetsDrafts()` 호출 → 목록 초기화
- 불러오기: 선택한 draft의 `draftData`를 `updateAssetsDraft(draftData)` 에 전달
  - UI 전용 필드(`isGenerating`, `generatingMessage`, `lastError`)는 전달하지 않음
- 저장: 이름 입력 + 저장 버튼 클릭 → `saveAssetsDraft(name, draftData)` 호출
  - `draftData`는 `assetsDraft`에서 UI 전용 필드를 제거한 객체
- 삭제: 선택한 항목 `window.confirm` 후 `deleteAssetsDraft(id)` 호출

Props:
```ts
interface Props {
  currentDraftData: Record<string, unknown>;  // 저장할 현재 상태
  onLoad: (data: Record<string, unknown>) => void;  // 불러오기 콜백
}
```

---

## 5. AssetsInputPanel 수정

`src/components/listing/assets/AssetsInputPanel.tsx`의 패널 상단(모드 선택 라디오 버튼 위)에 `AssetsSaveLoad`를 추가한다.

```tsx
// AssetsInputPanel 내부 — 최상단
<AssetsSaveLoad
  currentDraftData={buildDraftData(assetsDraft)}
  onLoad={(data) => updateAssetsDraft(data as Partial<AssetsDraft>)}
/>
<hr />
{/* 기존 모드 선택 라디오 버튼 */}
```

`buildDraftData` 헬퍼: `assetsDraft`에서 `isGenerating`, `generatingMessage`, `lastError`를 제외한 나머지를 반환.

---

## 6. 변경 파일 목록

| 파일 | 종류 |
|------|------|
| Supabase SQL (직접 실행) | DDL |
| `src/app/api/listing/assets/drafts/route.ts` | 신규 |
| `src/app/api/listing/assets/drafts/[id]/route.ts` | 신규 |
| `src/lib/listing/assets-drafts.ts` | 신규 |
| `src/components/listing/assets/AssetsSaveLoad.tsx` | 신규 |
| `src/components/listing/assets/AssetsInputPanel.tsx` | 수정 |

---

## 7. 에러 처리

- 목록 로드 실패: 빈 목록으로 fallback, 에러 메시지 표시
- 저장 실패: catch → 에러 메시지 표시
- 삭제 실패: catch → 에러 메시지 표시
- 불러오기 후 UI 전용 필드는 항상 초기값 유지 (isGenerating: false 등)

---

## 8. 범위 밖

- 자동저장(debounce) 없음 — 수동 저장만
- 30개 초과 시 페이지네이션 없음 — 최신 30개만 표시
- 공유/협업 기능 없음
