# PRO 상세페이지: 옵션 고른 노출 + 씬 품질 설계

> 작성일: 2026-07-25
> 대상: `detail-maker-pro` 화면 + `generate-pro-layout` API + `layout-validator` + 씬 생성 프롬프트
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

현행 `hasWatermarkCandidate`(`watermark-removal.ts:45`)는 셋 다 놓친다. 이유는 두 가지다.

1. **검사창 위치.** 우하단 12%×8%(x≥88%, y≥92%)만 본다. 세 사례 모두 그 밖에 있다.
2. **평균 비교의 둔감함.** 코너 패치와 바로 위 패치의 **평균 밝기 차**를 본다(`:73`). 대비 방향은 `Math.abs`라 양방향이지만, 작은 ✦ 하나는 103×94 패치의 평균을 거의 움직이지 못한다. 실측 `brightnessDiff 1.0`(임계 30), `varianceDelta −0.7`(임계 200).

검사창을 넓히고 픽셀 단위 블롭 탐지로 바꾸는 개선안을 실측 검증했으나 **여전히 쓸 수 없는 정확도**였다. §7.1에 근거를 정리했고, 자동 감지 자체를 철회했다.

`GOOGLE_AI_API_KEY`는 유료 티어임을 확인했다(`scripts/check-gemini-watermark.mjs` 통과). 워터마크는 API가 아니라 **제미나이 앱에서 만든 이미지**가 들여온 것이다.

## 1. 목표

- 옵션이 2개 이상인 상품은 **한 페이지 안에서 옵션이 고르게 등장**하고, **옵션 비교 섹션이 정확히 1개** 들어간다.
- `stat_row`에 값이 0이거나 옵션 개수인 항목이 남지 않는다.
- 판매자가 레이아웃 생성 **전에** 워터마크를 손으로 지울 수 있고, 생성 씬에 ✦가 복제되지 않는다.
- 인물 씬은 부정적 감정·자세를 그리지 않는다.

**성공 기준:** 화이트/블랙 2옵션으로 생성했을 때 (a) 옵션 비교 섹션 1개가 존재하고, (b) 비교 섹션 밖 이미지 슬롯에서 두 옵션이 모두 최소 1회 등장하며 등장 횟수 편차가 1 이하이고, (c) `stat_row`에 0값·개수형 항목이 없고, (d) 업로드 화면에서 ✦ 버튼으로 워터마크를 지우면 그 이미지가 레이아웃 생성·씬 참조에 반영되며, (e) 어떤 업로드 경로도 사용자 이미지를 자동으로 편집하지 않는다.

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

**비교 섹션 판정:** 세 조건을 모두 만족하는 섹션.

1. `blocks`에 `option_grid`가 있다
2. `imageSlots.length === 고유 옵션 수`
3. `option_grid.items.length === imageSlots.length`

조건 1만으로는 좁히기에 부족하다. C4 강화(§4.3)로 "4단계 사이즈"류가 `option_grid`로 유도되므로 한 페이지에 `option_grid`가 2개 이상 나오는 것이 정상 상태가 된다. 사이즈 grid가 우연히 `imageSlots` 2개를 가지면 비교 섹션으로 오인되어 커버리지 집계에서 통째로 빠지고 `compareSectionCount`가 2가 된다. 조건 2·3이 그것을 막는다.

비교 섹션을 집계에서 제외하는 것이 핵심이다. 포함하면 비교 섹션의 화이트 1 + 블랙 1이 "나머지 전부 화이트"인 편중을 가려버린다.

**`imageRef` 미지정 슬롯.** 렌더 폴백(`page.tsx:1126`)은 `imageRef`가 없으면 `(섹션 + 슬롯) % 이미지 수` 로테이션으로 배정한다. 즉 미지정 슬롯도 실제로는 특정 옵션을 노출하므로, 집계에서 그냥 무시하면 "검증 통과했는데 렌더는 편중"이 성립한다. 그래서 옵션 모드에서는 **비교 섹션 밖 이미지 슬롯에 `imageRef`가 없으면 그 자체를 위반으로 잡는다**(§5.2). 폴백 로테이션은 옵션 모드가 아닐 때만 의미를 갖는다.

