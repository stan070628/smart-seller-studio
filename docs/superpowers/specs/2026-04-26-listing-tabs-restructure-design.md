# 상품등록탭 하위 탭 구조 재편 설계

**날짜:** 2026-04-26
**상태:** 승인됨

---

## 목적

`/listing` 페이지의 진입점이 4갈래(`+ 새 상품 등록` / `📋 내 상품 조회` / `대량 등록` / 헤더의 `🤖 URL 자동등록`)로 분산되어 있어 멘탈모델이 혼란스럽다. 또한 `대량 등록` 흐름이 안정적으로 동작하지 않아, 향후 `URL 자동등록`을 학습/검증해 대량 처리의 토대로 삼는다.

이번 변경으로 진입점을 **3개 탭**으로 단순화하고, 등록 흐름을 URL 입력 기반으로 통일한다.

---

## 현재 구조 (Before)

```
헤더: [대시보드] [소싱] [에디터] [상품등록] [주문/매출] [플랜]      [🤖 URL 자동등록]
                                                                ↑ /listing/auto-register 별도 페이지
페이지 내부:
  ┌─ 모드 토글 ────────────────────────────────────────┐
  │ [+ 새 상품 등록]  [📋 내 상품 조회]  [대량 등록] │ ← 빨강 강조
  └────────────────────────────────────────────────────┘
  ↓
  새 상품 등록: Step1(소스: 이미지/도매꾹) → Step2(AI 처리) → Step3(검수+등록)
  내 상품 조회: BrowseMode
  대량 등록  : BulkImportPanel
```

**문제점**

1. 진입점 4개가 위치/스타일이 제각각
2. `URL 자동등록`이 별도 페이지로 빠져 컨텍스트가 끊김
3. `대량 등록` 토글만 빨간색으로 강조되어 위계가 일관되지 않음
4. `내 상품 조회`가 등록 흐름과 동등한 토글 위계 — 등록이 주 목적인데 흐려짐
5. 현재 `대량 등록`이 안정적으로 동작하지 않음

---

## 새 구조 (After)

```
헤더: [대시보드] [소싱] [에디터] [상품등록] [주문/매출] [플랜]
                                                                ↑ 우측 자동등록 버튼 제거
페이지 내부:
  ┌─ 탭 ───────────────────────────────────────────────┐
  │ [AI 상품 등록]  [내 상품 조회]  [썸네일·상세만 만들기] │
  │  ▲ 기본 진입                                         │
  └────────────────────────────────────────────────────┘
```

- 한 페이지에서 탭 전환. URL 동기화: `?tab=register|browse|assets`
- `register`가 기본값. 미지정 시 `register` 탭이 활성화
- `assets`는 신규 탭

---

## 탭별 상세 설계

### 탭 1. AI 상품 등록 (`tab=register`)

URL 입력 1개 → AI 처리 → 검수+등록의 **3-step 하이브리드 흐름**.
1단계는 **단일 URL 처리만 구현**. 향후 큐 기반 다중 URL 처리(B 옵션)로 확장 가능한 구조로 설계.

```
Step 1. URL 입력  →  Step 2. AI 처리  →  Step 3. 검수+등록 (섹션 폼)
```

#### Step 1 — URL 입력 (`Step1SourceSelect` 재작성)

- 기존 "이미지 업로드 / 도매꾹 불러오기" 옵션 제거
- 단일 URL 입력 필드 + `[자동 처리 시작]` 버튼만 노출
- URL 형식 검증 (http/https 시작, 비어 있지 않음)
- URL의 source 식별(쿠팡/도매꾹/코스트코 등)은 백엔드 파싱에서 처리 — Step1은 형식 검증만

#### Step 2 — AI 처리 (`Step2Processing` 유지)

- 현재 흐름 그대로: URL 파싱 → 이미지 추출 → 상세 HTML 생성
- 진행률 UI 유지

#### Step 3 — 검수 + 등록 (`Step3ReviewRegister` 확장)

기존 컴포넌트의 `<Section>` 아코디언을 활용해 한 화면에 6개 섹션 배치:

| 섹션 | 기본 상태 | 내용 |
|------|----------|------|
| 기본정보 | 펼침 | 상품명, 카테고리 |
| 가격/재고 | 펼침 | 판매가, 원가, 재고 |
| 이미지 | 펼침 | 썸네일(N장) + 상세 이미지(N장) |
| 상세설명 | 접힘 | 상세 HTML 미리보기/편집 |
| 배송 | 접힘 | 배송비, 반품비 |
| 검색어/키워드 | 접힘 | 태그 |

