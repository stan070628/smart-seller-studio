# PRO 상세페이지: 옵션 고른 노출 + 씬 품질 설계

> 작성일: 2026-07-25
> 대상: `detail-maker-pro` 화면 + `generate-pro-layout` API + `layout-validator` + `watermark-removal`
> 선행 문서: [PRO 촬영 가이드 Phase1](./2026-07-24-pro-shot-guide-phase1-design.md)

## 0. 문제

컬럼비아 민소매 티셔츠(화이트/블랙 2색) 상세페이지 생성 결과에서 네 가지가 동시에 드러났다.

1. **한 색으로 쏠린다.** `system-prompt.ts:56`의 D1이 "대표 색상 1개를 정해 히어로·소재·착용 섹션은 그 색상 이미지만 쓰고, 두 색이 함께 나오는 곳은 컬러 비교 option_grid 단 한 곳으로 제한하세요"라고 지시한다. 판매자가 어떤 옵션을 밀지 지정할 입력조차 없다.
2. **의미 없는 지표.** `stat_row`에 "소매 길이 0cm"(민소매라 0), "4단계 사이즈"(옵션 개수)가 히어로에 박혔다. `system-prompt.ts:52`의 C4가 "색상 2종" 예시만 금지해 그물을 빠져나갔고, `layout-validator.ts`에는 값 자체를 보는 규칙이 없다.
3. **Gemini 워터마크.** 업로드된 제품 이미지(`listings/…/1784981785938_detail_3.jpg`)에 제미나이 앱이 붙인 ✦가 남아 있다. 이 이미지는 상세페이지 3곳에 직접 쓰였고, AI 씬 생성의 참조로도 들어가 **생성 이미지 옷 위에 ✦가 프린트처럼 복제**됐다.
4. **부정적 히어로.** 히어로 라이프스타일 씬이 러닝 후 무릎을 짚고 고개 숙인 채 숨 고르는 인물이다. 구매 동기를 꺾는다.

### 워터마크 실측

| 이미지 | ✦ 위치 (가로, 세로 %) | 성격 |
|---|---|---|
| `1784981785938_detail_3.jpg` (업로드 원본) | 86.5, 89.8 | 우하단 오버레이. 베이지 배경 위 **어두운** 회색 |
| `1784981818955-lifestyle.png` (AI 씬) | 85.4, 87.9 | 검은 원단 위 **밝은** 회색 |
| `1784981815943-lifestyle.png` (AI 히어로) | 72.4, 86.1 | **반바지 밑단에 그려진 프린트** — 코너 아님 |

현행 `hasWatermarkCandidate`(`watermark-removal.ts:45`)는 우하단 12%×8%(x≥88%, y≥92%)만 보고, 코너가 바로 위 영역보다 **밝을 때만** 감지한다. 세 사례 모두 위치가 검사창 밖이고, 첫 사례는 대비 방향까지 반대다. 실측값은 `brightnessDiff 1.0`(임계 30), `varianceDelta −0.7`(임계 200)으로 감지 근처에도 못 간다.

`GOOGLE_AI_API_KEY`는 유료 티어임을 확인했다(`scripts/check-gemini-watermark.mjs` 통과). 워터마크는 API가 아니라 **제미나이 앱에서 만든 이미지**가 들여온 것이다.

## 1. 목표

- 옵션이 2개 이상인 상품은 **한 페이지 안에서 옵션이 고르게 등장**하고, **옵션 비교 섹션이 정확히 1개** 들어간다.
- `stat_row`에 값이 0이거나 옵션 개수인 항목이 남지 않는다.
- 제미나이 앱 워터마크가 업로드 시점에 제거되어 상세페이지에도, 생성 씬에도 전파되지 않는다.
- 인물 씬은 부정적 감정·자세를 그리지 않는다.

**성공 기준:** 화이트/블랙 2옵션으로 생성했을 때 (a) 옵션 비교 섹션 1개가 존재하고, (b) 비교 섹션 밖 이미지 슬롯에서 두 옵션이 모두 최소 1회 등장하며 등장 횟수 편차가 1 이하이고, (c) `stat_row`에 0값·개수형 항목이 없고, (d) 업로드한 워터마크 이미지가 저장 시점에 정리된다.

