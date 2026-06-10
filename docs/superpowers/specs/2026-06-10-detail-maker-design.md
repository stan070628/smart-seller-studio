# 상품상세 자동만들기 — 설계 문서

**날짜:** 2026-06-10  
**위치:** 상품등록 > 상품상세 자동만들기  
**진입 URL:** `/listing/detail-maker`

---

## 1. 목표

포토샵 등 디자인 툴을 모르는 초보 판매자가 상품명·이미지 3장·브랜드명만으로 1분 내에 고품질 상세페이지를 만들고 편집할 수 있는 WYSIWYG 에디터.

---

## 2. 구현 범위 (3 Phase)

| Phase | 내용 |
|-------|------|
| 1 | AI 입력 폼 → 섹션 생성 → Fabric.js 캔버스 렌더링 → JPEG 다운로드 |
| 2 | 텍스트 인라인 편집(IText) · 이미지 교체 · 섹션 이동/삭제 · Ctrl+Z |
| 3 | 에셋 라이브러리 — 이커머스 SVG 아이콘 검색 → 캔버스 드롭 |

크레딧 시스템(과금)은 이번 구현에서 제외.

---

## 3. 레이아웃

**2패널 풀스크린 레이아웃** (기존 `/editor`의 3패널과 다름)

```
┌──────────────────────────────────────────────────────────────────┐
│  헤더: 상품상세 자동만들기                    [전체 다운로드 버튼]  │
├─────────────────────┬────────────────────────────────────────────┤
│  좌측 패널 (280px)   │  우측 메인 (가변폭, 스크롤)                 │
│                     │                                             │
│  [생성 전]           │  ① 생성 전: 빈 상태 안내                   │
│  • 입력 폼           │  ② 생성 후: 섹션 캔버스 스택               │
│    - 상품명          │     ┌─ 섹션 1 (인트로) ──────────────────┐  │
│    - 이미지 3장      │     │  [Fabric.js Canvas 900px]          │  │
│    - 브랜드명        │     │                        [↑][↓][🗑]  │  │
│    - 옵션 카테고리   │     └────────────────────────────────────┘  │
│  • [✨ AI 생성] 버튼  │     ┌─ 섹션 2 (소구점) ───────────────────┐  │
│                     │     │  [Fabric.js Canvas 900px]          │  │
│  [생성 후]           │     └────────────────────────────────────┘  │
│  • 텍스트 추가        │     ┌─ 섹션 3 ... ───────────────────────┐  │
│  • 요소 검색 (P3)    │     └────────────────────────────────────┘  │
│  • 이미지 업로드      │                                             │
│  • 배경색 설정        │                                             │
└─────────────────────┴────────────────────────────────────────────┘
```

---

## 4. 신규 파일 목록

### App Router
```
src/app/listing/detail-maker/
  page.tsx        — 서버 컴포넌트, metadata 설정
  layout.tsx      — AppShell 감싸기
```

### 컴포넌트
```
src/components/detail-maker/
  DetailMakerClient.tsx   — 메인 클라이언트 컴포넌트, 생성 전/후 상태 분기
  InputPanel.tsx          — 좌측: 입력 폼 (생성 전)
  ToolPanel.tsx           — 좌측: 도구 패널 (생성 후)
  SectionList.tsx         — 우측: 섹션 스택 컨테이너
  SectionCanvas.tsx       — 섹션 하나의 Fabric.js 캔버스 + 이동/삭제 버튼
  AssetLibrary.tsx        — SVG 아이콘 검색 패널 (Phase 3)
```

### 상태 관리
```
src/store/useDetailMakerStore.ts
  sections: DetailSection[]   — 섹션 배열 (순서 = 렌더링 순서)
  history: Section[][]        — Ctrl+Z용 스냅샷 스택 (Phase 2)
  isGenerating: boolean
  error: string | null
```

### 비즈니스 로직
```
src/lib/detail-maker/
  section-to-fabric.ts    — Section 데이터 → fabric.Canvas 객체 초기화
  download-helper.ts      — 모든 섹션 canvas.toDataURL() → 세로 합성 → 다운로드
```

### 정적 데이터
```
src/data/detail-maker-assets.json
  — 이커머스 이커머스 전용 SVG 아이콘 30개
  — 키워드 배열 포함 (예: ["로켓배송", "무료배송", "빠른배송"])
```

### 네비게이션
```
src/components/AppShell.tsx
  — NAV_ITEMS["상품등록"].children에 추가:
    { href: '/listing/detail-maker', label: '상품상세 자동만들기' }
```

---

## 5. AI 생성 파이프라인

