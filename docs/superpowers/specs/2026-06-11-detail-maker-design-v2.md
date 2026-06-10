# 상품상세 자동만들기 — 설계 문서 v2

**날짜:** 2026-06-11  
**이전 스펙 폐기 이유:** Fabric.js 미설치 + DetailPageEditor 기존 존재 확인 후 전면 재설계  
**진입 URL:** `/listing/detail-maker`

---

## 1. 목표

기존 `AssetsTab`에 숨어 있는 AI 상세페이지 생성·편집 기능을 독립 페이지로 꺼내어, 초보 판매자가 **상품명 + 이미지 3장**만으로 고품질 상세페이지를 1분 내에 만들 수 있도록 UX를 단순화한다.

---

## 2. 핵심 원칙

**새로 만드는 것 최소화. 기존 코드 최대 재사용.**

| 기능 | 기존 코드 | 처리 |
|------|-----------|------|
| AI 상세페이지 생성 | `/api/ai/generate-detail-html` | 재사용 |
| 섹션 편집 (텍스트·이미지·이동·삭제·AI재생성) | `DetailPageEditor.tsx` | 재사용 |
| 이미지 업로드 | `/api/listing/upload-image` | 재사용 |
| HTML 다운로드 | `AssetsResultPanel.tsx` 패턴 | 패턴 재사용 |
| 테마 변경 | `ThemeBar.tsx` (DetailPageEditor 내장) | 재사용 |
| 새로 만드는 것 | 입력 폼 UI, 페이지 레이아웃, 라우트, 에셋 라이브러리(Phase 3) | 신규 |

---

## 3. 구현 범위 (2 Phase)

| Phase | 내용 |
|-------|------|
| 1 | 새 라우트 + 입력 폼 + AI 생성 → DetailPageEditor 연결 + HTML 다운로드 |
| 2 | 에셋 라이브러리 — 이커머스 SVG 아이콘 검색 → 섹션에 삽입 |

> Phase 2(에셋 라이브러리)는 `DetailPageEditor`의 섹션 편집 안에 자연스럽게 통합.

---

## 4. 레이아웃

**2패널 레이아웃** (2패널 확정)

```
┌──────────────────────────────────────────────────────────────────┐
│  ← 상품등록     상품상세 자동만들기              [HTML 다운로드]  │
├─────────────────────┬────────────────────────────────────────────┤
│  좌측 패널 (300px)   │  우측 메인 (가변폭, 스크롤)                 │
│                     │                                             │
│  [생성 전]           │  빈 상태 안내                              │
│  ─────────────────  │  "상품 정보를 입력하고 생성해보세요"          │
│  상품명 *           │                                             │
│  [입력창]            │  ─────────────────────────────────────────  │
│                     │                                             │
│  참고 이미지 * (3장) │  [생성 후]                                 │
│  [업로드 영역]       │  ┌──────────────────────────────────────┐  │
│                     │  │  DetailPageEditor (기존 컴포넌트)      │  │
│  브랜드명           │  │  - 섹션 목록 + 드래그 재배열           │  │
│  [입력창]            │  │  - 인라인 텍스트 편집                  │  │
│                     │  │  - 이미지 교체 (SectionImageAttachment)│  │
│  옵션               │  │  - 섹션 추가/삭제                      │  │
│  [색상/수량/없음]    │  │  - AI 섹션 재생성                      │  │
│                     │  │  - 테마 변경 (ThemeBar)                │  │
│  [✨ AI 생성] 버튼   │  └──────────────────────────────────────┘  │
│                     │                                             │
│  [생성 후]           │                                             │
│  ─────────────────  │                                             │
│  테마 선택           │                                             │
│  섹션 추가           │                                             │
│  에셋 라이브러리(P2) │                                             │
└─────────────────────┴────────────────────────────────────────────┘
```

---

## 5. 신규 파일 (최소화)

```
src/app/listing/detail-maker/
  page.tsx        — 서버 컴포넌트, metadata
  layout.tsx      — AppShell 감싸기

src/components/detail-maker/
  DetailMakerClient.tsx   — 메인 클라이언트: 생성 전/후 상태 분기
  DetailMakerInputPanel.tsx — 좌측 입력 폼 (상품명·이미지·브랜드·옵션)
```

> `DetailPageEditor`, `ThemeBar`, `SectionImageAttachment` 등 기존 컴포넌트는 **import해서 그대로 사용**.

---