## 2. 옵션 데이터 모델 (`src/lib/detail-page/product-options.ts` 신규)

옵션은 **업로드 이미지에 붙는 이름**이다. 별도 DSL 필드를 만들지 않고, 섹션이 쓰는 옵션은 `imageSlots[].imageRef`가 가리키는 이미지에서 역산한다.

```ts
export interface ProductOption {
  /** 판매자가 입력한 옵션명. 예: "화이트" */
  name: string;
  /** productImages 배열 인덱스 (0-based) */
  imageIndex: number;
}

/**
 * optionNames[i]는 productImages[i]의 옵션명. 빈 문자열은 미지정.
 * 이름이 붙은 이미지마다 항목을 하나씩 만든다 — 같은 이름이 여러 번 나올 수 있다.
 */
export function deriveOptions(optionNames: string[]): ProductOption[];

/** 고유 옵션명. 입력 순서 유지 */
export function uniqueOptionNames(options: ProductOption[]): string[];

/** 고유 옵션명이 2개 이상이면 옵션 모드 */
export function isOptionMode(options: ProductOption[]): boolean;

/** imageIndex → 옵션명 (이름이 붙은 모든 인덱스를 담는다) */
export function optionNameByImageIndex(options: ProductOption[]): Map<number, string>;
```

`deriveOptions`는 입력 순서를 유지하며 공백을 제거하고 빈 문자열을 버린다. **중복을 접지 않는 것이 중요하다** — 블랙 사진이 2장이면 `[{블랙,1},{블랙,2}]` 두 항목이 남아야 `imageRef=2`인 슬롯도 블랙으로 역산된다. 옵션 목록이 필요한 곳(비교 섹션 개수, 커버리지 대상)은 `uniqueOptionNames`를 쓴다.

### 커버리지 집계

```ts
export interface OptionCoverage {
  /** 비교 섹션이 몇 개인지 */
  compareSectionCount: number;
  /** 옵션명 → 비교 섹션 밖 imageSlot 등장 횟수 */
  counts: Map<string, number>;
  /** 집계 대상 슬롯 총수 */
  total: number;
}

export function collectOptionCoverage(
  sections: unknown[],
  nameByImageIndex: Map<number, string>,
): OptionCoverage;
```

`counts`는 **등장하지 않은 옵션도 0으로 채워 반환한다.** 그래야 "0회인 옵션 존재" 검사가 성립한다.

**비교 섹션 판정:** `blocks`에 `option_grid`가 있고 `imageSlots.length >= 2`인 섹션.

비교 섹션을 집계에서 제외하는 것이 핵심이다. 포함하면 비교 섹션의 화이트 1 + 블랙 1이 "나머지 전부 화이트"인 편중을 가려버린다.

## 3. 입력 UI (`detail-maker-pro/page.tsx`)

제품 이미지 4칸 그리드(`:472-491`) 각 썸네일 아래에 옵션명 입력칸을 단다.

```
제품 이미지  ★ 상세페이지에 삽입됩니다
┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
│  ×  │ │  ×  │ │  ×  │ │  ×  │
└─────┘ └─────┘ └─────┘ └─────┘
[화이트] [블랙 ] [블랙 ] [     ]
```

- 상태: `optionNames: string[]` — `productImages`와 인덱스 정합을 유지한다.
  - 추가(`:455-459`): 새 파일 수만큼 `''`를 이어붙이고 4개로 자른다.
  - 삭제(`:479`): 같은 인덱스를 splice.
  - 교체(`:468`): 배열을 새 파일 수만큼 `''`로 초기화.
- 안내문: "옵션명을 2개 이상 적으면 옵션별로 고르게 노출되는 상세페이지가 만들어집니다. (선택)"
- 입력값은 40자로 자른다.

옵션 도출·커버리지 로직은 전부 `product-options.ts`에 두고 컴포넌트에는 UI만 남긴다 (`page.tsx`가 이미 1135줄).

## 4. 레이아웃 생성 (`generate-pro-layout`)

