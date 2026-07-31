# PRO compare 대비 이미지 (compare_pair) 설계 문서

> 작성일: 2026-07-26
> 상태: 승인됨 (구현 대기)
> 선행: 스토리라인 엔진(1단계-A) 완료 — `compare` 비트와 `columns` 2단 구조가 이미 생성된다
> 큰 그림: "PRO 상세페이지를 외주업체 수준으로" 3단계 중 **2단계(이미지 소스 라우팅)의 첫 조각**

## 0. 맥락

1단계-A로 `compare` 섹션이 실제로 생성되기 시작했다. 라비오라 워시오프 팩 페이지의 "관리 방식의 차이" 섹션이 그것이다 — `columns` 2단에 좌측 "기존 홈케어"(스크럽·마스크시트를 순서대로, 시트 붙이면 움직이기 불편, 제품이 많아 자리 차지), 우측 "레몬 허니 워시오프 팩"(한 튜브에서 해결, 바른 채로 샤워 가능).

**그런데 텍스트만 있다.** 대비의 근거가 글로만 제시된다.

이 문서는 그 섹션에 **좌우 대비 이미지 한 장**을 넣는다.

## 1. 확정된 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 대비 대상 | **방식의 대비** (여러 제품·여러 단계 vs 하나로 해결) | 효과 대비(before/after 피부)는 화장품법·표시광고법상 임상 근거 없이 쓸 수 없다. 방식 대비는 상황 연출이라 실증 부담이 낮고, 기존 compare 카피와 정확히 맞아떨어진다 |
| 이미지 형태 | **좌우 결합 한 장** | 390px 폭에서 `columns` 각 칸은 175px. 두 이미지를 각 칸에 넣으면 너무 작다. 한 장 전폭이 낫다 |
| 좌측 내용 | **무브랜드 제품 허용** | 제품 없이 상황만 보여주면 "제품이 많아 자리를 차지함" 같은 카피를 이미지로 받을 수 없다 |
| 슬롯 구조 | **슬롯 1개 + 힌트 2개** | 슬롯 2개를 두면 `normalizeImageBlocks`가 두 번째를 무음 드롭한다(그 파일은 슬롯↔블록 정합성 보장이 목적인데 어긋나는 케이스를 만든다) |
| 합성 위치 | **새 엔드포인트** | Sharp는 서버 전용. `generate-scene-image`(607줄)는 이미 프롬프트 5개·누끼 검증·합성을 다 담고 있어 더 키우지 않는다 |
| 조명·색온도 | **양쪽 통일, 대비는 정리도로만** | 시험 §2.4 참조 |

## 2. 시험 결과 (구현 전 검증)

Gemini `gemini-2.5-flash-image`로 **24장을 생성해** 프롬프트를 확정했다. 이 절의 결과가 §3 설계의 근거다.

### 2.1 무브랜드 안정성 — 위반 0건

| 카테고리 | 생성 | 로고·글자·라벨 |
|---|---|---|
| 화장품 (무지 용기) | 6장 | 0건 |
| 의류 (무지 티셔츠) | 3장 | 0건 |
| 식품 (크라프트 파우치·무지 박스) | 3장 | 0건 |
| 어질러짐 변형 | 6장 | 0건 |
| 톤 통일 | 4장 | 0건 |

대문자 `CRITICAL` + 금지 항목 열거 방식이 카테고리와 무관하게 작동했다. **식품이 가장 어려울 것으로 예상했으나** 크라프트 파우치·무지 박스·유리병이라는 실제 존재하는 포장 형태로 우회했다. 의류도 프린트 없는 무지 티셔츠로 처리됐다.

### 2.2 "어질러짐" 표현 — 부정 지시가 핵심

세 변형을 각 2회 비교했다.

| 변형 | 내용 | 결과 |
|---|---|---|
| B | `"commercial photography"` 제거 + `"candid unstaged snapshot"` | **개선 미미.** 여전히 나란히 정돈됨 |
| C | `"NOT a tidy product lineup. NOT evenly spaced. NOT symmetrical."` 추가 | **겹침과 층이 생겼다.** 튜브가 눕혀져 가로로 걸치고 자가 기울어 얹힘 |
| D | B + C + 생활 흔적(흘린 크림, 열린 자, 따로 놓인 뚜껑, 물방울, 쓴 화장솜) | **최고** |

