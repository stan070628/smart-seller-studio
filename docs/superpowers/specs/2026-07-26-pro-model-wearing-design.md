# PRO 인물 착용컷 (model_wearing) 설계 문서

> 작성일: 2026-07-26
> 상태: 승인됨 (구현 대기)
> 선행: 스토리라인 엔진(1단계-A) 완료 — `beat` 필드가 검증되며 생성된다
> 큰 그림: "PRO 상세페이지를 외주업체 수준으로" 3단계 중 **2단계(이미지 소스 라우팅)**. `compare_pair`와 같은 층이며 독립적이다

## 0. 왜 이것부터였나

이 작업이 세션 전체의 출발점이었다. 사용자의 첫 지적:

> 제품을 입고 있는 모델 사진, 휴가씬, 해변씬, 운동씬 등 제품의 특성에 맞는 이미지가 하나도 없어

원인은 우연이 아니라 **구조적 차단**이었다.

`flux_lifestyle` 슬롯은 `generate-scene-image`의 `sectionType: 'lifestyle'`로 라우팅되고, `lifestyle`은 `COMPOSITE_SECTIONS`에 속한다. 그 경로는 제품 누끼를 오려내고 **빈 배경만** Gemini로 만든 뒤 Sharp로 합성한다. 그리고 그 배경 프롬프트에는 이렇게 박혀 있다:

```
Absolutely NO products, merchandise, packaging... NO people, hands, or body parts.
```

즉 Claude가 `promptHint`에 `"블랙 민소매 등판 프린트가 보이도록 뒤돌아 걷는 20대 남성"`이라고 써도 **파이프라인이 그것을 무시한다.** 라비오라 페이지에서 실제로 확인됐다.

## 1. 첫 번째 원칙

이 문서의 모든 판단 기준은 **제품을 잘 팔 수 있게 만드는 것**이다.

세션 중 사용자가 명시했다. 그전까지 이 설계는 리스크 회피 쪽으로 계속 좁아지고 있었다 — "얼굴 없는 크롭으로 고정", "동적 포즈 포기", "제품 변형 위험하니 병치로 완화". 사용자는 AI 생성 얼굴도 "Claude가 필요하다고 판단하면 나왔으면 좋겠다"고 했다.

**얼굴은 판매에 유리한 요소다.** 표정이 "이 옷 입으면 이런 기분"을 전달하고, 또래 모델이 타깃 공감을 만들고, 실제 사람이 입은 모습이 신뢰를 준다. 리스크를 이유로 빼는 것이 기본값이 아니다.

## 2. 시험 결과 (구현 전 검증)

Gemini `gemini-2.5-flash-image`로 **35장을 생성해** 프롬프트를 확정했다. 이 절이 §3 설계의 근거다.

### 2.1 작동하는 것

| 항목 | 결과 |
|---|---|
| 제품 충실도 | **예상보다 훨씬 좋다.** 등판 스플래터 입자 배치, 젬스톤 로고 형태, 가슴의 작은 `Columbia` 텍스트까지 재현 |
| 얼굴 없는 크롭 | 정적 포즈에서 안정적 (팔이 어깨 아래일 때) |
| 얼굴 포함 | 프롬프트를 강화하면 나온다. 초기 실패는 모델 제약이 아니라 프롬프트 문제였다 |
| 색 보존 | 중립 조명 강제로 해결 |
| 손 아티팩트 | 정적 포즈에서는 나오지 않는다 |

**초기 리스크 판단 두 개가 뒤집혔다.** 세션 초반에 "Gemini가 스플래터 프린트를 원본대로 못 그린다"와 "손·해부학 아티팩트를 근절할 수 없다"고 적었으나, 둘 다 조건부로만 참이었다.

### 2.2 실패하는 것 — 프롬프트로 막을 수 없다