### 4.1 요청 스키마 (`route.ts:19`)

```ts
  productOptions: z
    .array(z.object({
      name: z.string().min(1).max(40),
      imageIndex: z.number().int().min(0).max(3),
    }))
    .max(4)
    .default([]),
```

`.default([])`이므로 기존 호출은 그대로 동작한다.

### 4.2 유저 프롬프트 (`route.ts:110`)

옵션이 2개 이상일 때만 한 줄 추가:

```
옵션(색상/모델): 이미지 0 = "화이트", 이미지 1 = "블랙", 이미지 2 = "블랙"
```

### 4.3 시스템 프롬프트 (`system-prompt.ts`)

**D1 교체** (현행 "대표 색상 1개" 규칙을 삭제):

> D1. 옵션(색상·모델)이 2개 이상 제공되면:
> - **옵션 비교 섹션을 정확히 1개** 포함하라. `option_grid` items를 옵션 수만큼 만들고, `imageSlots`도 같은 수로 선언해 각 슬롯의 `imageRef`를 해당 옵션 이미지로 지정한다.
> - 나머지 이미지 섹션은 옵션을 **돌려쓴다**. 비교 섹션 밖 이미지 슬롯에서 모든 옵션이 최소 1회 등장해야 하고, 가장 많이 쓴 옵션과 가장 적게 쓴 옵션의 횟수 차이가 1을 넘으면 안 된다.
> - **섹션 내용이 옵션과 충돌하면 내용을 우선한다.** 예: "블랙 등판 로고" 섹션엔 블랙 이미지를 쓰고, 균형은 다른 섹션에서 맞춘다.
> - 카피에 옵션명을 억지로 넣지 마라. 그 섹션에서 실제로 그 옵션을 보여줄 때만 언급한다.
>
> 옵션이 1개 이하면 이 규칙은 무시하고 제품 이미지를 내용에 맞게 배정한다.

**C4 강화:**

> C4. `stat_row`에는 실측 가능한 크기·무게·용량·시간·온도·비율만 넣는다. 다음은 금지:
> - 값이 0이거나 "없음/무"인 항목. 예: "소매 길이 0cm" — 없다는 사실은 `bullet_list`로 말하라("소매가 없어 겨드랑이 땀 자국이 남지 않음").
> - 옵션·구성의 **개수**. 예: "4단계 사이즈", "색상 2종", "3가지 구성" → `option_grid`로.

**신규 D3 (부정적 이미지 금지):**

> D3. 인물이 등장하는 씬의 `promptHint`는 제품을 쓰는 즐거움·성취·편안함이 드러나야 한다. 지침·통증·불편·좌절·땀에 지친 표정, 무릎을 짚거나 주저앉은 자세, 찡그린 표정을 쓰지 마라. 문제 상황은 이미지가 아니라 카피로 말한다.
> 예외: 비교 대상(타사 제품·기존 방식·개선 전)의 단점을 드러내는 표현. 우리 제품을 착용·사용하는 인물은 예외 없이 긍정적이다.

## 5. 검증기 (`layout-validator.ts`)

### 5.1 stat_row 위생 — 결정론적 제거

`sanitizeProLayout`의 파이프라인(`:190-204`)에 `pruneBlocks` **앞** 단계로 `sanitizeStatRows`를 넣는다. 항목을 걸러 2개 미만이면 `items: []`로 비우고, 뒤따르는 `pruneBlocks`의 `isEmptyBlock`이 블록을 제거한다.

제거 규칙 (`value`는 문자열, `unit`·`label`과 함께 판단):

| 규칙 | 예 |
|---|---|
| 숫자 토큰이 있고 모두 0 | `"0"`, `"0.0"`, `"0cm"` |
| 값이 순수 정수 + `label`/`unit`에 개수 단위 | `"4"` + `"단계"`/`"사이즈"` |
| 값이 없음·무·`-`·`N/A` | `"없음"` |

개수 단위 어휘: `단계 종 가지 개 컬러 색상 종류 옵션 세트`.