**AI가 수렴하는 패턴을 명시적으로 금지해야 벗어난다.** `"candid, NOT a product photo"`라는 성격 지시만으로는 부족했고, `NOT ~` 부정문이 들어간 C부터 구도가 바뀌었다. 그리고 물건 배치보다 **생활 흔적 디테일이 "쓰던 공간"을 만든다.**

### 2.3 배치 — 중앙 크롭 후 좌우 결합

| 배치 | 크기 | 판정 |
|---|---|---|
| 좌우, 정사각 그대로 | 390×195 | 메시지는 읽히나 세부가 뭉개진다. 우측 튜브를 수건과 구분 못 했다 |
| **좌우, 세로 크롭(1024→760)** | **390×262** | **채택.** 용기 개수·눕힘·흘린 크림이 선명하고 우측 튜브도 명확 |
| 세로 스택 | 390×782 | 가장 선명하나 높이를 3배 쓰고, 스크롤해야 하므로 "한눈에 대비"가 약해진다 |

Gemini는 1:1로 생성하므로 크롭이 필요하다. 크롭 폭 760/1024 = 74%, 최종 비율 약 3:2.

### 2.4 조명·색온도 — 통일이 낫다

처음에는 좌측을 `"cool overcast daylight, desaturated"`, 우측을 `"warm soft morning light"`로 **의도적으로 다르게** 했다. 대비는 강했지만 한 장으로 붙이니 **두 사진이 다른 날 찍힌 것처럼** 보였다.

양쪽에 같은 톤 지시(`warm_cream` 팔레트)를 넣고 대비를 **정리도로만** 만든 결과가 명확히 나았다. 같은 공간에서 찍은 것처럼 보이면서도 "많음 vs 하나"는 그대로 전달된다.

### 2.5 팔레트를 생성 시점에 알 수 있다

`DEFAULT_THEME.palette = 'warm_cream'`, `accentColor = '#7A5C10'`이고 **PRO 경로에는 팔레트 지정 코드가 없다.** 즉 PRO 상세페이지는 항상 `warm_cream`을 쓴다.

> 이는 적응형 보정(1단계-B)에서 막혔던 것과 대조적이다. 그쪽은 draft 저장 시 `theme: {}`를 보내 보정 시점에 톤을 알 수 없었다. 이미지 생성은 `palette-config.ts`의 상수를 직접 읽으면 되므로 문제가 없다.

## 3. 설계

### ① 슬롯 타입 `compare_pair`

`slotType`이 `z.string()`이라 새 값 추가에 스키마 변경이 필요 없다. `imageSlots` 스키마에 필드 하나만 더한다:

```ts
imageSlots: z.array(z.object({
  slotType: z.string(),
  promptHint: z.string().optional(),   // 우측: 우리 제품이 놓일 정돈된 씬
  beforeHint: z.string().optional(),   // 좌측: 기존 방식의 어질러진 씬
  imageRef: z.number().optional(),
})).optional()
```

**두 힌트의 성격이 다른 것이 설계의 핵심이다.** 좌측은 제품이 없으니 씬 전체를 직접 그린다. 우측은 우리 제품이므로 기존 합성 경로(누끼 + 배경)를 그대로 쓴다.

`GeneratedSection`(page.tsx)의 `imageSlots` 타입에도 `beforeHint`를 추가한다.

### ② 프롬프트 상수 (`compare-image-prompts.ts` 신설)

시험에서 검증된 블록을 그대로 상수화한다. **카테고리별로 금지 항목이 다르므로 분기한다** — 검증도 카테고리별 문구로 했다.

```ts
/** 공통 시점 — 좌우가 같아야 대비가 성립한다 (§2.4) */
const VIEW =
  'Eye-level, straight-on view of the surface, camera at the same distance. ' +
  'No people, no hands. No text, no watermarks, no letters anywhere in the image.';

/**
 * 무브랜드 강제. 시험 24장에서 위반 0건 (§2.1).
 * 대문자 CRITICAL + 금지 항목 열거가 카테고리 무관하게 작동한다.
 * 이 문구를 약화시키면 재검증이 필요하다.
 */
const UNBRANDED: Record<'apparel' | 'food' | 'generic', string> = {
  apparel:
    'CRITICAL: every garment is COMPLETELY UNBRANDED — no printed graphics, no logos, no text, ' +
    'no chest prints, no visible tags or labels of any kind. Plain solid fabric only. ' +
    'They must not resemble any real brand.',
  food:
    'CRITICAL: every package is COMPLETELY UNBRANDED — no logos, no text, no labels, ' +
    'no nutrition panels, no printed graphics or barcodes of any kind. Plain matte kraft, ' +
    'off-white and clear surfaces only. They must not resemble any real brand or product.',
  generic:
    'CRITICAL: every container is COMPLETELY UNBRANDED — no logos, no text, no labels, no printed ' +
    'marks or symbols of any kind. Plain matte surfaces only. ' +
    'They must not resemble any real product or brand.',
};

/**
 * 어질러짐 강제. 이 부정문이 없으면 AI가 정돈된 목업으로 수렴한다 (§2.2).
 * "candid, NOT a product photo" 같은 성격 지시만으로는 부족했다.
 */
const CLUTTER =
  'NOT a tidy product lineup. NOT evenly spaced. NOT symmetrical. The items overlap and crowd ' +
  'each other at random angles, stacked in two loose layers with no free surface left. ' +
  'Candid unstaged snapshot of a real lived-in space, NOT a product photo.';
```

