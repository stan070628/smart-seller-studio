# PRO 상세페이지 유튜브 영상 섹션 Design

**Status:** Approved (brainstorming) — 2026-07-19
**Author:** brainstorming session

## 1. 목표

상세페이지에 유튜브 영상(Shorts/일반) 섹션을 추가한다. 셀러는 에디터에서 URL을 붙여넣어 섹션을 만들고, **에디터 미리보기에서는 실제 재생**해 확인하며, **쿠팡/스마트스토어에 붙여넣을 내보내기 HTML에는 재생버튼이 합성된 썸네일 이미지 + 링크**가 들어간다. 영상은 있을 수도 없을 수도 있으므로 **섹션별 표시/숨김 토글**로 on/off 하며, 상세페이지 완성 후 나중에 다시 열어 유튜브 섹션을 추가·업데이트할 수 있어야 한다(기존 드래프트 저장 재사용).

## 2. 핵심 제약 (설계 근거)

- **목적지 = 쿠팡/스마트스토어 편집기 붙여넣기.** 마켓플레이스는 붙여넣은 HTML의 `<iframe>`·`<script>`를 제거하므로, **완성 상세페이지 안에서 실제 유튜브 재생은 불가**하다.
- 쿠팡은 data URI·외부 이미지 핫링크가 제한적이라(메모리: "쿠팡 HTML은 호스팅 URL만 표시"), 썸네일은 **우리 Supabase Storage에 재업로드한 호스팅 URL**이어야 한다.
- 따라서 **미리보기(iframe 재생) ↔ 내보내기(썸네일 이미지) 이원화**가 이 설계의 중심이다.

## 3. 데이터 모델

신규 최상위 섹션 타입 `youtube`. (리뷰 카드가 AI 생성 `claude_layout` 하위 블록인 것과 달리, 유튜브는 사용자가 에디터에서 직접 추가·편집하므로 최상위 `SectionType`으로 둔다. 최상위여야 `createEmptySection`·섹션 추가 드롭다운·드래그 순서변경·render enum 경로를 탄다.)

```typescript
// src/types/detail-page.ts
export interface YoutubeContent {
  type: 'youtube';
  url: string;                          // 붙여넣은 원본 URL (보존)
  videoId: string;                      // 파싱된 11자 ID
  aspect: 'vertical' | 'horizontal';    // Shorts=9:16, 일반=16:9
  caption?: string;                     // 예: "동영상제공:유투버varoachi"
  enabled: boolean;                     // 표시/숨김 토글 (false면 렌더 제외)
}
```

- `SectionType` 유니온에 `'youtube'` 추가.
- `SectionContent` 유니온에 `YoutubeContent` 추가.
- `isYoutubeContent` 타입 가드 추가.

### URL 파싱 규칙 (`videoId` + `aspect` 추정)
지원 형식과 videoId 추출:
- `https://youtu.be/<id>` → id
- `https://www.youtube.com/watch?v=<id>` → id
- `https://www.youtube.com/shorts/<id>` → id, **aspect 기본 `vertical`**
- `https://www.youtube.com/embed/<id>` → id
- 그 외/일반 watch·youtu.be → **aspect 기본 `horizontal`**
- 파싱 실패 시 섹션은 "URL을 다시 확인하세요" 안내 상태로 두고 렌더는 빈 문자열.
- `aspect`는 자동 추정 후 에디터에서 수동 전환 가능.

## 4. 에디터 UX (`DetailPageEditor.tsx`)

- **섹션 추가 드롭다운**(`ADD_SECTION_OPTIONS`)에 `{ type: 'youtube', label: '유튜브 영상' }` 추가.
- 섹션 카드 편집 폼(유튜브 전용):
  - URL 입력칸 → 입력 시 `videoId` 파싱 + `aspect` 자동 추정.
  - 비율 전환(세로 Shorts / 가로 일반) 세그먼트.
  - 캡션 입력칸(선택).
  - **표시/숨김 토글**(`enabled`). off면 미리보기·내보내기에서 제외되되 URL은 유지.
- 위치: 기존 dnd-kit 순서변경 그대로. 신규 추가는 기존 패턴대로 맨 끝 삽입 후 드래그로 이동.
- `createEmptySection('youtube', order)` → `{ url:'', videoId:'', aspect:'horizontal', enabled:true }`.

## 5. 렌더링 (`section-renderer.ts` + `render/route.ts`)

`/api/detail-page/render`에 **`mode?: 'preview' | 'export'`** 파라미터 추가(기본 `'export'`). `renderSection`/`renderYoutube`로 mode 전달.

