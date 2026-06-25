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
   ↓ Claude가 씬 기획 생성 (스피너) + HTML 생성 병렬 시작
   ↓ StoryboardEditor 패널 표시 (HTML 생성은 백그라운드 계속)
② 사용자 편집:
   - 씬 제목 / 설명 수정
   - Gemini 프롬프트 직접 편집
   - 씬별 소스 이미지 배정 (uploadedUrls 중 선택)
   - 씬 추가 / 삭제 / 드래그 순서 변경
   - 씬별 모드 설정 (AI 생성 / 클린업) ← Spec B 연계
③ "씬 이미지 생성" 클릭 (HTML 생성 완료 후에만 활성화)
   → sections 파싱 완료된 상태에서 씬별 프롬프트 + 배정 이미지로 Gemini 생성

버튼 상태 분기:
  - storyboard === null, HTML 없음: "스토리라인 구성" 버튼
  - isGeneratingStoryboard || isGenerating: 스피너 표시
  - storyboard 있음, HTML 생성 중: StoryboardEditor 표시 + "씬 이미지 생성" 버튼 disabled
  - storyboard 있음, HTML 완료 (sections 파싱됨): StoryboardEditor + "씬 이미지 생성" 버튼 활성화
  - 씬 이미지 생성 완료: 기존 미리보기 + 씬 카드 (StoryboardEditor 접힘)