| 조건 | 증상 | 재현 |
|---|---|---|
| **동적 포즈** (러닝) | 주먹이 덩어리처럼 뭉개진다. `"BOTH HANDS FALL OUTSIDE THE FRAME"`을 대문자로 넣어도 손이 프레임에 남는다 | 4/4 |
| **팔 올림** (스트레칭) | 프레임 기준점이 위로 밀려 크롭이 깨지고 얼굴이 노출된다. 정작 요청한 손은 프레임 밖으로 잘린다 | 2/2 |
| **골든아워 조명** | 화이트 민소매가 살구색·연분홍으로 렌더된다 | 2/2 (수정 후 0/2) |

색 왜곡은 **상품 오인** 문제다. 구매자가 받은 물건과 페이지의 색이 다르면 `progress_bar` 지어낸 수치와 같은 종류의 리스크다. 중립 조명 지시로 해결됐다.

동적 포즈는 해결하지 못했다. **정적 착용컷만 허용한다.**

### 2.3 부정문이 결정적이다 — 세 번 반복된 패턴

시험 전체에서 같은 패턴이 세 번 나왔다. **AI가 수렴하는 기본값은 긍정 지시로 벗어나지 않는다. 명시적으로 배제해야 한다.**

| 원하는 것 | 긍정 지시만 | 부정문 추가 후 |
|---|---|---|
| 어질러진 세면대 (`compare_pair`) | 정돈된 목업으로 수렴 | `NOT a tidy product lineup. NOT evenly spaced.` → 겹침 발생 |
| 제품 색 보존 | `"accurate color"`로 부족 | `NOT golden hour, NOT sunset, NOT warm color cast` → 화이트 유지 |
| 한국인 모델 | `"Korean"`만으로는 범아시아 평균 | `not a Western or Chinese catalog` → 한국 화보 전형 |

이 원칙을 프롬프트 상수 파일 주석에 남긴다.

### 2.4 모델 세팅

`"East Asian man"`으로 시작했으나 중국인처럼 보인다는 지적을 받았다. 세 변형을 비교했다.

| 변형 | 결과 |
|---|---|
| `"Korean man"` 단순 교체 | 개선되나 애매하다. 나이가 있어 보이고 화보 느낌이 약하다 |
| **한국 화보 맥락 + 스타일링 명시** | **한국 남성 모델 전형.** 소프트 레이어드 헤어, 20대 후반~30대 초 |
| 여성 버전 | 긴 생머리, 자연스러운 메이크업. 한국 여성 모델 느낌 |

### 2.5 남는 한계

- **스파클 글리프**가 지시에도 간헐적으로 옷에 나타난다 (12장 중 2장). 기존 코드에 `NO SPARKLE MARKS` 지시가 이미 있는데도 그렇다(커밋 `792d74c4`가 추가한 것이니 알려진 문제다). 실제 상품에 없는 장식이 그려지는 것이므로 색 왜곡과 같은 종류의 오인이다
- 각 프롬프트 변형은 **2회씩** 돌렸다. 표본이 작다

## 3. 설계

### ① 슬롯 타입 `model_wearing` → `sectionType: 'wearing'`

`slotType`이 `z.string()`이라 새 값 추가에 스키마 변경이 필요 없다.

핵심은 **`wearing`을 `COMPOSITE_SECTIONS`에 넣지 않는 것**이다. 그러면 자동으로 비합성 경로(제품 참조를 Gemini에 직접 전달)를 탄다. 기존 `lifestyle`·`detail`·`feature` 합성 경로는 코드가 바뀌지 않는다.

```ts
// generate-scene-image/route.ts
const COMPOSITE_SECTIONS = new Set<string>(['lifestyle', 'detail', 'feature']); // wearing 제외
sectionType: z.enum(['hero', 'lifestyle', 'detail', 'feature', 'wearing']),
```

### ② 인물 수위를 `beat`로 정한다

스토리라인 엔진이 이미 각 섹션에 `beat`를 부여하므로 그것을 기준으로 삼는다. 규칙이 단순하고, "왜 이 씬에 얼굴이 있나"를 나중에 추적할 수 있다.

