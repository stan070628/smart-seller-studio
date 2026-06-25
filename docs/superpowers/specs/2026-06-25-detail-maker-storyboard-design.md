# Detail Maker 스토리라인 씬 기획 (2단계 생성 흐름)

**날짜:** 2026-06-25
**상태:** 확정

---

## 목적

AI 씬 이미지 생성 전에 Claude가 씬별 스토리라인(제목 + 설명 + Gemini 프롬프트)을 먼저 제시하고, 사용자가 씬 추가/삭제/순서 변경·프롬프트 수정·소스 이미지 배정 후 생성을 실행하는 2단계 흐름으로 전환한다.

현재 문제: 모든 씬이 같은 uploadedUrls[0] 기반으로 일괄 생성되어 결과가 단조롭고, 사용자가 원하는 씬을 추가할 수 없다.

---

## UX 흐름

```
[기존] 상품 정보 입력 → "AI 상세페이지 생성" 클릭 → HTML + 씬 이미지 일괄 생성

[신규]
① 상품 정보 입력 → "스토리라인 구성" 클릭
   ↓ Claude가 씬 기획 생성 (스피너)
   ↓ StoryboardEditor 패널 표시
② 사용자 편집:
   - 씬 제목 / 설명 수정
   - Gemini 프롬프트 직접 편집
   - 씬별 소스 이미지 배정 (uploadedUrls 중 선택)
   - 씬 추가 / 삭제 / 드래그 순서 변경
   - 씬별 모드 설정 (AI 생성 / 클린업) ← Spec B 연계
③ "씬 이미지 생성" 클릭 → 씬별 프롬프트 + 배정 이미지로 Gemini 생성
   (HTML 생성은 기존과 동일하게 병행)
```

---

## 아키텍처

### 신규 API — `POST /api/ai/plan-scene-images`

Claude가 상품 정보를 분석해 씬 스토리라인을 반환한다.

**Request:**
```ts
{
  productName: string;
  brandName?: string;
  category: string;
  productImageUrls: string[];   // 업로드된 이미지 URL 목록
  referenceText?: string;
  sceneCount?: number;           // 기본 4, 최대 8
}
```

**Response:**
```ts
{
  scenes: Array<{
    title: string;           // 씬 제목 (예: "제품 전면 클로즈업")
    description: string;     // 한 줄 설명 (한국어)
    prompt: string;          // Gemini 프롬프트 (영문)
    suggestedImageIndex: number;  // 추천 소스 이미지 인덱스 (0-based)
  }>;
}
```

**Claude 시스템 프롬프트 핵심:**
- 상품 카테고리·이미지 수·referenceText를 참고해 다양한 씬 구성 (클로즈업, 라이프스타일, 기능 강조, 감성 등)
- 각 씬의 Gemini 프롬프트는 기존 `SCENE_PROMPT_SYSTEM`과 동일 포맷 유지
- suggestedImageIndex: 씬 성격에 맞는 이미지를 추천 (정면샷→0, 착용샷→1 등)

**callClaude 활용:** 텍스트 생성이므로 `callClaude(system, user, 'sonnet', 2048)` 사용, JSON 파싱.

---

### 신규 컴포넌트 — `StoryboardEditor.tsx`

`src/components/listing/detail-maker/StoryboardEditor.tsx`

**Props:**
```ts
interface StoryboardEditorProps {
  scenes: SceneStoryboardItem[];
  uploadedUrls: string[];
  onScenesChange: (scenes: SceneStoryboardItem[]) => void;
  onGenerate: () => void;
  isGenerating: boolean;
}
```

**SceneStoryboardItem 타입:**
```ts
interface SceneStoryboardItem {
  id: string;           // nanoid 생성
  title: string;
  description: string;
  prompt: string;
  sourceImageIndex: number;   // uploadedUrls[sourceImageIndex]
  mode: 'ai' | 'cleanup';     // Spec B 연계
}
```

**UI 구성:**
- 씬 카드 목록 (드래그 순서 변경 — `@dnd-kit/sortable` 또는 단순 swap 버튼)
- 각 카드: 제목 input + 설명 input + prompt textarea + 소스 이미지 선택(썸네일 그리드) + 모드 뱃지 + 삭제 버튼
- "씬 추가" 버튼: 빈 카드 append (기본값: title="새 씬", prompt 비움, 사용자가 직접 작성)
- 하단 "② 씬 이미지 생성" 버튼

**드래그 구현:** `@dnd-kit/sortable`가 이미 설치돼 있으면 사용, 없으면 up/down 버튼으로 단순 swap.

---

### 수정 파일