`stat_row`는 `columns.cols` 안에도 들어갈 수 있으므로 `sanitizeStatRows`는 `cols`를 재귀 순회한다. (기존 `pruneBlocks`는 최상위 blocks만 보는 한계가 있으나 이번 범위 밖이다.)

### 5.2 옵션 커버리지 — 위반 → repair 유발

`Violation.code`에 `'option_coverage' | 'option_compare'` 추가.

```ts
export function validateProLayout(
  sections: unknown,
  opts?: { optionNameByImageIndex?: Map<number, string> },
): ValidationResult;
```

`opts`가 없거나 옵션이 2개 미만이면 이 검사를 건너뛴다(기존 호출·테스트 무영향). 옵션 모드일 때:

| 조건 | code | severity |
|---|---|---|
| 비교 섹션 0개 | `option_compare` | error |
| 비교 섹션 2개 이상 | `option_compare` | warning |
| 비교 섹션 밖 등장 0회인 옵션 존재 | `option_coverage` | error |
| 비교 섹션 밖 `max(등장수) − min(등장수) > 1` | `option_coverage` | error |

편중 판정에 비율이 아니라 **편차**를 쓴다. "한 옵션이 절반 초과"로 하면 슬롯 3개·옵션 2개처럼 애초에 균등 분배가 불가능한 경우(2:1 = 66%)를 위반으로 잡아 무한히 못 고치는 요구를 만든다. 편차 1 이하 허용은 어떤 슬롯 수에서도 달성 가능하다.

| 슬롯 : 옵션 | 최선 분배 | 편차 | 판정 |
|---|---|---|---|
| 3 : 2 | 2, 1 | 1 | 통과 |
| 5 : 2 | 5, 0 | 5 | 위반 |
| 6 : 2 | 4, 2 | 2 | 위반 |
| 6 : 3 | 2, 2, 2 | 0 | 통과 |

`sanitizeProLayout`도 같은 `opts`를 받아 내부 `validateProLayout` 호출에 넘긴다.

### 5.3 수리 (`repair-pro-layout.ts`)

`RepairProductInfo`에 옵션 컨텍스트를 추가한다.

```ts
export interface RepairProductInfo {
  name: string;
  points: string[];
  category: string;
  /** 옵션 모드일 때만. 예: ['이미지 0 = "화이트"', '이미지 1 = "블랙"'] */
  optionLines?: string[];
}
```

`userPrompt`에 옵션 줄을 넣고, `REPAIR_SYSTEM`의 체크리스트에 항목을 추가한다:

> 5. 옵션 편중 이슈가 있으면 `imageSlots[].imageRef`를 재배정해 옵션을 고르게 만든다. 단 섹션 내용과 옵션이 충돌하면 내용을 우선하고 다른 섹션에서 균형을 맞춘다. 비교 섹션은 옵션당 슬롯 1개를 유지한다.

### 5.4 라우트 결선 (`generate-pro-layout/route.ts:157-168`)

```
options = productOptions → nameByImageIndex
cleaned = sanitizeProLayout(sections, { optionNameByImageIndex }).sections
{ violations, isClean } = validateProLayout(cleaned, { optionNameByImageIndex })
!isClean → repairProLayout(cleaned, violations, { …, optionLines }) → 재정화
```

repair는 1패스만 돈다(기존 동작 유지). 재정화 후에도 편중이 남으면 그대로 반환한다 — 루프를 만들지 않는다.

## 6. 씬 생성 시 색 오염 차단 (`page.tsx:982-985`)

현행은 참조 이미지를 2장 보낸다: `[imageRef 이미지, ...전체].slice(0, 2)`. 옵션 모드에서 이러면 화이트 슬롯에 블랙 사진이 함께 들어가 Gemini가 색을 섞는다.

**옵션 모드에서는 `imageRef`가 가리키는 이미지 1장만 보낸다.** 같은 옵션명을 가진 이미지가 여러 장이면 그중 최대 2장까지 허용한다(각도 참조 이득은 유지하면서 색은 안 섞임). 옵션 모드가 아니면 현행 그대로.

`sceneHint`에는 옵션명을 덧붙인다: `${promptHint} (제품 색상: 화이트)`.

## 7. 워터마크 (`src/lib/image/watermark-removal.ts`)