## 6. 상태 관리

별도 store 없음. `DetailMakerClient` 내부 `useState`로 충분:

```typescript
// DetailMakerClient 내부 state
const [phase, setPhase] = useState<'input' | 'editor'>('input')
const [sections, setSections] = useState<DetailSection[]>([])
const [theme, setTheme] = useState<DetailPageTheme>(DEFAULT_THEME)
const [generatedHtml, setGeneratedHtml] = useState<string>('')
const [isGenerating, setIsGenerating] = useState(false)
const [error, setError] = useState<string | null>(null)
```

---

## 7. AI 생성 파이프라인

### 입력 (DetailMakerInputPanel)
| 필드 | 타입 | 필수 | 비고 |
|------|------|------|------|
| 상품명 | text | ✓ | |
| 참고 이미지 | file upload | ✓ (1~3장) | File → `/api/listing/upload-image` → URL |
| 브랜드명 | text | 선택 | 상품명에 prefix로 포함 |
| 옵션 카테고리 | select | 선택 | 생성 후 옵션 섹션 수동 편집으로 처리 |

### 이미지 업로드 흐름
```
File 선택 → /api/listing/upload-image (multipart) → Supabase URL 반환
→ imageUrls[] 에 추가 → 최대 3개 표시
```
base64 직접 전송 금지 (Vercel 4.5MB body 한계 — 기존 AssetsInputPanel 주석 참조)

### API 호출
```typescript
POST /api/ai/generate-detail-html
{
  imageUrls: string[],        // 업로드된 Supabase URL 1~3개
  studioMode: true,
  productName: string,        // 브랜드명 포함: "나이키 에어맥스 런닝화"
}
```

**브랜드명/옵션 처리:** 브랜드명은 `productName`에 포함. 옵션 카테고리는 생성 후 사용자가 `spec_table` 섹션을 직접 편집.  
별도 파라미터 추가 없음 → API 수정 불필요.

### 응답 처리
```typescript
// 기존 AssetsResultPanel.tsx 패턴 그대로
const { html, content } = await res.json()
const sections = contentToSections(content)   // section-parser.ts
setGeneratedHtml(html)
setSections(sections)
setPhase('editor')
```

---

## 8. 다운로드

`DetailPageEditor`의 `onDownload` prop에 연결:

```typescript
// AssetsResultPanel.tsx:647 패턴 그대로
const handleDownload = () => {
  const blob = new Blob([generatedHtml], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'detail-page.html'
  a.click()
  URL.revokeObjectURL(url)
}
```

> HTML 파일 다운로드가 기본. 추후 JPEG 이미지 다운로드 필요 시 `html-to-image`(기존 설치됨) 추가.

---

## 9. 네비게이션

`AppShell.tsx` `NAV_ITEMS`의 "상품등록" children에 추가:

```typescript
{
  href: '/listing/detail-maker',
  label: '상품상세 자동만들기',
  icon: <DocumentIcon />,
}
```

---

## 10. 에셋 라이브러리 (Phase 2)

`src/data/detail-maker-assets.json` — SVG 아이콘 30개 (이커머스 전용)

```json
[
  { "id": "rocket", "keywords": ["로켓배송","빠른배송"], "svg": "..." },
  { "id": "free-return", "keywords": ["무료반품","반품"], "svg": "..." }
]
```

- `DetailMakerInputPanel` 하단 "요소" 탭에서 키워드 검색
- 선택 → 현재 활성 섹션의 `attachedImages`에 SVG data URL로 추가
- `section-renderer.ts`가 렌더링 시 포함

---

## 11. 오류 처리

| 상황 | 처리 |
|------|------|
| 이미지 업로드 실패 | 해당 이미지 제거 + 인라인 에러 메시지 |
| AI 생성 실패 (5xx) | "생성 실패" 배너 + 재시도 버튼 |
| 인증 오류 (401) | 로그인 페이지로 리다이렉트 |
| Rate limit (429) | "잠시 후 다시 시도" 안내 |
| content 파싱 실패 | HTML 미리보기는 표시, 섹션 편집만 비활성화 |

---

## 12. 테스트

- `DetailMakerInputPanel`: 필수 필드 미입력 시 생성 버튼 비활성화
- 이미지 업로드 → URL 배열 업데이트
- AI 생성 → `phase === 'editor'` 전환 + `sections` 비어 있지 않음
- 다운로드 → `<a>` 클릭 트리거 확인