#### `DetailMakerClient.tsx`

**상태 추가:**
```ts
const [storyboard, setStoryboard] = useState<SceneStoryboardItem[] | null>(null);
const [isGeneratingStoryboard, setIsGeneratingStoryboard] = useState(false);
const [storyboardError, setStoryboardError] = useState<string | null>(null);
```

**버튼 변경:**
- 기존 "AI 상세페이지 생성" 단일 버튼 →
  - storyboard가 null: "스토리라인 구성" 버튼
  - storyboard가 있고 HTML 없음: StoryboardEditor 표시 + "씬 이미지 생성" 버튼
  - HTML 생성 후: 기존 미리보기 + 씬 카드

**`handlePlanStoryboard()`:**
```ts
async function handlePlanStoryboard() {
  setIsGeneratingStoryboard(true);
  setStoryboardError(null);
  try {
    const res = await fetch('/api/ai/plan-scene-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productName, brandName, category,
        productImageUrls: uploadedUrls,
        referenceText,
        sceneCount: 4,
      }),
    });
    const data = await res.json();
    if (!data.scenes) throw new Error(data.error ?? '스토리라인 생성 실패');
    setStoryboard(data.scenes.map((s: PlanScene) => ({
      ...s, id: crypto.randomUUID(), mode: 'ai' as const,
    })));
  } catch (e) {
    setStoryboardError(e instanceof Error ? e.message : '오류가 발생했습니다.');
  } finally {
    setIsGeneratingStoryboard(false);
  }
}
```

**`handleGenerate()` 변경 (씬 생성 부분):**

기존: `generateSceneImages(uploadedUrls, sections, ...)`

신규: `generateSceneImages(storyboard, uploadedUrls, sections, ...)`

- 씬별로 `storyboard[i].sourceImageIndex`에서 소스 이미지 선택
- `storyboard[i].prompt`를 `sceneHint`로 전달
- mode === 'cleanup'인 씬은 generate-scene-image 대신 cleanup-product-image API 호출 (Spec B)

**HTML 생성 타이밍:** "스토리라인 구성" 버튼 클릭 시 HTML 생성과 스토리라인 API를 **병렬** 호출. 스토리라인이 먼저 끝나면 에디터 표시, HTML은 백그라운드 계속 진행.

---

### `generateSceneImages` 함수 시그니처 변경

```ts
// Before
generateSceneImages(uploadedUrls: string[], sections: DetailSection[], ...)

// After
generateSceneImages(
  storyboard: SceneStoryboardItem[] | null,
  uploadedUrls: string[],
  sections: DetailSection[],
  ...
)
```

storyboard가 null이면 기존 동작 유지 (하위호환).

씬과 storyboard 매핑: `sections[i]` → `storyboard[i]` (인덱스 기준).
- storyboard 길이 > sections 길이: 추가 씬은 이미지만 생성 (HTML 섹션 없음)
- storyboard 길이 < sections 길이: 남은 sections는 uploadedUrls[0] + 기본 프롬프트로 폴백 (기존 동작)

---

## 엣지케이스

| 케이스 | 처리 |
|---|---|
| plan-scene-images API 실패 | 에러 배너 표시, 재시도 버튼 |
| storyboard 씬 수 > sections 수 | 추가 씬은 씬 이미지만 생성 (HTML 섹션 없음) |
| sourceImageIndex 범위 초과 | uploadedUrls[0]로 폴백 |
| prompt 비어 있는 씬 | 해당 씬 제목+설명을 sceneHint로 대체 |
| 씬 이미지 생성 실패 (개별) | 해당 슬롯만 에러 표시, 나머지 씬 계속 진행 |
| HTML 생성 지연 중 씬 이미지 먼저 완료 | 씬 이미지 미리보기 먼저 표시, HTML 완료 시 자동 합류 |

---

## 테스트

- `StoryboardEditor`: 씬 추가/삭제, 제목 수정 → onScenesChange 호출, 소스 이미지 선택
- `plan-scene-images` route: 정상 응답 파싱, Claude 에러 핸들링
- `DetailMakerClient`: handlePlanStoryboard 성공 → storyboard 상태, 실패 → 에러 표시
- `generateSceneImages`: storyboard 있을 때 sourceImageIndex 적용 확인

---

## 변경 파일 요약

| 파일 | 종류 |
|---|---|
| `src/app/api/ai/plan-scene-images/route.ts` | 신규 |
| `src/components/listing/detail-maker/StoryboardEditor.tsx` | 신규 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 수정 |
| `src/types/detail-page.ts` | `SceneStoryboardItem` 타입 추가 |