`productInfo.category`(`'basic'|'fashion'|'living'|'food'`)를 위 세 키로 매핑한다: `fashion → apparel`, `food → food`, 나머지 → `generic`.

### ③ 팔레트 톤 매핑

`Record<PaletteName, string>`으로 정의해 **타입이 완전성을 강제하게 한다** — `palette-config.ts`에 팔레트가 추가되면 컴파일 에러로 누락이 잡힌다.

```ts
const PALETTE_TONE: Record<PaletteName, string> = {
  warm_cream: 'warm off-white and cream surfaces with muted antique-gold and soft warm-brown undertones',
  cool_white: 'clean cool-white surfaces with restrained slate-blue accents',
  // ... 9종 전부
};

function toneInstruction(palette: PaletteName): string {
  return `Color grading: ${PALETTE_TONE[palette]}. Soft daylight from the left, gentle shadows, ` +
    'consistent white balance between both halves.';
}
```

현재 PRO는 항상 `DEFAULT_THEME.palette`(`warm_cream`)를 쓴다(§2.5). 팔레트 선택 기능이 생기면 호출부에서 값만 바꾸면 된다.

### ④ 새 엔드포인트 `POST /api/ai/generate-compare-image`

```ts
입력: {
  beforeHint: string,          // 좌측 씬 = 슬롯의 beforeHint
  afterHint: string,           // 우측 배경 = 슬롯의 promptHint
  productImageUrls: string[],  // 우측 합성용 제품 참조 (최대 3)
  category?: 'basic'|'fashion'|'living'|'food',
  productName?: string,
}
출력: { success: true, url } | { success: false, error }
```

> **이름이 다른 이유:** 슬롯 스키마는 기존 `promptHint`를 그대로 쓴다(다른 슬롯 타입과 공유하는 필드라 바꾸면 파급이 크다). 엔드포인트는 좌우 대응이 한눈에 보이도록 `beforeHint`/`afterHint`로 받는다. 결선하는 `page.tsx`에서 `promptHint → afterHint`로 매핑한다.

처리 순서:

1. **좌측** — Gemini로 씬 전체 생성. 프롬프트 = `beforeHint` + `UNBRANDED[cat]` + `CLUTTER` + `toneInstruction` + `VIEW`
2. **우측** — 기존 합성 경로 재사용: 제품 누끼 → 배경만 생성(`afterHint` + `toneInstruction` + `VIEW` + 제품 제외 지시) → Sharp 합성
3. **결합** — 양쪽을 세로 크롭(폭 74%) 후 좌우 배치, 중앙 4px 흰 간격
4. Storage 업로드 후 URL 반환

`maxDuration = 120` (Gemini 2회 + rembg 1회 + Sharp).

**라벨을 이미지에 태우지 않는다.** 태우면 편집이 불가능해지고, "기존 홈케어" / "우리 제품" 배지는 `columns`가 이미 렌더한다.

### ⑤ 프롬프트 규칙 (N3 확장)

`CLAUDE_SYSTEM`의 N3에 추가한다:

> compare 섹션에는 `compare_pair` 슬롯을 1개 두고 두 힌트를 채우세요.
> - `beforeHint` — 기존 방식의 어질러진 씬. **로고·상표·글자가 없는 무지 용기/의류/포장**만 묘사하세요. 특정 브랜드로 읽힐 형태·색 조합을 쓰지 마세요.
> - `promptHint` — 우리 제품이 놓일 정돈된 씬의 배경. 제품 자체는 묘사하지 마세요(실제 제품 사진이 합성됩니다).
> 두 씬은 **같은 장소·같은 시점**이어야 합니다. 차이는 물건의 개수와 정리 상태로만 만드세요.

