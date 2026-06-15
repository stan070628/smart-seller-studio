# 상품상세 자동만들기 — AI 썸네일 만들기 설계

작성일: 2026-06-15
대상 화면: `/listing/detail-maker` (DetailMakerClient)

## 배경 / 목표

"상품상세 자동만들기"(detail-maker) 화면에서 상세페이지뿐 아니라 **AI 썸네일(쿠팡 대표이미지)** 도 만들 수 있게 한다. 썸네일 생성 기능은 기존에 상품등록 대시보드의 자산(Assets) 탭(`ThumbnailGeneratePanel`)과 에디터(`ThumbnailGenerateSection`)에만 있었고, detail-maker에는 없었다.

detail-maker는 참고 이미지를 `/api/listing/upload-image`로 올려 **Supabase URL 배열(`uploadedUrls`, 최대 6장)** 로 보유한다. 이는 `generate-thumbnail`의 `refImageUrls`(URL 기반) 입력과 정확히 호환되므로, 이미 올린 참고 이미지를 그대로 썸네일 참고로 재사용한다.

## 핵심 결정

- 배치: **좌측 입력 패널 하단에 썸네일 생성 섹션 + 우측 결과 갤러리** (탭/모달 신설 없음)
- 참고 이미지: 이미 업로드된 `uploadedUrls`(최대 3장) 재사용. 별도 업로드 없음.
- 쿠팡 규격: **생성 시점에 자동 적용**(생성 직후 `coupang-resize`로 1000²+ 변환하여 저장).
- 활용: 다운로드 + 갤러리 관리(개별 삭제) + **AI 수정**.
- 백엔드: **신규 API 없음.** 기존 4개 라우트를 조합한다.

## 재사용 API (신규 백엔드 0)

| API | 요청 | 응답 | 역할 |
|---|---|---|---|
| `POST /api/ai/generate-thumbnail` | `{ refImageUrls, direction }` | `{ success, data: { imageBase64, mimeType } }` | 780² 썸네일 생성 |
| `POST /api/image/upload-ai` | `{ imageBase64, mimeType }` | `{ success, url }` | Supabase 영속화 |
| `POST /api/image/coupang-resize` | `{ imageUrl }` | `{ url }` | 쿠팡 규격(최소 1000px) 리사이즈 |
| `POST /api/ai/edit-thumbnail` | `{ imageUrl, prompt }` | `{ success, data: { editedUrl } }` | AI 수정 + 쿠팡 1200² 후처리 내장 |

## 신규 컴포넌트

### 1. `DetailMakerThumbnailPanel`
경로: `src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx`

좌측 `DetailMakerInputPanel`의 스크롤 영역 하단, **무드 브리프(CreativeBriefPanel) 아래**에 배치되는 섹션. 하단 고정된 "✨ AI 상세페이지 생성" 버튼과는 독립된 별개 섹션이며 자체 생성 버튼을 가진다.

Props:
```ts
interface Props {
  refImageUrls: string[];      // uploadedUrls (패널 내부에서 slice(0,3))
  isGenerating: boolean;       // 썸네일 생성 진행 중
  error: string | null;
  onGenerate: (direction: string) => void;
}
```

UI (자산 탭 `ThumbnailGeneratePanel`과 동일 패턴):
- 상단 라벨 "AI 썸네일 생성"
- 참조 상태 배지: `참조 사진 N장 준비됨` / `참고 이미지를 먼저 업로드하세요`
- 연출 방향 textarea + 예시 칩 4개
- "✨ AI 썸네일 생성" 버튼 (참조 ≥1장 && direction ≥5자일 때 활성)

### 2. `DetailMakerThumbnailGallery`
경로: `src/components/listing/detail-maker/DetailMakerThumbnailGallery.tsx`

우측 결과 영역 상단에 표시되는 썸네일 그리드.