| beat | 수위 | 이유 |
|---|---|---|
| `hook` | **얼굴** | 첫 화면. 표정이 후킹과 감정 이입을 만든다 |
| `solution` | **얼굴** | `problem`은 D3 규칙상 인물을 쓸 수 없다("문제 상황은 카피로 말한다"). 글로 불편을 말하고 여기서 편안한 표정을 보여주는 대비가 강하다 |
| `usecase` | **얼굴** | 상황·분위기 전달 |
| `detail` | **크롭** | 시선이 옷에 집중된다. 핏·암홀·마감 전달 |
| `evidence` | **크롭** | 관찰 가능한 근거 |
| `compare` | — | `compare_pair` 슬롯이 담당 |
| `option` | — | `product_nukki` |
| `assure` | — | 인물 없음 |

**이것은 기본값이며 검증으로 강제하지 않는다.** 위생용품·속옷·의료기기는 `hook`에도 얼굴이 부적절할 수 있고, 향수·액세서리는 `detail`에도 얼굴이 필요할 수 있다. `narrative` 검증에 "hook인데 얼굴이 아니다" 같은 조건을 넣으면 Claude의 판단 여지가 사라지고 어긋날 때마다 repair가 돈다.

### ③ 최소 요건: 얼굴 1장 + 크롭 1장

둘의 역할이 다르므로 하나만 있으면 절반이 빈다. 얼굴만 있으면 제품을 못 보고, 크롭만 있으면 감정이 없다.

`layout-validator.ts`에 violation code `wearing_coverage`를 추가한다:

- `model_wearing` 슬롯이 **1개면 위반**(2개 이상으로 늘려라). **0개는 통과.**
- 얼굴/크롭 구분은 강제하지 않는다(수위가 `promptHint` 안에 자연어로 들어가므로 결정론적 판정이 어렵다). 프롬프트로만 유도한다.

**0개를 통과시키는 이유:** 인물이 부적절한 상품(위생용품·속옷·의료기기)은 Claude가 0개로 두면 그만이다. 카테고리를 하드코딩하지 않고도 "Claude가 인물이 필요하다고 판단했으면 최소 2장"이 강제된다.

`narrative` 플래그와 마찬가지로 `ProLayoutOpts`로 게이트해 생성 경로에서만 켠다.

### ④ 프롬프트 상수 (`wearing-prompts.ts` 신설)

`generate-scene-image/route.ts`는 이미 607줄이고 프롬프트 5개·누끼 검증·합성을 담고 있다. 인물 프롬프트를 더하면 700줄을 넘는다. **프롬프트 상수 전체를 `./prompts.ts`로 분리**하고 인물용을 거기에 추가한다.

> 커밋 `15aa8450`이 `PRODUCT_FIDELITY_INSTRUCTION` 중복 사본을 제거한 이력이 있다. 단일 출처를 확보하는 의미도 있다.

시험에서 검증된 블록을 그대로 상수화한다.

```ts
/**
 * 부정문이 결정적이다 (시험 35장에서 세 번 확인).
 * AI가 수렴하는 기본값은 긍정 지시로 벗어나지 않는다 — 명시적으로 배제해야 한다.
 * 이 파일의 NOT ~ 문구를 약화시키면 재검증이 필요하다.
 */

/** 모델 세팅. "Korean"만으로는 범아시아 평균으로 수렴한다 */
const MODEL_KO = {
  male:
    'a Korean man in his late twenties with a clean modern Korean haircut — softly layered, ' +
    'natural black hair, fair even skin tone, slim build',
  female:
    'a Korean woman in her late twenties with long straight black hair, natural dewy Korean makeup, ' +
    'fair even skin tone, slim build',
} as const;

const MODEL_CONTEXT =
  'Styled like a Korean lifestyle magazine editorial shot in Seoul, ' +
  'not a Western or Chinese catalog.';

/** 얼굴 포함. "editorial photo"/"catalog photograph"는 제품 중심 크롭을 유도해 역효과였다 */
const FACE_VISIBLE =
  'A candid lifestyle PORTRAIT — this is a photo OF THE PERSON, not a product shot. ' +
  'The head and face occupy the upper third of the frame, eyes meeting the camera, ' +
  'an easy natural smile. Waist-up composition.';

/** 얼굴 제외 */
const FACE_CROPPED =
  'FRAMING IS CRITICAL: the frame starts at the collarbone and ends at the hips — ' +
  'the head and face are COMPLETELY OUTSIDE the frame, not visible at all.';

/** 제품 색 보존. 골든아워에서 화이트가 살구색이 된 것을 막는다 */
const COLOR_ACCURACY =
  'COLOR ACCURACY IS CRITICAL: neutral daylight with accurate white balance. ' +
  'The garment\'s color must match the reference image exactly — a white garment renders as pure white. ' +
  'NOT golden hour, NOT sunset, NOT warm color cast.';

/** 포즈. 동적 포즈는 손을 뭉개고 팔 올림은 크롭을 깨뜨린다 */
const POSE_STATIC =
  'POSE CONSTRAINTS: both arms stay BELOW shoulder height — never raised, never overhead. ' +
  'Hands hang naturally relaxed with open fingers or rest in pockets — never clenched into fists. ' +
  'The person stands or leans still — NO running, NO jumping, NO mid-action motion.';
```