N3가 이미 카피에 "특정 경쟁사 지목 금지"를 걸고 있으므로, 이미지에서 그것을 우회하지 못하게 막는 것이다.

### ⑥ 결선 (`page.tsx`)

`isGenSlot`에 `compare_pair`를 추가하고, 그 슬롯일 때만 새 엔드포인트로 보낸다. 다른 슬롯은 기존 경로 그대로다. 결과 URL은 해당 섹션 슬롯 0에 들어가고 image 블록 1개가 그린다.

`beforeHint`가 없으면 **호출하지 않고 건너뛴다** — 좌측 없이 우측만 만들면 대비가 아니라 그냥 제품 사진이다.

### ⑦ 검증은 강제하지 않는다

`narrative.ts`의 compare 구조 조건은 `columns` 2단 그대로 둔다. **`compare_pair` 슬롯을 필수로 만들지 않는다.** 이미지 생성이 실패해도 텍스트 대비는 유효하고, 강제하면 실패가 error로 번져 repair를 유발한다.

### ⑧ 실패 처리

| 실패 지점 | 처리 |
|---|---|
| `beforeHint` 없음 | 호출 자체를 건너뛴다 (⑥) |
| 좌측 생성 실패 | 전체 포기. 이미지 없이 섹션 렌더 |
| 누끼 실패 | 우측을 비합성으로 (기존 폴백 재사용) |
| 우측 생성 실패 | 전체 포기 |
| 결합 실패 | 이미지 없이 진행 |

기존 씬 생성이 실패를 조용히 삼키고 이미지 없이 진행하는 패턴과 같다.

## 4. 범위 밖

- **`model_wearing` 인물 씬** — 같은 2단계지만 독립적이다. 민소매 티셔츠에서 처음 지적된 "모델 착용컷 없음"이 그쪽 과제다
- **효과 대비(before/after 피부·착용 전후)** — 실증 근거가 필요한 영역
- **좌측 이미지의 사용자 촬영 대체** — 3단계(촬영 제안 루프)
- **팔레트 선택 UI** — 지금은 `DEFAULT_THEME` 고정

## 5. 테스트

- 카테고리 → `UNBRANDED` 키 매핑 (`fashion→apparel`, `food→food`, `basic`/`living`→`generic`)
- `PALETTE_TONE`이 `PaletteName` 전체를 덮는지 (타입으로 강제되지만 런타임 확인)
- 크롭 결합: 입력 1024×1024 두 장 → 출력 폭 `760*2+4`, 높이 1024
- 결합 시 좌우 순서가 뒤바뀌지 않는지
- `beforeHint` 누락 시 호출하지 않는지 (결선 로직)
- 각 실패 지점의 폴백

프롬프트 문자열 자체를 단언하는 테스트는 두지 않는다 — 문구를 다듬을 때마다 깨지는 change-detector가 된다. 대신 `UNBRANDED`·`CLUTTER`가 최종 프롬프트에 **포함되는지**만 확인한다.

## 6. 리스크

1. **좌측이 브랜드처럼 보일 위험** — 시험 24장에서 위반 0건이었으나 표본이 작다. 각 프롬프트 변형은 2~6회만 돌렸다. 실사용에서 위반이 나오면 vision 자동 검증(`generate-scene-image`의 `backgroundContainsProduct` 패턴)을 붙이는 것이 다음 수단이다
2. **개수가 적게 읽힐 때가 있다** — `"seven containers"`를 명시해도 5~6개로 보이는 결과가 있었다. `"no free surface left"`를 더 밀어야 할 수 있다
3. **우측 배경에 예상 밖 요소** — 시험에서 `"nothing else except a neatly folded towel"`이라 했는데 벽에 액자가 생겼다. 배경 제약을 한 줄 더할 여지가 있다
4. **생성 시간·비용 증가** — compare 섹션당 Gemini 2회 + rembg 1회가 추가된다. 기존 씬 생성과 병렬로 돌지만 `maxDuration` 여유를 구현 시 확인해야 한다
5. **Claude가 두 힌트를 제대로 채울지** — `beforeHint`를 빼먹으면 이미지가 아예 안 만들어진다. 실물 확인이 필요하다
6. **"어질러짐"이 카테고리마다 다르게 읽힐 수 있다** — 화장품·의류·식품에서 확인했으나 가전·도구처럼 형태가 브랜드 각인과 얽힌 카테고리는 미검증이다