이름이 붙지 않은 이미지 인덱스를 가리키는 슬롯도 같은 위반으로 처리한다 — 어느 옵션인지 판정할 수 없기 때문이다.

## 3. 입력 UI (`detail-maker-pro/page.tsx`)

제품 이미지 4칸 그리드(`:559-604`) 각 썸네일 아래에 옵션명 입력칸을 단다.

```
제품 이미지  ★ 상세페이지에 삽입됩니다
┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
│  ×  │ │  ×  │ │  ×  │ │  ×  │
└─────┘ └─────┘ └─────┘ └─────┘
[화이트] [블랙 ] [블랙 ] [     ]
```

- 상태: `optionNames: string[]` — `productImages`와 인덱스 정합을 유지한다.
  - 추가(`:544`): 새 파일 수만큼 `''`를 이어붙이고 4개로 자른다.
  - 삭제(`:566`): 같은 인덱스를 splice.
  - 교체(`:555`): 배열을 새 파일 수만큼 `''`로 초기화.
- 안내문: "옵션명을 2개 이상 적으면 옵션별로 고르게 노출되는 상세페이지가 만들어집니다. (선택)"
- 입력값은 40자로 자른다.

옵션 도출·커버리지 로직은 전부 `product-options.ts`에 두고 컴포넌트에는 UI만 남긴다 (`page.tsx`가 이미 1222줄).

> 줄번호 주의: `page.tsx`는 2026-07-25 `16f9a471`("업로드 화면에 '촬영 진행중' 리스트")로 1135→1222줄이 됐다. 이 문서의 번호는 그 커밋 기준이다. 구현 시 앵커는 줄번호가 아니라 인용된 코드 조각으로 찾을 것.

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

**반드시 생성 경로에서만 돌아야 한다.** `sanitizeProLayout`은 생성 시점 외에도 두 곳에서 호출된다:

- `src/app/api/detail-page/draft/route.ts:44` — 초안 저장 시
- `src/app/api/detail-page/render/route.ts:125` — 렌더 시

이 두 경로는 **사용자가 에디터에서 직접 편집한 콘텐츠**를 다룬다. stat 위생을 파이프라인에 무조건 넣으면 사용자가 손으로 쓴 "당류 0g", "카페인 0mg" 같은 항목이 저장·렌더 때마다 소리 없이 사라진다.

그래서 opt-in 플래그로 게이트한다.

```ts
export function sanitizeProLayout(
  sections: unknown[],
  opts?: {
    /** stat_row 위생. 생성 경로에서만 true */
    statHygiene?: boolean;
    optionNameByImageIndex?: Map<number, string>;
  },
): { sections: unknown[]; warnings: Violation[] };
```

`generate-pro-layout` 라우트만 `statHygiene: true`를 넘긴다. 옵션 커버리지 검사와 동일한 게이트 방식이라 일관된다.

파이프라인(`:190-204`)에서 `pruneBlocks` **앞** 단계로 `sanitizeStatRows`를 넣는다.

제거 규칙 (`value`는 문자열, `unit`·`label`과 함께 판단):

| 규칙 | 예 | 비고 |
|---|---|---|
| 값이 0 **이고** `label`/`unit`이 치수 계열 | `"0"` + `"소매 길이"`/`"cm"` | 치수 어휘로 좁힘 — 아래 참조 |
| 값이 정수 + `label`/`unit`에 개수 단위 | `"4"` + `"단계"` | |
| 값 문자열 안에 숫자+개수 단위가 결합 | `"4단계"`, `"2종"` | `unit`이 비어도 잡음 |
| 값이 없음·무·`-`·`N/A` | `"없음"` | |

치수 어휘: `cm mm m 인치 길이 두께 높이 너비 폭 깊이 지름 둘레`.
개수 단위 어휘: `단계 종 가지 개 컬러 색상 종류 옵션 세트`.