```

---

## 아키텍처

### 신규 API — `POST /api/ai/plan-scene-images`

Claude가 상품 정보를 분석해 씬 스토리라인을 반환한다.

**중요:** `callClaude()`는 텍스트 전용(vision 미지원). 이 API는 이미지 내용을 분석하지 않고 상품명·카테고리·이미지 개수·referenceText만으로 씬을 기획한다. 이미지는 suggestedImageIndex 추천에만 활용 (개수 기준).

**Request:**
```ts
{
  productName: string;
  brandName?: string;
  category: string;
  imageCount: number;        // uploadedUrls.length (이미지 개수만 전달)
  referenceText?: string;
  sceneCount?: number;       // 기본 4, 최대 8
}
```

**Response:**
```ts
{
  scenes: Array<{
    title: string;                // 씬 제목 (예: "제품 전면 클로즈업")
    description: string;          // 한 줄 설명 (한국어)
    prompt: string;               // Gemini 프롬프트 (영문)
    suggestedImageIndex: number;  // 추천 소스 이미지 인덱스 (0-based, imageCount 범위 내)
  }>;
}
```

**Claude 시스템 프롬프트 핵심:**
- 상품 카테고리·imageCount·referenceText를 참고해 다양한 씬 구성 (클로즈업, 라이프스타일, 기능 강조, 감성 등)
- 각 씬의 Gemini 프롬프트는 기존 `SCENE_PROMPT_SYSTEM`과 동일 포맷 유지
- suggestedImageIndex: 씬 성격에 맞는 이미지 인덱스 추천 (imageCount-1 이하로 제한)
- JSON만 반환: `{"scenes": [...]}` (마크다운 코드블록 없이)

**응답 파싱:** Claude가 ` ```json ... ``` ` 블록으로 감싸 반환하는 경우를 대비해 route에서 strip 처리:
```ts
const raw = await callClaude(system, user, 'sonnet', 2048);
const json = raw.replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim();
const parsed = JSON.parse(json);
```

---

### 신규 컴포넌트 — `StoryboardEditor.tsx`

`src/components/listing/detail-maker/StoryboardEditor.tsx`

**Props:**
```ts
interface StoryboardEditorProps {
  scenes: SceneStoryboardItem[];
  uploadedUrls: string[];
  isHtmlReady: boolean;          // sections 파싱 완료 여부 → "씬 이미지 생성" 버튼 활성화
  isGeneratingScenes: boolean;
  onScenesChange: (scenes: SceneStoryboardItem[]) => void;
  onGenerate: () => void;
}
```

**SceneStoryboardItem 타입** (`src/types/detail-page.ts`에 추가):
```ts
export interface SceneStoryboardItem {
  id: string;                  // crypto.randomUUID()
  title: string;
  description: string;
  prompt: string;
  sourceImageIndex: number;    // uploadedUrls[sourceImageIndex]
  mode: 'ai' | 'cleanup';      // Spec B 연계
}
```

**UI 구성:**
- 씬 카드 목록 (`@dnd-kit/sortable` — 이미 설치됨)
- 각 카드: 제목 input + 설명 input + prompt textarea (mode==='ai'일 때만) + 소스 이미지 선택 썸네일 그리드 + 모드 뱃지 + 삭제 버튼
- "씬 추가" 버튼: 빈 카드 append (title="새 씬", prompt="", sourceImageIndex=0, mode='ai')
- 하단 "② 씬 이미지 생성" 버튼 (isHtmlReady && !isGeneratingScenes 일 때만 활성화)
- isHtmlReady=false 상태: 버튼 위에 "상세페이지 HTML 생성 중…" 인라인 안내

---

### 수정 파일

#### `DetailMakerClient.tsx`

**상태 추가:**
```ts
const [storyboard, setStoryboard] = useState<SceneStoryboardItem[] | null>(null);
const [isGeneratingStoryboard, setIsGeneratingStoryboard] = useState(false);
const [storyboardError, setStoryboardError] = useState<string | null>(null);
```

**`handlePlanStoryboard()`:**
```ts
async function handlePlanStoryboard() {
  setIsGeneratingStoryboard(true);
  setStoryboardError(null);
  // HTML 생성과 병렬 시작
  void handleGenerate({ scenesOnly: false, skipSceneImages: true });
  try {
    const res = await fetch('/api/ai/plan-scene-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productName, brandName, category,
        imageCount: uploadedUrls.length,
        referenceText,
        sceneCount: 4,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

기존: `generateSceneImages(sectionsSnapshot, refUrls, genId, currentTheme, sceneHint)`

신규: `generateSceneImages(sectionsSnapshot, refUrls, genId, currentTheme, sceneHint, storyboard)`

- storyboard[i] 있으면: `sourceImageIndex` 기준 소스 이미지 선택, `prompt`를 `sceneHint`로 전달
- storyboard[i] 없으면: 기존 동작 (uploadedUrls[0], 기본 sceneHint)
- mode === 'cleanup' 씬은 Spec B 참조

**`generateSceneImages` 시그니처 변경:**
```ts
// 실제 현재 시그니처에 storyboard 추가
async function generateSceneImages(
  sectionsSnapshot: DetailSection[],
  refUrls: string[],
  genId: number,                          // race condition 방지 (기존 유지)
  currentTheme: DetailPageTheme,          // refreshRenderedHtml 필수 (기존 유지)
  sceneHint: string | undefined,
  storyboard: SceneStoryboardItem[] | null,  // 신규 추가
)
```

storyboard가 null이면 기존 동작 유지 (하위호환).

씬과 storyboard 매핑: `sectionsSnapshot[i]` → `storyboard[i]` (인덱스 기준).
- storyboard 길이 > sections 길이: 초과 씬은 이미지만 생성 (HTML 섹션 없음)
- storyboard 길이 < sections 길이: 나머지 sections는 uploadedUrls[0] + 기본 프롬프트 폴백

---

## 엣지케이스

| 케이스 | 처리 |
|---|---|
| plan-scene-images API 실패 | 에러 배너 표시, 재시도 버튼 (HTML 생성은 계속 진행) |
| HTML 생성 중 "씬 이미지 생성" 클릭 | 버튼 disabled — isHtmlReady=false 상태 |
| sourceImageIndex 범위 초과 | uploadedUrls[0]로 폴백 |
| prompt 비어 있는 씬 | 해당 씬 title+description을 sceneHint로 대체 |
| 씬 이미지 생성 실패 (개별) | 해당 슬롯만 에러, 나머지 씬 계속 진행 (기존 Promise.allSettled 패턴) |
| JSON 파싱 실패 | route에서 catch → HTTP 500 + 에러 메시지 |

---

## 테스트

- `StoryboardEditor`: 씬 추가/삭제, 제목 수정 → onScenesChange 호출, 소스 이미지 선택, isHtmlReady=false → 버튼 disabled
- `plan-scene-images` route: 정상 응답 파싱, ```json 코드블록 strip, res.ok 체크, Claude 에러
- `DetailMakerClient`: handlePlanStoryboard 성공 → storyboard 상태 세팅, 실패 → 에러 표시
- `generateSceneImages`: storyboard 있을 때 sourceImageIndex 적용, genId race condition 동작 유지

---

## 변경 파일 요약

| 파일 | 종류 |
|---|---|
| `src/app/api/ai/plan-scene-images/route.ts` | 신규 |
| `src/components/listing/detail-maker/StoryboardEditor.tsx` | 신규 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 수정 |
| `src/types/detail-page.ts` | `SceneStoryboardItem` 타입 추가 |