전파 경로가 두 갈래다.

```
제미나이 앱 이미지 (✦ 우하단)
   ├─ 상세페이지에 직접 삽입          → 코너 감지로 잡힘
   └─ AI 씬 생성의 참조로 투입
          → Gemini가 옷 위에 ✦를 그림  → 위치 불특정, 코너 감지 불가
```

### 7.1 1차 방어 — 진입 시점 제거 (주력)

업로드 이미지에서 ✦를 지우면 두 번째 경로 자체가 사라진다. `hasWatermarkCandidate`(불리언)를 `findWatermarkBox`(좌표)로 교체한다.

```ts
export interface WatermarkBox { left: number; top: number; width: number; height: number }

/** 우하단 영역에서 워터마크 후보의 원본 좌표 박스를 찾는다. 없으면 null. */
export async function findWatermarkBox(buffer: Buffer): Promise<WatermarkBox | null>;
```

알고리즘:

1. 최대 512px로 축소 → 그레이스케일 → raw 픽셀
2. 검사 영역: **우하단 35% × 25%** (실측 x가 72.4~86.5%로 흩어져 있음)
3. 배경 밝기 = 영역 **중앙값** (평균은 워터마크에 끌려간다)
4. 마스크 = `|픽셀 − 중앙값| > 35` — **양방향** (밝은 ✦, 어두운 ✦ 모두)
5. 형태 검사로 오탐 제거. 모두 통과해야 워터마크로 본다:
   - 마스크 면적이 전체 이미지의 0.02% ~ 2%
   - bbox 종횡비 0.5 ~ 2 (✦는 대략 정사각)
   - bbox 안 마스크 채움률 > 0.25 (✦는 bbox를 절반 이하로 채운다)
6. bbox를 원본 좌표로 환산하고 짧은 변의 40%만큼 패딩 → 이미지 경계로 클램프

`removeGeminiWatermark`는 고정 코너 대신 이 박스를 crop → Gemini 인페인팅 → 원위치 합성한다. 박스가 `null`이면 원본을 그대로 반환한다(현행과 동일한 무동작 경로).

형태 검사가 오탐 방어의 전부다. 검사창을 넓힌 만큼, 우하단에 있는 정당한 작은 디테일(브랜드 태그·단추)을 지우지 않도록 면적·종횡비·채움률 세 조건을 모두 요구한다.

이 함수 하나를 고치면 세 경로가 동시에 고쳐진다:
- `/api/listing/upload-image` (제품 이미지 업로드 — 이번 문제의 진원지)
- `/api/image/upload-ai` (AI 씬 업로드)
- `/api/ai/generate-detail-html`

### 7.2 2차 방어 — 생성 프롬프트에서 금지

참조가 이미 오염된 경우를 대비해, 모든 생성 경로의 프롬프트 꼬리인 `PRODUCT_FIDELITY_INSTRUCTION`(`generate-scene-image/route.ts:65`)과 `SCENE_PROMPT_SYSTEM`의 규칙에 추가한다:

> Do NOT render any four-pointed star, sparkle, glitter, or diamond glyph anywhere in the image — not on the garment, product surface, or background. If such a mark appears in the reference image, treat it as an artifact and omit it.

`BACKGROUND_PROMPT_SYSTEM`(`:81`)의 "No text, logos, watermarks" 목록에도 sparkle을 추가한다.

### 7.3 한계

**이미 ✦가 옷 위에 그려져 나온 이미지는 자동으로 지울 수 없다.** 코너 오버레이가 아니라 생성된 콘텐츠이기 때문이다. 기존 수동 도구(`ImageCleanupModal` `mode='watermark'` + `/api/ai/remove-watermark-region`)로 지우거나 재생성해야 한다. 이 스펙에서는 그 도구를 PRO 화면에 연결하지 않는다.

### 7.4 곁다리 버그

`removeWithGemini`는 JPEG를 반환하는데(`watermark-removal.ts:148`) `upload-ai`(`route.ts:151-156`)는 `mimeType`을 원본값으로 유지해 `.png` 이름·`image/png` 타입으로 올린다. 실제로 문제의 씬 파일이 `-lifestyle.png`다. `removeGeminiWatermark`가 `{ buffer, mimeType }`을 반환하도록 바꾸고 호출부 3곳에서 반영한다.

