# 크리에이티브 브리프 (Creative Brief) 설계 문서

**작성일:** 2026-06-13
**대상 메뉴:** `/listing/detail-maker` (상품상세 자동만들기)
**핵심 목표:** AI 씬(연출) 이미지의 퀄리티와 일관성을 높인다. 생성 전에 "무드 + 팔레트"를 한 번 정하고(①), 그 브리프가 모든 씬 이미지와 페이지 테마를 통일되게 만든다. 생성 후에는 마음에 안 드는 씬을 장별로 보정한다(③).

---

## 1. 개념 & 영상 매핑

참고 영상의 디자인 프로세스(무드보드 → 색상 팔레트 → 와이어프레임 → AI 연출 이미지)를 detail-maker에 맞게 매핑한다.

| 영상 단계 | detail-maker 구현 |
|---|---|
| 무드보드 | **AI 무드 추천(C) + 프리셋 갤러리(A)** → 무드 1개 선택 |
| 색상 팔레트 | 무드에 **묶여서 따라옴** — 선택한 무드가 페이지 팔레트 + 씬 색조를 함께 세팅 (수동 변경 가능) |
| 와이어프레임 | **생략** — 섹션 레이아웃은 이미 자동. 페이지 구조는 손대지 않음 |
| AI 연출 | 기존 `generate-scene-image` 파이프라인에 브리프 주입 |

### 동작 방식 (①브리프 + ③장별 보정 조합)

```
상품명 + 이미지 입력  (기존)
   ↓
① 브리프 단계 (신규)
   • AI가 상품 분석 → 어울리는 무드 2~3개 추천 (C)
   • 셀러: 추천에서 고르거나, "프리셋 더보기"에서 직접 선택 (A)
   • 무드 선택 = 페이지 팔레트 + 씬 색조 동시 확정 (통일)
   ↓
생성  → AI HTML + 모든 씬 이미지가 "브리프 결"로 일괄 생성  (① 전체 통일감)
   ↓
③ 씬 드로어에서 마음에 안 드는 장만 "이 무드로 재생성" / 레퍼런스 붙여 보정  (장별)
```

**설계 원칙:** 브리프는 순수 "추가 지시"다. 브리프가 비어 있으면 **100% 기존 동작**과 동일하다(하위호환, 안전 기본값). 기존 "제품 픽셀 보존" 규칙은 전혀 건드리지 않는다.

---

## 2. 데이터 모델

### MoodPreset (정적 카탈로그)

`src/lib/detail-page/mood-presets.ts` 에 8종 내외로 정의. A 갤러리와 C 추천이 모두 이 카탈로그를 가리킨다.

```ts
interface MoodPreset {
  id: string;              // 'nordic_minimal', 'luxury_dark', ...
  label: string;           // '북유럽 미니멀'
  emoji: string;           // 🌿  (썸네일 대용, 추후 실제 이미지로 교체 가능)
  keywords: string[];      // ['밝은 우드','린넨','자연광'] — UI 표시 + 셀러 이해용
  palette: PaletteName;    // 'cream_cozy' — 선택 시 페이지 테마로 세팅
  sceneHint: string;       // 영문 — 씬 프롬프트에 주입될 연출 지시
}
```

예시:

```ts
{
  id: 'luxury_dark',
  label: '럭셔리 다크',
  emoji: '🥃',
  keywords: ['대리석', '골드', '무드조명'],
  palette: 'deep_dark',
  sceneHint: 'moody low-key lighting, marble & gold surfaces, dark elegant background, dramatic shadows, premium editorial feel',
}
```

사용 가능한 `PaletteName` (기존 9종, 신규 없음): `warm_cream`, `cool_white`, `deep_dark`, `nature_green`, `tech_navy`, `rose_soft`, `cream_cozy`, `sunset_warm`, `fresh_mint`.

### CreativeBrief (선택 결과)

store에 저장되고 생성 파이프라인에 전달된다.

```ts
interface CreativeBrief {
  moodId: string | null;          // 선택한 프리셋 id (null이면 기존 동작)
  sceneHint: string;              // 프리셋 sceneHint 복사 (또는 셀러 수정본)
  paletteOverride?: PaletteName;  // 무드 팔레트를 수동 변경한 경우만
}
```

### 동작 규칙

- 무드 선택 → `CreativeBrief` 채워지고 `theme.palette`를 `preset.palette`로 세팅 (통일).
- 브리프 없음 = 기존 동작. 비어도 깨지지 않는다.
- **C(AI 추천)는 새 정보를 만들지 않는다.** 카탈로그에서 어울리는 `moodId` 2~3개를 고를 뿐 → 결과가 항상 일관·예측 가능, 프롬프트 폭주 없음.

---