- 하단에 고정 액션 바: `[등록하기]` (플랫폼별 버튼은 기존 패턴 유지)
- 한 화면 스크롤로 검수가 가능하되, 관심 영역만 펼쳐서 효율↑

### 탭 2. 내 상품 조회 (`tab=browse`)

- 기존 `BrowseMode` 컴포넌트를 그대로 사용
- 변경 없음. 탭 위치/이름만 정리

### 탭 3. 썸네일·상세만 만들기 (`tab=assets`)

등록까지 가지 않고 **자산만 생성**. 결과물은 다운로드 + Supabase 저장 둘 다 가능.

#### 입력

라디오 토글로 선택:

- **URL 모드**: URL 1개 입력 → 파싱 + 이미지 추출 + AI 자산 생성
- **직접 업로드 모드**: 이미지/텍스트 raw 업로드 → AI 자산 생성

#### 처리

- 썸네일 N장 + 상세 HTML(또는 이미지) 생성
- 미리보기 화면 제공

#### 출력 액션

- `[개별 다운로드]` — 썸네일/상세 각각 파일로 저장
- `[ZIP 다운로드]` — 전체 묶음 다운로드
- `[Supabase에 저장]` — `generated_assets` 테이블에 메타데이터+파일 경로 저장

#### 자산 재사용 (1단계 범위 외)

- 이번 1단계에서는 **저장만 구현**. "AI 상품 등록" 탭에서 가져오는 UI는 만들지 않음
- 향후 확장: URL 자동 매칭 또는 수동 불러오기 UI 추가

---

## 폐기 대상 (코드 정리)

| 대상 | 처리 |
|------|------|
| `BulkImportPanel` (대량 등록 패널) | 제거 |
| `DomeggookPreparePanel` (도매꾹 패널) | 제거 |
| `BothRegisterForm` (동시 등록) | 제거 |
| Step1의 이미지 업로드/도매꾹 분기 | 제거 |
| `PlatformTabs` 미사용 코드 | 정리 |
| 헤더 우측 `🤖 URL 자동등록` `<Link>` | 제거 |
| `listingMode === 'bulk'` 분기 | 제거 |
| `/listing/auto-register` 페이지 | **유지** (진입점만 끊고 코드/라우트는 남김) |

> `/listing/auto-register` 6-step 위저드는 향후 참고/실험용으로 코드를 남긴다. 다만 어떤 사용자 동선에서도 도달하지 않는다.

---

## 데이터/상태 변경

### `useListingStore` (Zustand)

```typescript
// 변경 전
type ListingMode = 'register' | 'browse' | 'bulk';

// 변경 후
type ListingMode = 'register' | 'browse' | 'assets';
```

- `sharedDraft.source` (있다면): `'image' | 'domeggook' | 'url'` → `'url'` 단일값으로 축소
  - 타입에서 다른 값 제거하거나 deprecate
- 신규 슬라이스: `assetsDraft`
  - `mode: 'url' | 'upload'`
  - `url: string`
  - `uploadedFiles: File[]`
  - `generatedThumbnails: string[]`
  - `generatedDetailHtml: string`
  - `isGenerating: boolean`
  - `lastError: string | null`

### URL 동기화

```typescript
// /listing?tab=register|browse|assets
useEffect(() => {
  const tabParam = searchParams.get('tab');
  if (tabParam === 'browse' || tabParam === 'assets' || tabParam === 'register') {
    setListingMode(tabParam);
  }
}, [searchParams, setListingMode]);
```

- `setListingMode` 호출 시 `router.replace`로 URL도 함께 갱신

---

## Supabase 신규 마이그레이션 (`038_generated_assets.sql`)

```sql
CREATE TABLE generated_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type     text NOT NULL,           -- 'url' | 'upload'
  source_url      text,                    -- URL 모드일 때만
  thumbnails      text[] NOT NULL DEFAULT '{}',  -- Supabase Storage 경로 배열
  detail_html     text,                    -- 또는 detail_image 경로
  detail_image    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX ON generated_assets(user_id, created_at DESC);

ALTER TABLE generated_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "본인 데이터만" ON generated_assets
  FOR ALL USING (auth.uid() = user_id);
```

- Storage 버킷: 1단계 진입 시 기존 listing 관련 버킷 존재 여부를 확인하고, 있으면 재사용 / 없으면 `generated-assets` 신규 생성. 결정은 plan 단계 첫 작업으로 확정

---

## 신규 API 라우트

### `POST /api/listing/assets/generate`