### 입력 (InputPanel)
| 필드 | 타입 | 필수 |
|------|------|------|
| 상품명 | text | ✓ |
| 참고 이미지 | file upload, 1~3장 | ✓ (최소 1장) |
| 브랜드명 | text | 선택 |
| 옵션 카테고리 | select (수량/색상/없음) | 선택 |

### 호출
기존 `/api/ai/generate-detail-html` 재사용 (`studioMode: true`).
신규 입력 필드(브랜드명, 옵션)는 요청 body에 추가 파라미터로 전달.

### 섹션 파싱
기존 `src/lib/detail-page/section-parser.ts`의 `contentToSections()` 재사용.  
반환: `DetailSection[]` (타입은 `src/types/detail-page.ts`의 `SectionType` 사용)

### Fabric 렌더링 (`section-to-fabric.ts`)
각 `DetailSection` → 하나의 `fabric.Canvas` 초기화:
- 캔버스 폭: **900px** 고정 (쇼핑몰 상세페이지 표준)
- 캔버스 높이: 섹션 타입별 기본값
- 텍스트: `fabric.IText` — 폰트/크기/색상/정렬 속성 포함
- 이미지: `fabric.Image.fromURL()` — 크기·위치 preset
- 배경: `canvas.setBackgroundColor()`

### 섹션 타입 (기존 SectionType 활용)
기존 `SectionType` enum을 그대로 사용. 각 타입별 캔버스 레이아웃:

| SectionType | 설명 | 기본 높이 |
|------------|------|---------|
| `hero` | 대형 이미지 + 헤드라인/서브헤드라인 | 600px |
| `selling_points` | 소구점 3개 + 아이콘 | 500px |
| `features` | 기능 목록 | 450px |
| `stats` | 숫자 강조 통계 | 350px |
| `spec_table` | 사이즈/스펙 표 | 가변 (행당 40px) |
| `usage_steps` | 사용 방법 단계 | 500px |
| `warning` | 주의사항 | 300px |
| `cta` | 배송/CS 안내 + CTA | 350px |

---

## 6. 섹션 편집 (Phase 2)

### 텍스트 편집
- `SectionCanvas` 위에서 텍스트 오브젝트 더블클릭 → `fabric.IText` 편집 모드 진입
- 폰트 종류·크기·굵기·색상·정렬: `ToolPanel`에서 선택 적용

### 이미지 교체
- 이미지 오브젝트 클릭 → `ToolPanel`에 교체 버튼 노출
- "기존 에셋에서 선택" (sharedDraft.thumbnailImages) 또는 "PC에서 업로드" (`/api/listing/upload-image`)

### 섹션 관리
- `SectionCanvas` 우측 상단: ↑ / ↓ / 🗑 버튼
- ↑↓: `useDetailMakerStore`에서 배열 인덱스 스왑
- 🗑: 배열에서 제거 (히스토리에 스냅샷 저장)

### Ctrl+Z (히스토리)
- 섹션 배열 변경 전 `history`에 스냅샷 push
- `Ctrl+Z` 이벤트: `history.pop()` → `sections` 복원
- 최대 20단계 보존

---

## 7. 다운로드

각 `SectionCanvas`의 `canvas.toDataURL('image/jpeg', 0.92)` 호출 → base64 이미지 배열 수집 → 브라우저에서 `<canvas>` API로 세로 합성 → `<a download>` 트리거.  
서버 의존 없이 클라이언트 사이드에서 처리.

---

## 8. 에셋 라이브러리 (Phase 3)

`src/data/detail-maker-assets.json` 구조:
```json
[
  {
    "id": "rocket-delivery",
    "keywords": ["로켓배송", "배송", "빠른"],
    "svg": "<svg>...</svg>"
  }
]
```

- `ToolPanel`의 "요소 검색" 입력 → 키워드 필터링 → SVG 썸네일 그리드 노출
- 클릭 → 현재 포커스된 `SectionCanvas`에 `fabric.loadSVGFromString()` 으로 삽입

---

## 9. 오류 처리

| 상황 | 처리 |
|------|------|
| AI 생성 실패 | 에러 메시지 + 재시도 버튼 |
| 이미지 업로드 실패 | toast 알림, 기존 이미지 유지 |
| Fabric 로드 실패 | 섹션 스킵, 나머지 계속 렌더링 |
| 다운로드 중 캔버스 오류 | 해당 섹션만 빈 이미지 처리 |

---

## 10. 테스트 전략

- `section-to-fabric.ts`: 각 섹션 타입별 캔버스 오브젝트 수 검증 (단위 테스트)
- `download-helper.ts`: 세로 합성 결과 이미지 크기 검증
- `InputPanel`: 필수 필드 검증 + 이미지 개수 제한 동작
- E2E: AI 생성 → 다운로드 전체 흐름 (Playwright, 선택)