## 3. 컴포넌트 & API

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/lib/detail-page/mood-presets.ts` | `MOOD_PRESETS` 카탈로그(8종) + `getMoodPreset(id)` 헬퍼 |
| `src/app/api/ai/suggest-mood/route.ts` | **C** — 상품 이미지 + 상품명 → Claude Vision → 어울리는 `moodId` 2~3개 반환 (카탈로그 id만, Zod로 검증) |
| `src/components/listing/detail-maker/CreativeBriefPanel.tsx` | **①** UI — AI 추천 2~3개 + "프리셋 더보기" 갤러리, 선택 시 브리프 확정 |

### 수정 파일

| 파일 | 변경 |
|---|---|
| `src/store/useListingStore.ts` (또는 detail-maker 로컬 state) | `creativeBrief: CreativeBrief \| null` + setter 추가 |
| `src/app/api/ai/generate-scene-image/route.ts` | 스키마에 `sceneHint?: string` 추가 → 유저 프롬프트에 `"Art direction: ${sceneHint}"` 한 줄 합류 |
| `src/app/api/ai/generate-frame-image/route.ts` | 동일하게 `sceneHint?` 수신·전달 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 브리프 패널 배치, `generateSceneImages` 호출 시 `sceneHint` 전달, 무드 선택 시 `handleThemeChange`로 팔레트 통일 |
| `src/components/listing/detail-maker/DetailMakerInputPanel.tsx` | 입력 패널(상품명·이미지 아래)에 `CreativeBriefPanel` 끼워넣기 |

### UI 배치 & 동작

- 좌측 입력 패널에서 상품명 + 이미지 입력 **바로 아래**에 브리프 패널.
- 이미지가 올라오면 자동으로 AI 추천(C)이 뜸. 추천 카드 옆 "더보기"로 프리셋 갤러리(A) 펼침.
- 무드 선택 시 작은 미리보기로 팔레트 칩 + 키워드 표시 → 셀러가 "이 결로 나오겠구나" 직관.
- `suggest-mood`는 이미지 업로드 직후 1회 Claude Vision 호출(가벼운 분류 작업이라 Haiku급으로 충분). **논블로킹** — 셀러가 추천을 안 기다리고 바로 프리셋에서 골라도 됨.

### 씬 생성 주입 방식

`generate-scene-image`의 `SCENE_PROMPT_SYSTEM` 유저 프롬프트에 `sceneHint`를 `"Art direction: ${sceneHint}"` 한 줄로 합류시킨다. 기존 제품 픽셀 보존/수량 왜곡 방지/단일 프레임 규칙은 그대로 둔다.

---

## 4. ③ 이미지별 보정

> **호스트 컴포넌트 주의:** detail-maker는 결과를 `DetailPageEditor`로 보여주며, 씬 이미지는 각 섹션(hero/point) 안에 렌더된다. **`SceneImageDrawer`는 assets 탭(`AssetsResultPanel`) 전용**이라 detail-maker에서는 쓰이지 않는다. 따라서 detail-maker의 ③ 보정은 `DetailPageEditor`의 섹션 단위에서 노출한다.

**`DetailPageEditor`에 섹션별 "씬 재생성" 액션 추가** — 씬 이미지를 가진 섹션(hero/point)에 작은 **🎨 재생성** 컨트롤을 둔다.

```
섹션 씬 이미지 → 🎨 재생성
 ├─ 브리프 sceneHint 기본 적용 (전체 톤 유지)
 ├─ 이 섹션만 무드 임시 변경 (드롭다운 — 다른 프리셋)
 └─ 레퍼런스 1장 첨부 (선택) → generate-scene-image 재호출
```

- 재생성은 **그 섹션 씬 1장만** 대상. 기존 멀티레퍼런스 로더(`loadReferenceImages`) 재사용.
- 기본값은 브리프 `sceneHint` → ①의 전체 통일감을 유지한 채 보정. 셀러가 의도적으로 다른 무드를 고를 때만 그 섹션이 달라진다.
- 재생성 결과는 `DetailMakerClient.generateSceneImages`가 이미 쓰는 경로(섹션 content에 이미지 URL 주입 → `refreshRenderedHtml`)로 HTML 재빌드.
- **구현 플랜 확인 필요:** `DetailPageEditor`가 섹션 수준 액션을 노출하는 확장점(예: `onSectionAiEdit`처럼 `onSceneRegenerate` 콜백 추가)을 어떻게 둘지 플랜 단계에서 확정한다. assets 탭 `SceneImageDrawer`의 재생성 로직과 공통 함수로 묶을 수 있으면 공유한다.

---

## 5. 범위 (YAGNI — 만들지 않는 것)

- ❌ 와이어프레임/레이아웃 편집 단계 (섹션 구조 자동 유지)
- ❌ 무드 레퍼런스 **업로드(B)** — ①에서는 프리셋/AI만. 업로드는 ③ 섹션 재생성의 장별 레퍼런스로만 (이미 토대 있음)
- ❌ 커스텀 팔레트 에디터 — 기존 9종 팔레트 재사용
- ❌ 무드 프리셋을 셀러가 직접 생성 — 카탈로그는 고정

---

## 6. 테스트 전략

- `mood-presets` 카탈로그 검증 — 모든 프리셋의 `palette`가 유효한 `PaletteName`인지, `id` 유일성.
- `suggest-mood` API — Claude Vision 모킹, 반환이 **카탈로그에 존재하는 id만** 인지(환각 id 방어), 2~3개 범위.
- `generate-scene-image` — `sceneHint` 주입 시 유저 프롬프트에 art direction 라인이 들어가는지, `sceneHint` 없을 때 기존 동작 동일(하위호환).
- `CreativeBriefPanel` — 무드 선택 시 `creativeBrief`와 `theme.palette`가 함께 세팅되는지 단위 테스트.

---

## 7. 기존 자산 재사용

- `generate-scene-image` / `generate-frame-image` 파이프라인 (sceneHint 필드만 추가)
- `loadReferenceImages` 멀티레퍼런스 로더 (③ 장별 레퍼런스)
- `DetailPageEditor` (섹션별 씬 재생성 액션만 추가). assets 탭 `SceneImageDrawer`의 재생성 로직과 공통화 가능
- `DetailMakerClient.generateSceneImages` / `refreshRenderedHtml` (씬 주입 + HTML 재빌드 경로)
- `PALETTES` 9종 + `DetailPageTheme` (팔레트 통일에 그대로 사용)
- `handleThemeChange` (무드 선택 시 팔레트 통일)