요청:
```jsonc
{
  "mode": "url" | "upload",
  "url": "https://...",          // mode=url
  "files": [/* base64 또는 form-data */]  // mode=upload
}
```

응답:
```jsonc
{
  "success": true,
  "data": {
    "thumbnails": ["..."],          // Storage 또는 임시 URL
    "detailHtml": "<div>...",       // detail_html 모드일 때
    "detailImage": "..."            // detail_image 모드일 때 (둘 중 하나만 채워짐)
  }
}
```

### `POST /api/listing/assets/save`

요청:
```jsonc
{
  "sourceType": "url" | "upload",
  "sourceUrl": "https://...",       // sourceType=url일 때
  "thumbnails": ["..."],
  "detailHtml": "<div>...",
  "detailImage": "..."
}
```

응답:
```jsonc
{
  "success": true,
  "data": { "id": "uuid" }
}
```

생성된 자산을 `generated_assets` 테이블 + Storage에 저장.

---

## 컴포넌트 구조 변경 요약

```
src/components/listing/
  ListingDashboard.tsx              ← 탭 토글 변경, bulk 분기 제거, 헤더 버튼 제거
  workflow/
    Step1SourceSelect.tsx           ← URL 입력 전용으로 재작성
    Step2Processing.tsx             ← 변경 없음
    Step3ReviewRegister.tsx         ← 6 섹션 아코디언 폼으로 확장
    StepIndicator.tsx               ← 변경 없음 (이미 3-step)
  browse/
    BrowseMode.tsx                  ← 변경 없음
  assets/                           ← 신규 디렉터리
    AssetsTab.tsx                   ← 신규
    AssetsInputPanel.tsx            ← 신규 (URL/업로드 토글)
    AssetsResultPanel.tsx           ← 신규 (미리보기 + 다운로드/저장 액션)
  BulkImportPanel.tsx               ← 삭제
  DomeggookPreparePanel.tsx         ← 삭제
  BothRegisterForm.tsx              ← 삭제
```

---

## 테스트 전략

### 단위
- `Step1SourceSelect`: URL 형식 검증, 빈 입력 가드
- `Step3ReviewRegister`: 섹션 토글, 필수 필드 검증
- `AssetsInputPanel`: 모드 토글, 입력 검증
- `useListingStore`: `assetsDraft` 슬라이스 동작

### 통합
- `/listing` 진입 → 탭 전환 → URL 동기화
- URL 입력 → AI 처리 → 등록 호출까지 happy path
- 자산 생성 → Supabase 저장 → 목록 노출 (목록 UI는 1단계 범위 외이므로 DB row만 검증)

### 회귀 가드
- `bulk` / `domeggook` 코드 제거 후 빌드 + 타입체크 + 기존 테스트 모두 통과
- `/listing/auto-register` 페이지는 직접 URL 진입 시 여전히 동작 (E2E smoke)

---

## 마이그레이션 노트

- 진행 중인 `sharedDraft`에 source가 `image` 또는 `domeggook`인 사용자는 다음 진입 시 `register` 탭의 새 Step1로 리다이렉트(상태 reset)
- `localStorage`에 저장된 `listingMode === 'bulk'`는 `register`로 강제 변환

---

## 미해결 / 향후 확장

| 항목 | 1단계 | 추후 |
|------|------|------|
| 다중 URL 큐 처리 | ❌ | ⭕ B 옵션 — 진행률 리스트, 실패 재시도 |
| 자산 재사용 UI ("AI 상품 등록"에서 불러오기) | ❌ | ⭕ URL 자동 매칭 또는 수동 선택 |
| `/listing/auto-register` 폐기 또는 통합 | ❌ | ⭕ 1단계 검증 후 결정 |
| 자산 목록/관리 UI | ❌ | ⭕ "썸네일·상세만 만들기" 탭 내 히스토리 섹션 |

---

## 작업 우선순위

1. 탭 구조 변경 (`ListingDashboard` 수정, URL 동기화, 헤더 버튼 제거)
2. `Step1SourceSelect` URL 입력 전용 재작성
3. `Step3ReviewRegister` 섹션 아코디언 확장
4. `BulkImportPanel`/`DomeggookPreparePanel`/`BothRegisterForm` 제거 + zustand 정리
5. Supabase 마이그레이션 `038_generated_assets.sql`
6. 새 탭 `AssetsTab` 컴포넌트 + 입력/결과 패널
7. `POST /api/listing/assets/generate`, `POST /api/listing/assets/save` API
8. 테스트 작성 + 회귀 가드