Props:
```ts
interface Props {
  thumbnails: string[];                       // 생성된 썸네일 URL
  editingUrl: string | null;                  // AI 수정 진행 중인 항목
  onDownload: (url: string) => void;
  onRemove: (url: string) => void;
  onEdit: (url: string, prompt: string) => void;
}
```

각 그리드 항목:
- 썸네일 이미지(1:1)
- hover/하단에 액션: 다운로드 / 삭제 / ✨AI 수정
- AI 수정 클릭 → 인라인 프롬프트 입력 → 확정 시 `onEdit(url, prompt)`

## 상태 (DetailMakerClient)

기존 로컬 useState 패턴을 따라 추가:
```ts
const [generatedThumbnails, setGeneratedThumbnails] = useState<string[]>([]);
const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
const [editingThumbnailUrl, setEditingThumbnailUrl] = useState<string | null>(null);
const [thumbnailError, setThumbnailError] = useState<string | null>(null);
```

핸들러:
- `handleGenerateThumbnail(direction)`:
  1. `generate-thumbnail` ({ refImageUrls: uploadedUrls.slice(0,3), direction })
  2. `upload-ai` ({ imageBase64, mimeType }) → tempUrl
  3. `coupang-resize` ({ imageUrl: tempUrl }) → finalUrl (실패 시 tempUrl 폴백)
  4. `setGeneratedThumbnails(prev => [...prev, finalUrl])`
- `handleEditThumbnail(url, prompt)`:
  1. `setEditingThumbnailUrl(url)`
  2. `edit-thumbnail` ({ imageUrl: url, prompt }) → editedUrl
  3. 해당 url을 editedUrl로 교체
  4. `finally` → `setEditingThumbnailUrl(null)`
- `handleRemoveThumbnail(url)`: 배열에서 제거 (클라이언트 state만; 스토리지 삭제 안 함)
- `handleDownloadThumbnail(url)`: fetch → blob → `<a download>` (CORS-safe)

## 레이아웃 변경 (DetailMakerClient 우측)

현재 우측: `sections.length > 0 ? <DetailPageEditor/> : <EmptyState/>`

변경 후 우측(세로 스택):
```
<div column>
  {generatedThumbnails.length > 0 && <DetailMakerThumbnailGallery .../>}
  {sections.length > 0 ? <DetailPageEditor/> : <EmptyState/>}
</div>
```
썸네일 갤러리는 생성된 항목이 있을 때만 우측 상단에 나타난다. 상세페이지 유무와 독립적이다.

## 에러 처리

- 참조 이미지 0장: 생성 버튼 비활성 + 안내 문구
- `generate-thumbnail` 실패(429/503/그 외): 응답 `error` 문구를 `thumbnailError`에 표시
- `coupang-resize` 실패: 치명적 아님 → 리사이즈 전 `tempUrl`로 폴백하고 콘솔 경고
- `edit-thumbnail` 실패: 해당 항목 유지 + 에러 토스트/문구, 버튼 재활성

## 테스트

- `DetailMakerThumbnailPanel`: 참조 0장이면 버튼 비활성 / direction <5자 비활성 / 정상 입력 시 onGenerate 호출
- `DetailMakerThumbnailGallery`: 항목 렌더, 다운로드/삭제/수정 콜백 호출, editingUrl일 때 로딩 표시
- `DetailMakerClient` 생성 흐름(통합): generate→upload→coupang-resize 순서로 호출되고 갤러리에 finalUrl append (fetch mock)
- coupang-resize 실패 시 tempUrl 폴백 검증

## 범위 밖 (YAGNI)

- 생성 썸네일을 상세페이지 hero 섹션에 자동 삽입
- 썸네일 전용 별도 메뉴/라우트 신설
- 썸네일 Supabase 스토리지에서의 물리 삭제(갤러리 삭제는 클라이언트 state만)
- 자산 탭 `ThumbnailGeneratePanel`과의 컴포넌트 통합 리팩터링(별개 작업)