**0값 규칙을 치수로 좁히는 이유:** 식품·화학 카테고리에서 "설탕 0g", "유해물질 0%"는 오히려 핵심 임팩트 수치다. 값만 보고 지우면 정당한 지표를 죽인다. 치수의 0(= 그 부위가 존재하지 않음)만 결정론적으로 걷어내고, 나머지 0값 판단은 C4 프롬프트 규칙(LLM 담당)에 맡긴다.

**항목이 2개 미만이 되면:**
- 최상위 `blocks`에서는 `items: []`로 비운다 → 뒤따르는 `pruneBlocks`의 `isEmptyBlock`이 제거한다.
- `columns.cols` 안에서는 **블록 자체를 배열에서 제거한다.** `pruneBlocks`는 최상위 blocks만 순회하므로(`layout-validator.ts:173-184`) cols 안의 빈 블록은 남고, `validateProLayout`의 `forEachBlock`(`:70-84`)은 cols를 재귀하므로 매번 `empty_block` warning이 찍힌다. `sanitizeStatRows`가 이미 cols를 재귀 중이라 추가 비용은 없다.

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
| 비교 섹션 밖 이미지 슬롯에 `imageRef` 미지정 또는 무명 인덱스 참조 | `option_coverage` | error |

편중 판정에 비율이 아니라 **편차**를 쓴다. "한 옵션이 절반 초과"로 하면 슬롯 3개·옵션 2개처럼 애초에 균등 분배가 불가능한 경우(2:1 = 66%)를 위반으로 잡아 영원히 못 고치는 요구를 만든다. 편차 1 이하 허용은 어떤 슬롯 수에서도 달성 가능하다.

| 슬롯 : 옵션 | 예시 분배 | 편차 | 판정 |
|---|---|---|---|
| 3 : 2 | 2, 1 | 1 | 통과 |
| 5 : 2 | 5, 0 | 5 | 위반 (최선은 3,2 → 편차 1) |
| 6 : 2 | 4, 2 | 2 | 위반 (최선은 3,3 → 편차 0) |
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
opts    = { statHygiene: true, optionNameByImageIndex }
cleaned = sanitizeProLayout(sections, opts).sections
{ violations, isClean } = validateProLayout(cleaned, opts)
!isClean → repairProLayout(cleaned, violations, { …, optionLines }) → sanitizeProLayout(repaired, opts)
```

repair는 1패스만 돈다(기존 동작 유지). 재정화 후에도 편중이 남으면 **경고 로그만 남기고 그대로 반환한다** — 루프를 만들지 않는다. 옵션 편중은 페이지를 못 쓰게 만드는 결함이 아니라 품질 저하이므로, 사용자를 막는 것보다 결과를 주는 편이 낫다.

## 6. 씬 생성 시 색 오염 차단 (`page.tsx:1069-1072`)

현행은 참조 이미지를 2장 보낸다: `[uploadedImageUrls[slot.imageRef], ...uploadedImageUrls].slice(0, 2)`. 옵션 모드에서 이러면 화이트 슬롯에 블랙 사진이 함께 들어가 Gemini가 색을 섞는다.

**옵션 모드에서는 `imageRef`가 가리키는 이미지 1장만 보낸다.** 같은 옵션명을 가진 이미지가 여러 장이면 그중 최대 2장까지 허용한다(각도 참조 이득은 유지하면서 색은 안 섞임). 옵션 모드가 아니면 현행 그대로.

### 6.1 업로드 부분 실패 시 인덱스 시프트 — 선결 과제

`imageRef`는 **업로드 전 `productImages` 인덱스** 기준인데, `uploadedImageUrls`는 실패 건을 걸러내며 인덱스가 당겨진다(`page.tsx:1045-1046`).

```ts
  .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
  .map((r) => r.value);