기존 `PRODUCT_FIDELITY_INSTRUCTION`은 그대로 재사용한다. 그 안의 `POSITIVE SUBJECT`(자신감 있고 편안한 표정) 조항과 `NO SPARKLE MARKS`가 이미 인물 씬을 전제하고 있다.

### ⑤ 성별은 Claude가 상품 정보로 판단

사이즈 표기·카테고리·카피에서 타깃을 읽는다. `M(95)~XXL(110)`이면 남성복, `S/M/L` + 여성 카피면 여성복이다.

`CLAUDE_SYSTEM`에 규칙을 추가해 `promptHint`에 성별을 명시하게 한다. 입력 필드를 늘리지 않는다 — 틀리면 재생성하는 비용이 필드 하나 추가하는 비용보다 싸다.

### ⑥ 프롬프트 규칙 (N6 신설)

`CLAUDE_SYSTEM`의 NARRATIVE 블록에 추가한다:

> **N6. 인물 착용컷(`model_wearing`)**
> 착용·사용이 구매 결정을 좌우하는 상품(의류·잡화·신발·가방·액세서리·스포츠용품)이면 `model_wearing` 슬롯을 **서로 다른 섹션에 최소 2개** 두세요. 하나는 얼굴이 보이는 컷, 하나는 얼굴을 뺀 크롭 컷입니다.
> - `hook`·`solution`·`usecase` 비트 → 얼굴이 보이는 컷
> - `detail`·`evidence` 비트 → 얼굴을 뺀 크롭 컷
> - `promptHint`에 [모델 성별] + [상황] + [수위]를 쓰세요. 성별은 사이즈 표기와 카피에서 타깃을 읽어 정하세요.
>   예: `"한국 20대 후반 남성, 해변 산책, 얼굴 보이는 상반신"`
> - 두 씬의 상황이 겹치면 안 됩니다.
> - **동작이 큰 장면을 쓰지 마세요** — 달리기·점프·팔을 머리 위로 드는 동작은 손과 프레임이 망가집니다. 서 있거나 기대거나 걷는 정적인 장면만 쓰세요.
> - **조명에 색을 넣지 마세요** — 노을·골든아워·석양은 제품 색을 물들입니다. 자연광·실내광만 쓰세요.
> - 인물이 부적절한 상품(위생용품·속옷·의료기기 등)은 `model_wearing`을 0개로 두세요.

### ⑦ 실사진 override에서 제외

현재 `page.tsx`의 `realBySection`은 gen 슬롯 자리에 업로드 사진이 있으면 AI 씬 생성을 건너뛴다. 그런데 shot-guide가 만드는 촬영 카드는 `detail_closeup` 슬롯만 대상이므로(`extractDetailCloseupShots`) **모든 업로드 사진은 제품 접사다.**

접사가 인물 씬 자리를 먹으면 지금 문제가 원상복귀한다. **`model_wearing` 슬롯은 override 대상에서 제외한다.** 나중에 shot-guide에 착용컷 슬롯이 생기면 그때 연결한다.

### ⑧ 충실도 보완 — 유지한다