## 8. 부정적 이미지 금지 — 하류 (`generate-scene-image/route.ts`)

§4.3의 D3가 상류(promptHint) 방어라면, 여기는 안전망이다. `PRODUCT_FIDELITY_INSTRUCTION`에 추가:

> If a person appears, they must look confident, comfortable, and at ease — relaxed or lightly positive expression, upright active posture. No grimacing, exhaustion, hunching over, hands on knees, slumping, distress, or discomfort.

`SCENE_PROMPT_SYSTEM`의 Rules에도 같은 취지의 한 줄을 넣어 Claude가 프롬프트를 쓸 때부터 반영되게 한다. `BACKGROUND_PROMPT_SYSTEM`은 인물이 등장하지 않으므로(`:77` "NO people") 해당 없다.

## 9. 테스트

| 파일 | 검증 |
|---|---|
| `src/__tests__/lib/image/watermark-removal.test.ts` (신규) | sharp 합성 픽스처 3종 — ① 밝은 배경 + 어두운 ✦ (x 86.5%, y 89.8% — 실제 실패 케이스), ② 어두운 배경 + 밝은 ✦ (x 72.4%, y 86.1%), ③ 워터마크 없는 사진. ①②는 박스 반환, ③은 `null`. Gemini 호출은 mock |
| `src/__tests__/lib/detail-page/product-options.test.ts` (신규) | `deriveOptions` 중복·공백 처리, `collectOptionCoverage`가 비교 섹션을 제외하는지 |
| `src/__tests__/lib/detail-page/layout-validator.test.ts` (추가) | stat 위생 3규칙, 2개 미만 시 블록 삭제, `columns.cols` 재귀. 옵션 커버리지 위반 4종. `opts` 없으면 옵션 검사 미수행 |
| `src/__tests__/api/generate-pro-layout.test.ts` (추가 또는 신규) | `productOptions` 전달 시 유저 프롬프트에 옵션 줄 포함, 미전달 시 기존 동작 |

`npx vitest run`을 인자 없이 돌리면 라이브러리 테스트까지 돌아 무관한 선재 실패가 섞인다. 회귀 판단은 위 경로를 지정해서 한다.

## 10. 손대는 파일

| 파일 | 내용 |
|---|---|
| `src/lib/detail-page/product-options.ts` | 신규 — 옵션 도출·커버리지 집계 (순수) |
| `src/lib/image/watermark-removal.ts` | 감지 재작성 + mimeType 반환 |
| `src/lib/detail-page/layout-validator.ts` | stat 위생 + 옵션 커버리지 |
| `src/lib/ai/repair-pro-layout.ts` | 옵션 컨텍스트 전달 |
| `src/app/api/ai/generate-pro-layout/system-prompt.ts` | D1 교체, C4 강화, D3 신규 |
| `src/app/api/ai/generate-pro-layout/route.ts` | 스키마·프롬프트·검증 결선 |
| `src/app/api/ai/generate-scene-image/route.ts` | 스파클 금지 + 긍정 감정 규칙 |
| `src/app/listing/[id]/detail-maker-pro/page.tsx` | 옵션명 UI, 씬 참조 이미지 선택 |
| `src/app/api/image/upload-ai/route.ts` | mimeType 정합 |
| `src/app/api/listing/upload-image/route.ts` | mimeType 정합 |
| `src/app/api/ai/generate-detail-html/route.ts` | mimeType 정합 |
| `scripts/check-gemini-watermark.mjs` | 이미 추가됨 — Gemini API 티어 판별 |

## 11. 범위 밖

- 옵션별로 상세페이지를 **여러 장** 뽑는 것 (한 페이지 안 고른 노출로 결정)
- 이미 생성된 워터마크 이미지의 소급 정리
- PRO 화면에 수동 워터마크 제거 도구 연결
- `pruneBlocks`가 `columns.cols`를 재귀하지 않는 기존 한계 (stat 위생만 재귀 처리)