### 5.1 `renderYoutube(content, mode, colors, theme)`
- `enabled === false` 또는 `videoId` 없음 → `''` 반환(렌더 제외).
- **`mode: 'preview'`** — 실제 `<iframe src="https://www.youtube.com/embed/<id>">`.
  - `aspect: 'vertical'` → 9:16 컨테이너(중앙 정렬, max-width 제한), `horizontal` → 16:9.
  - 캡션은 하단 중앙 작은 텍스트.
- **`mode: 'export'`** — `<img src="<합성 썸네일 호스팅 URL>">`를 `<a href="<원본 url>">`로 감쌈(링크는 best-effort). 캡션 하단 표시.
  - 합성 썸네일이 없으면(아직 미생성) 안내 플레이스홀더 또는 소프트 폴백.

### 5.2 썸네일 합성 유틸 (신규)
- 입력: `videoId`, `aspect`.
- 유튜브 썸네일 fetch: `https://img.youtube.com/vi/<id>/maxresdefault.jpg` → 실패 시 `hqdefault.jpg` 폴백.
- **Sharp로 빨간 재생버튼(Shorts는 Shorts형, 일반은 원형 ▶)을 중앙에 합성** → 단일 JPG/PNG.
- **Supabase Storage에 업로드** → 공개 호스팅 URL 반환(기존 이미지 업로드 파이프라인·인증 헤더 규칙 재사용).
- 합성 시점: 내보내기(export) HTML 생성 직전. 결과 URL을 섹션 content에 캐시해도 좋으나(선택), MVP는 export 렌더 시 생성/캐시.

### 5.3 `render/route.ts`
- 최상위 섹션 타입 zod enum에 `'youtube'` 추가.
- `mode` 파라미터 수용 + `renderSection` 호출부에 전달.
- `sanitizeProLayout`은 `claude_layout`만 정화하므로 youtube 섹션은 그대로 통과.

### 5.4 `DetailMakerClient.tsx`
- 미리보기용 render 호출 → `mode: 'preview'`.
- 복사/다운로드용 render 호출 → `mode: 'export'`.

## 6. 저장 / 나중에 추가 (기존 인프라 재사용)

- `detail_page_drafts`(`sections jsonb`, `theme jsonb`) + 자동저장이 이미 구현됨. 드래프트 스키마(`sections: z.array(z.record(...))`)가 제네릭이라 youtube 섹션도 그대로 영속화.
- **완성 후 나중에 유튜브 추가**: 저장된 드래프트 재오픈 → 섹션 추가 → 재-내보내기. 신규 저장 코드 불필요.
- 유일한 저장 경로 변경: `render/route.ts` enum에 `youtube` 추가(위 5.3). draft route는 변경 없음.

## 7. 컴포넌트 경계 / 테스트 단위

- **URL 파서** (`parseYoutubeUrl(url) → { videoId, aspect } | null`): 순수 함수, 형식별 단위 테스트.
- **`renderYoutube`**: mode별(preview iframe / export img+a), enabled=false, videoId 없음, aspect별 스냅샷.
- **썸네일 합성 유틸**: videoId → 합성 이미지 버퍼 생성(폴백 경로 포함) 단위 테스트(네트워크는 목).
- **createEmptySection('youtube')**: 기본값 단위 테스트.
- **render route**: mode 파라미터 스키마 + youtube enum 통과 테스트.

## 8. 에러 처리

- URL 파싱 실패 → 섹션 카드에 인라인 안내, 렌더는 빈 문자열(페이지 깨짐 방지).
- 유튜브 썸네일 fetch 실패(maxres 없음) → hqdefault 폴백. 둘 다 실패 → 내보내기에서 해당 섹션 소프트 스킵 + 사용자 경고.
- Supabase 업로드 실패 → 경고 반환, 내보내기 진행(해당 섹션만 제외).

## 9. Out of Scope

- 마켓플레이스 네이티브 동영상 컴포넌트(스마트스토어 동영상 블록, 쿠팡 영상 업로드) 연동 — 붙여넣기 HTML 범위 밖.
- 실제 인-페이지 재생을 마켓에서 강제하는 시도(iframe은 제거됨).
- 유튜브 외 영상 플랫폼(네이버TV·비메오 등) — 후속.
- AI 자동 유튜브 추천/삽입 — 사용자가 URL 직접 입력.

## 10. 확정된 결정 요약

| 항목 | 결정 |
|---|---|
| 목적지 | 쿠팡/스마트스토어 붙여넣기 |
| 재생 방식 | 에디터 미리보기=iframe 재생 / 내보내기=재생버튼 합성 썸네일+링크 |
| on/off | 섹션별 표시/숨김 토글(`enabled`) |
| 저장 | 기존 `detail_page_drafts` 자동저장 재사용 |
| 섹션 위치 | 최상위 `SectionType: 'youtube'`, 드래그로 이동 |
| 비율 | Shorts=세로 9:16 / 일반=가로 16:9, URL 자동 추정 + 수동 전환 |