제품 재현이 좋아도 완벽하지 않고, 스파클 같은 것이 새어나온다(§2.5). 구매자가 실물을 대조할 수 있어야 한다.

- **실제품컷 병치** — `model_wearing` 슬롯이 있는 섹션은 `product_nukki` 슬롯을 하나 더 선언하고 image 블록 2개를 배치한다. 구체적 배치(세로 스택 vs `columns` 2단)는 390px에서 착용컷이 175px로 작아지는 문제가 있어 구현 단계에서 렌더러 지원 범위를 보고 확정한다
- **연출 표기** — `model_wearing`이 하나라도 있으면 하단 고정 프레임 위에 한 줄을 조건부로 붙인다:
  > "일부 이미지는 제품 연출을 위해 AI로 생성되었으며, 실제 제품과 다를 수 있습니다."

### ⑨ 실패 처리

| 실패 지점 | 처리 |
|---|---|
| 참조 이미지 없음 | 슬롯을 건너뛴다 (제품을 못 그린다) |
| Gemini 생성 실패 | 이미지 없이 섹션 렌더 (기존 폴백과 동일) |
| 업로드 실패 | 같음 |

## 4. 범위 밖

- **Virtual Try-On** — 초반에 "단계적 접근"으로 정했다. 지금 시험에서 제품 재현이 충분히 좋아 1단계로 충분하다. 실사용에서 프린트 재현이 문제가 되면 그때 검토한다
- **동적 포즈** — 프롬프트로 해결 불가. 다른 모델이나 후처리가 필요하다
- **스파클 글리프 자동 검증** — vision으로 판정해 재생성하는 방식이 가능하나(`backgroundContainsProduct` 패턴) 호출이 늘어난다. 실사용 빈도를 보고 결정한다
- **사용자 촬영 착용컷** — 3단계(촬영 제안 루프)

## 5. 테스트

- `wearing`이 `COMPOSITE_SECTIONS`에 없어 누끼 경로를 타지 않는지
- `wearing_coverage`: 0개 통과 / 1개 위반 / 2개 통과
- `wearing_coverage`가 `ProLayoutOpts` 플래그로 게이트되는지 (기존 테스트 보호)
- `model_wearing` 슬롯이 `realBySection` override 대상에서 제외되는지
- `MODEL_KO`의 성별 키 매핑
- 프롬프트 조립: 수위(얼굴/크롭)에 따라 `FACE_VISIBLE`/`FACE_CROPPED`가 배타적으로 들어가는지
- `COLOR_ACCURACY`·`POSE_STATIC`이 항상 포함되는지

프롬프트 문자열 자체를 단언하는 테스트는 두지 않는다 — change-detector가 된다. 포함 여부만 확인한다.

## 6. 리스크

1. **스파클 글리프** — 12장 중 2장. 지시로 완전히 막히지 않는다. 실제 상품에 없는 장식이 그려지므로 오인 소지가 있다. ⑧의 병치·표기로 완화하되 근절은 아니다
2. **표본이 작다** — 각 변형 2회. 특히 "정적 포즈면 손 아티팩트가 없다"는 결론은 8장 기준이다
3. **얼굴 상단 잘림** — `FACE_VISIBLE`이 2/2로 온전히 나왔으나 다른 변형(F1·F3)에서는 이마·눈이 잘렸다. 프레이밍이 항상 안정적이라고 보장할 수 없다
4. **Claude가 성별을 잘못 읽을 수 있다** — 유니섹스 상품이나 카피가 모호한 경우. 재생성으로 대응한다
5. **비의류 카테고리 미검증** — 의류만 시험했다. 화장품 "손에 든 튜브", 가전 "사용 중인 손" 같은 형태는 손이 프레임에 들어오므로 아티팩트 위험이 다를 수 있다
6. **AI 생성 인물의 정책 리스크** — 마켓플레이스가 "실제 착용 사진처럼 보이는 AI 이미지"를 어떻게 다루는지는 확인되지 않았다. ⑧의 연출 표기가 최소 방어이며, 플랫폼 정책 확인은 별도 과제다