```

이미지 1(블랙) 업로드가 실패하면 `uploadedImageUrls`는 `[화이트, 블랙2]`가 되고, `imageRef=1`(블랙)이 가리키던 자리에 **블랙2**가 온다 — 우연히 맞는다. 그러나 이미지 0(화이트)이 실패하면 `imageRef=1`이 블랙2를 가리키고 `imageRef=0`은 블랙1을 가리켜, 화이트 슬롯에 블랙이 들어간다. §6의 "옵션 이미지 1장만" 전제가 조용히 깨진다.

지금도 잠재 버그지만 옵션 기능이 이를 **기능 실패로 승격**시킨다. 그래서 자리를 유지한다.

```ts
const uploadedImageUrls: (string | null)[] =
  results.map(r => r.status === 'fulfilled' ? r.value : null);
```

- `imageRef`가 `null` 자리를 가리키면 그 슬롯의 씬 생성을 건너뛴다(현행 실패 폴백과 동일 경로).
- 섹션 조립(`:1126`)에서도 `null`을 걸러 쓴다.
- 옵션 모드에서 하나라도 실패하면 결과 화면에 "일부 이미지 업로드 실패 — 옵션 배분이 정확하지 않을 수 있습니다" 경고를 띄운다.

### 6.2 sceneHint 길이

`sceneHint`에 옵션명을 덧붙인다: `${promptHint} (제품 색상: 화이트)`.

`generate-scene-image`의 스키마는 `sceneHint: z.string().max(600)`(`route.ts:35`)이다. 접미사를 붙인 뒤 **600자로 자른다.** 안 자르면 긴 `promptHint`에서 400이 나고, `page.tsx:1104`의 catch가 조용히 삼켜 그 섹션 이미지만 사라진다.
## 7. 워터마크

전파 경로가 두 갈래다.

```
제미나이 앱 이미지 (✦ 우하단)
   ├─ 상세페이지에 직접 삽입
   └─ AI 씬 생성의 참조로 투입
          → Gemini가 옷 위에 ✦를 그림 (위치 불특정)
```

### 7.1 자동 감지를 하지 않는다 — 실측 근거

당초 설계는 업로드 시점에 ✦를 자동 감지해 인페인팅하는 것이었다. 정답을 아는 이미지 6장으로 검증한 결과 **쓸 수 없는 수준**이라 철회한다.

| 이미지 | 실제 ✦ | 판정 |
|---|---|---|
| `p3.jpg` (업로드 원본, 이 스펙의 동기) | 있음 | **미탐** |
| `l_…818955.png` (원단 접사) | 있음 | 정탐 |
| `wm1.png` (히어로, 반바지 프린트) | 있음 | 정탐 |
| `p1.jpg` (화이트 티셔츠) | 없음 | **오탐** |
| `l_…813676.png` (스플래터 로고) | 없음 | **오탐** |
| `l_…814920.png` (헬스장 씬) | 없음 | **오탐** |

재현율 위주로 임계를 느슨하게 잡은 최선의 설정에서 **TP 2 / FP 3 / FN 1 / TN 0**. 특이도 0%다.

**구조적 원인.** 밝기 median 기준 마스크는 검사 영역에 강한 경계(제품 실루엣, 배경 전환)가 있으면 blob이 ✦가 아니라 경계 전체로 번진다. `p3.jpg`가 정확히 그 경우 — 검은 티셔츠와 베이지 배경이 걸쳐 있어 배경을 통째로 잡는다. 반대로 스플래터 프린트·아령 가장자리는 ✦와 형태로 구분되지 않는다. 연결 성분 분리로 개선해도 미탐은 남고 오탐만 늘었다.

이 정확도로 자동 인페인팅을 붙이면 **깨끗한 제품 사진을 소리 없이 덧칠한다.** 원본 훼손이 워터마크 잔존보다 나쁘다. 경고 배지로 낮춰도 마찬가지다 — 정상 이미지 3장 전부에 켜지고 진짜는 놓치는 표시등은 신호가 아니라 소음이다.

**결정:** 자동 감지·자동 편집을 모두 제거하고, 사용자가 눈으로 보고 지우는 수동 경로만 남긴다.

### 7.2 기존 자동 제거 코드 철거

`removeGeminiWatermark` 호출을 세 곳에서 제거한다.

| 파일 | 위치 |
|---|---|
| `src/app/api/listing/upload-image/route.ts` | `:284` 부근 |
| `src/app/api/image/upload-ai/route.ts` | `:151` |
| `src/app/api/ai/generate-detail-html/route.ts` | `:204` 부근 |

호출부를 걷어내면 `src/lib/image/watermark-removal.ts`를 참조하는 곳이 없다. 모듈과 테스트(`src/__tests__/lib/watermark-removal.test.ts`)를 함께 삭제한다.

부수 효과 두 가지가 따라온다.

- **곁다리 버그가 소멸한다.** `removeWithGemini`는 JPEG를 반환하는데 `upload-ai`는 `mimeType`을 원본값으로 유지해 `.png` 이름으로 올렸다. 경로 자체가 없어지므로 별도 수정이 필요 없다.
- **업로드가 빨라지고 싸진다.** 감지가 걸릴 때마다 돌던 Gemini 인페인팅 호출이 사라진다.

### 7.3 수동 제거 도구 연결 (주력)

기존 자산을 재사용한다: `ImageCleanupModal`(`mode='watermark'`) + `/api/ai/remove-watermark-region`. 드래그로 영역을 지정하면 그 부분만 인페인팅한다.

**노출 방식:** PRO 업로드 화면의 제품 이미지 썸네일마다 ✦ 버튼을 **상시 노출**한다. 감지기가 없으니 조건부로 띄울 근거가 없고, 사용자는 자기 이미지에 워터마크가 있는지 이미 안다.

```
제품 이미지  ★ 상세페이지에 삽입됩니다
┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
│ ✦ ×│ │ ✦ ×│ │ ✦ ×│ │ ✦ ×│
└─────┘ └─────┘ └─────┘ └─────┘
[화이트] [블랙 ] [블랙 ] [     ]
   ✦ = 워터마크 제거   × = 삭제
```

**제약과 해법.** `remove-watermark-region`은 `imageUrl`이 Supabase Storage URL일 것을 요구한다(`route.ts:18`, SSRF 방어). PRO 업로드 화면의 제품 이미지는 아직 업로드 전 `File`이고, 업로드는 결과 화면(`page.tsx:1038`)에서야 일어난다. 그런데 워터마크는 **레이아웃 생성 전에** 지워야 한다 — 그래야 참조 이미지로 투입될 때 이미 깨끗해 §7의 두 번째 전파 경로가 막힌다.

임시 업로드 후 URL로 호출하면 정리 안 된 원본이 Storage에 남고 왕복이 한 번 더 든다. 대신 **base64 입력 경로를 추가한다.** 클라이언트가 보낸 base64는 애초에 SSRF 대상이 아니라 보안 성격이 다르지 않다.

`remove-watermark-region` 요청 스키마:

```
imageUrl (Supabase URL)        ─┐
                                ├─ 둘 중 하나 필수
imageBase64 + mimeType         ─┘
region { x, y, width, height }    (0~1 정규화, 현행 유지)
```

SSRF 검사는 `imageUrl` 분기에만 적용한다. 응답 형식(`{ imageBase64, mimeType }`)은 그대로다.

**`ImageCleanupModal` 확장** (기존 호출부 무영향, 모두 optional):

```ts
interface ImageCleanupModalProps {
  imageUrl: string;              // 표시용. blob: URL 허용
  imageBase64?: string;          // 있으면 API 호출에 URL 대신 사용
  mimeType?: string;
  onReplace: (newUrl: string) => void;
  onResultBase64?: (base64: string, mimeType: string) => void; // 있으면 업로드 생략
  onAdd: (newUrl: string) => void;
  onClose: () => void;
  canAdd: boolean;
  mode?: 'chinese' | 'watermark';
}
```

`onResultBase64`가 있으면 `uploadResult()`(`ImageCleanupModal.tsx:111`)를 건너뛰고 콜백만 호출한다. PRO 화면은 `File[]`로 상태를 들고 있으므로, 결과를 `File`로 되돌려 `productImages[i]`를 교체하면 이후 파이프라인이 그대로 돈다. URL/File 이중 관리를 만들지 않는다.

**전달 크기.** ✦ 버튼을 누르면 해당 파일을 최대 2000px JPEG로 다운스케일해 모달에 넘긴다 — 서버가 어차피 `MAX_DIM = 2000`으로 줄이므로(`remove-watermark-region/route.ts:20`) 추가 손실이 없고, base64 요청 본문이 Vercel 4.5MB 제한에 걸리지 않는다. 기존 `fileToDownscaledBase64`(`page.tsx:130`)에 최대 변 인자를 넘겨 재사용한다.

교체된 파일은 `optionNames[i]`를 유지한다(§3의 인덱스 정합).

### 7.4 생성 프롬프트에서 금지

참조가 이미 오염된 경우를 대비해, 모든 생성 경로의 프롬프트 꼬리인 `PRODUCT_FIDELITY_INSTRUCTION`(`generate-scene-image/route.ts:65`)과 `SCENE_PROMPT_SYSTEM`의 규칙에 추가한다:

> Do NOT render any four-pointed star, sparkle, glitter, or diamond glyph anywhere in the image — not on the garment, product surface, or background. If such a mark appears in the reference image, treat it as an artifact and omit it.

`BACKGROUND_PROMPT_SYSTEM`(`:81`)의 "No text, logos, watermarks" 목록에도 sparkle을 추가한다.

자동 감지가 없는 지금, 이 프롬프트 규칙이 **전파 경로를 막는 유일한 코드 레벨 방어**다.

### 7.4.1 선결 리팩터 — 중복 상수 제거

`PRODUCT_FIDELITY_INSTRUCTION`(`:65`)과 **동일한 문자열이 `SCENE_PROMPT_SYSTEM`(`:55`) 안에 하드코딩**돼 있다("MUST end with this exact instruction: …"). 그리고 `:510`이 그 상수로 스트립한다:

```ts
const bgPrompt = claudePrompt.replace(PRODUCT_FIDELITY_INSTRUCTION, '').trim();
```

상수(`:65`)에만 문구를 추가하면 Claude는 `:55`의 **옛 문자열**을 그대로 에코하고, `:510`의 `replace`는 매칭에 실패해 no-op이 된다. 그러면 편집+합성 경로의 배경 프롬프트에 제품 충실도 지시가 남아 **배경에 제품이 그려지는 회귀**가 난다.

그래서 §7.4의 문구 추가에 앞서 `:55`의 내장 사본을 상수 보간으로 바꾼다:

```ts
const SCENE_PROMPT_SYSTEM = `…
- CRITICAL: The generated prompt MUST end with this exact instruction: "${PRODUCT_FIDELITY_INSTRUCTION}"
…`;
```

`PRODUCT_FIDELITY_INSTRUCTION` 선언을 `SCENE_PROMPT_SYSTEM`보다 위로 올려야 한다(현재는 아래에 있다).

### 7.5 남는 한계

- 사용자가 워터마크를 못 보고 넘기면 그대로 상세페이지에 나간다. 자동 방어가 없다는 뜻이다.
- 이미 ✦가 옷 위에 그려져 나온 생성 이미지는 §7.4 프롬프트로 예방할 뿐, 이미 만들어진 것은 수동 도구로 지워야 한다.

## 8. 부정적 이미지 금지 — 하류 (`generate-scene-image/route.ts`)

§4.3의 D3가 상류(promptHint) 방어라면, 여기는 안전망이다. `PRODUCT_FIDELITY_INSTRUCTION`에 추가:

> If a person appears, they must look confident, comfortable, and at ease — relaxed or lightly positive expression, upright active posture. No grimacing, exhaustion, hunching over, hands on knees, slumping, distress, or discomfort.

`SCENE_PROMPT_SYSTEM`의 Rules에도 같은 취지의 한 줄을 넣어 Claude가 프롬프트를 쓸 때부터 반영되게 한다. `BACKGROUND_PROMPT_SYSTEM`은 인물이 등장하지 않으므로(`:77` "NO people") 해당 없다.

## 9. 테스트

| 파일 | 검증 |
|---|---|
| `src/__tests__/lib/detail-page/product-options.test.ts` (신규) | `deriveOptions` 중복·공백 처리, `uniqueOptionNames` 순서, `collectOptionCoverage`가 비교 섹션을 제외하는지, 미지정 슬롯 집계 |
| `src/__tests__/lib/detail-page/layout-validator.test.ts` (추가) | stat 위생 4규칙, 2개 미만 시 블록 삭제, `columns.cols` 재귀, `statHygiene` 미지정 시 미수행. 옵션 커버리지 위반 4종, `opts` 없으면 옵션 검사 미수행 |
| `src/__tests__/api/generate-pro-layout.test.ts` (신규) | `productOptions` 전달 시 유저 프롬프트에 옵션 줄 포함, 미전달 시 기존 동작 |
| `src/__tests__/api/ai/remove-watermark-region.test.ts` (신규) | `imageBase64` 분기 동작, `imageUrl` 분기의 SSRF 검사 유지, 둘 다 없으면 400 |

### 9.1 기존 워터마크 테스트 삭제

`src/__tests__/lib/watermark-removal.test.ts`는 검증 대상 모듈과 함께 삭제한다(§7.2). 이 파일은 `hasWatermarkCandidate`를 import하고(`:3`) `removeGeminiWatermark`가 입력 Buffer를 그대로 반환한다고 단언하는데(`:78`·`:130`·`:148`·`:157`), 모듈이 사라지므로 남길 이유가 없다. "Stability AI 인페인팅 경로" describe(`:96-170`)는 현재 Gemini 구현과 이미 어긋난 스테일 테스트이기도 하다.

### 9.2 실행

`npx vitest run`을 인자 없이 돌리면 라이브러리 테스트까지 돌아 무관한 선재 실패가 섞인다. 회귀 판단은 위 경로를 지정해서 한다.

## 10. 손대는 파일

| 파일 | 내용 |
|---|---|
| `src/lib/detail-page/product-options.ts` | 신규 — 옵션 도출·커버리지 집계 (순수) |
| `src/lib/image/watermark-removal.ts` | **삭제** — 자동 감지 철회 (§7.1) |
| `src/__tests__/lib/watermark-removal.test.ts` | **삭제** — 대상 모듈과 함께 |
| `src/lib/detail-page/layout-validator.ts` | stat 위생 + 옵션 커버리지 |
| `src/lib/ai/repair-pro-layout.ts` | 옵션 컨텍스트 전달 |
| `src/app/api/ai/generate-pro-layout/system-prompt.ts` | D1 교체, C4 강화, D3 신규 |
| `src/app/api/ai/generate-pro-layout/route.ts` | 스키마·프롬프트·검증 결선 |
| `src/app/api/ai/generate-scene-image/route.ts` | 중복 상수 제거(선결) + 스파클 금지 + 긍정 감정 규칙 + sceneHint 절단 |
| `src/app/listing/[id]/detail-maker-pro/page.tsx` | 옵션명 UI, ✦ 버튼, 업로드 자리 유지, 씬 참조 선택 |
| `src/app/api/image/upload-ai/route.ts` | `removeGeminiWatermark` 호출 제거 |
| `src/app/api/listing/upload-image/route.ts` | `removeGeminiWatermark` 호출 제거 |
| `src/app/api/ai/generate-detail-html/route.ts` | `removeGeminiWatermark` 호출 제거 |
| `src/app/api/ai/remove-watermark-region/route.ts` | base64 입력 분기 |
| `src/components/common/ImageCleanupModal.tsx` | base64 입출력 optional prop |
| `scripts/check-gemini-watermark.mjs` | 이미 추가됨 — Gemini API 티어 판별 |

## 11. 범위 밖

- 옵션별로 상세페이지를 **여러 장** 뽑는 것 (한 페이지 안 고른 노출로 결정)
- 이미 Storage에 올라간 워터마크 이미지의 소급 정리 (필요 시 일회성 스크립트로 별도 처리)
- `pruneBlocks`가 `columns.cols`를 재귀하지 않는 기존 한계 (stat 위생만 재귀 처리)
