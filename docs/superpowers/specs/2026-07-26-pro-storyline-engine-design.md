# PRO 스토리라인 엔진 (1단계-A) 설계 문서

> 작성일: 2026-07-26
> 상태: 승인됨 (구현 대기)
> 큰 그림: "PRO 상세페이지를 외주업체 수준으로" 3단계 중 1단계. 이미지 파이프라인은 건드리지 않는다.

## 0. 전체 맥락

PRO 상세페이지가 생성한 결과물에 서사가 없다. 사용자 요구는 "외주업체 퀄리티" — 비교 씬이 있고 소구포인트를 확실히 짚는 페이지.

전체를 3단계로 분해했다:

- **1단계-A (이 문서)** — 스토리라인 엔진. 레이아웃 생성·검증만 손댄다.
- 1단계-B — 실사진 적응형 보정 (별도 문서, 독립 트랙)
- 2단계 — 이미지 소스 라우팅 (`existing` / `generate` / `shoot`), `model_wearing` 인물 씬
- 3단계 — 촬영 제안 루프 (shoot 슬롯 ↔ shot-guide 연결)

1단계-A를 먼저 하는 이유: **무엇을 찍고 무엇을 생성할지 판단하려면 먼저 서사가 있어야 한다.** 현재 shot-guide가 `detail_closeup` 슬롯에만 걸려 있는 것도 판단 근거가 없어서다.

## 1. 문제

### 1.1 스토리라인 규칙이 존재하지 않는다

`CLAUDE_SYSTEM`(`src/app/api/ai/generate-pro-layout/system-prompt.ts`)의 구조 규칙은 D1(옵션 배분), D2(텍스트 2연속 금지), D3(긍정 원칙)이 전부다. **섹션 순서나 서사 아크에 대한 지시가 한 줄도 없다.** 실질적 구조 지시는 규칙 6 "Generate 6-10 sections"뿐이다.

그 결과 생성된 민소매 티셔츠 페이지의 섹션 순서:

```
히어로 → 원단 → 등판그래픽 → 컬러 → 사이즈 → 디테일 → 용도 → 세탁 → 제품정보
```

아크가 아니라 스펙 나열이다. 경쟁·기존 방식과의 비교 섹션이 없고, 주장을 뒷받침하는 근거 섹션도 없다.

### 1.2 비교 개념이 없다

`option_grid`는 우리 제품 내부 옵션(화이트/블랙) 비교일 뿐이다. 카피에는 "면 100% 티셔츠는 땀을 먹고 무거워지지만"이라는 비교가 있는데 이를 뒷받침하는 구조가 없다.

### 1.3 근거 없는 수치가 생성된다 (사고)

같은 페이지의 `progress_bar`:

| label | displayValue | value(바 길이) |
|---|---|---|
| 좌우 신축성 | 높음 | 92 |
| 땀 흡수·확산 | Omni-Wick | 88 |
| 건조 속도 | 빠름 | 85 |

**측정한 적도, 입력받은 적도 없는 수치다.** `CLAUDE_SYSTEM` 규칙 C4가 "실측 가능한 값만"을 요구하지만 `stat_row`에만 적용되고 `progress_bar`는 규제 대상이 아니다.

표시광고법상 실증 책임이 걸리는 영역이며, 이번 설계에서 가장 우선순위가 높은 항목이다.

## 2. 현재 구조 (코드로 확인함)

- **생성 흐름**: `generate-pro-layout/route.ts` — Claude Opus 생성 → `sanitizeProLayout` → `validateProLayout` → (`!isClean`이면) `repairProLayout` 1-pass → 재정화 → 응답.
- **`isClean` 판정**: `layout-validator.ts:308` — `!violations.some(v => v.severity === 'error')`. **error가 남아도 최종 응답은 200이다**(`route.ts:198~207`은 `console.warn`만). 즉 현행 구조는 "보장"이 아니라 "1회 시도 + 베스트에포트".
- **`ProLayoutOpts` 플래그 선례**: `statHygiene`(`layout-validator.ts:24~29`) — 특정 검증을 생성 경로에서만 켜는 패턴이 이미 있다.
- **`cleanStatBlocks`**(`layout-validator.ts:150~182`) — cols 재귀 + 잡음 item 제거 + "필터링이 실제로 일어난 경우에만 2개 미만이면 블록 드롭" + topLevel 분기. 이번 progress_bar 위생이 그대로 얹힐 자리다.
- **렌더러 폴백**(`section-renderer.ts:823`):
  ```ts
  item.displayValue ?? `${pct}%`
  ```
  **`displayValue`가 없으면 바 길이 수치를 그대로 화면에 찍는다.** 설계상 결정적인 제약이다.
- **`REPAIR_SYSTEM`**(`repair-pro-layout.ts:18`) 규칙 4: *"Keep all valid content and structure unchanged."*
- **입력 원천**: 생성 라우트는 `productInfo.points`와 분석된 원본 텍스트를 갖고 있다(`route.ts:118~150`) — provenance 대조의 재료.
- **draft 호환성**: draft GET은 검증 없이 raw 반환(`draft/route.ts:130~142`). `sanitizeProLayout`에 섹션을 드롭하는 단계가 없고, `stripCjk`·`pruneBlocks`·`normalizeSectionImages`는 모두 객체를 spread로 재구성해 **미지 필드를 보존한다**. PRO 페이지는 bare 섹션 배열을 그대로 저장한다(`page.tsx:288~291`).

## 3. 설계

### ① beat 어휘 (9종)

각 섹션에 `beat` 필드를 부여한다. 이것이 검증의 유일한 근거다.

| beat | 역할 |
|---|---|
| `hook` | 첫 화면. 이게 뭐고 왜 봐야 하는가 |
| `problem` | 기존 방식·대체재의 불편 |
| `solution` | 우리 제품이 그것을 어떻게 푸는가 |
| `compare` | 기존 방식 대비 우위 (카테고리 상식 수준) |
| `evidence` | 주장을 뒷받침하는 관찰 가능한 근거 |
| `detail` | 물리적 마감·소재·구조 |
| `usecase` | 언제 어디서 쓰는가 |
| `option` | 색상·사이즈 등 선택지 |
| `assure` | 세탁·보관·제품정보 |

검증이 실제로 참조하는 것은 `hook`/`problem`/`solution`/`compare`/`assure` 5종이다. 나머지 4종은 섹션의 실체를 반영하기 위해 유지한다 — 어휘가 없으면 Claude가 해당 섹션에 붙일 라벨이 없다.

### ② 아크 템플릿 (3종)

프롬프트 안에서 **Claude의 사고 도구로만** 쓰고 출력하지 않는다.

- **기능형** — `hook → problem → solution → compare → evidence → detail → option → assure`
  (원단·도구·가전처럼 성능이 구매 이유인 것)
- **감성형** — `hook → usecase → detail → solution → compare → option → assure`
  (패션·리빙처럼 장면이 구매 이유인 것)
- **신뢰형** — `hook → detail → evidence → compare → usecase → option → assure`
  (식품·고가처럼 믿음이 구매 이유인 것)

**출력하지 않는 이유**: 최상위 응답을 `{arc, sections}` 객체로 바꾸면 `extractJsonArray` → `sanitizeProLayout` → `validateProLayout` → `page.tsx`가 모두 영향받는다. beat가 섹션별로 출력되므로 아크 시퀀스는 사후 재구성 가능하다.

**감수하는 손실**: 의도한 템플릿을 몰라 템플릿 적합도 검증이 불가하고, repair에 목표 아크를 전달할 수 없으며, 로깅·A/B가 어렵다. 필요해지면 각 섹션에 아크명을 중복 기재하는 방식으로 확장한다(응답 형식 변경 없이 가능).

### ③ 검증 규칙 — `narrative`

`layout-validator.ts`에 violation code `narrative`를 추가한다. **`ProLayoutOpts`에 `narrative?: boolean` 플래그를 두고 생성 경로에서만 켠다** (`statHygiene` 선례).

| 규칙 | severity |
|---|---|
| `beat` 필드 누락 | error |
| 첫 섹션이 `hook`이 아님 | error |
| `compare` 0개 | error |
| `problem`이 있는데 `solution`이 없음 | error |
| `assure`가 마지막 3섹션 안에 없음 | warning |

**`compare`는 구조 조건을 결합한다.** `beat`는 LLM 자기신고 라벨이라 스펙 나열 섹션에 `"compare"`만 붙여도 통과한다. `beat === 'compare'`인 섹션은 `columns` 블록(`cols.length >= 2`)을 포함해야 하며, 아니면 `narrative` 위반으로 처리한다.

**채택하지 않은 규칙**: "같은 beat 3연속 → warning". warning은 repair를 트리거하지 않으므로(`route.ts:187`은 error만 검사) 로그로만 남아 실효가 없다. 또한 C5가 물리 디테일 섹션 1~2개를 강제하므로(`system-prompt.ts:53`) `detail` 연속이 정당한 경우가 많다.

### ④ `beat` 스키마 — optional

`zClaudeSection`에 `beat: z.enum([...]).optional()`로 정의한다.

**이유를 명확히 한다**: 기존 draft 로드가 깨지기 때문이 **아니다**(§2에서 확인했듯 draft GET은 검증을 거치지 않고 sanitize도 섹션을 드롭하지 않는다). optional로 두는 진짜 이유는 **draft 저장·렌더 경로의 `warnings`에 스키마 노이즈를 만들지 않기 위해서**다. 누락 검증은 `narrative` 플래그가 켜진 생성 경로에서만 수행한다.

> 이 근거를 문서에 남기는 이유: "로드가 안 깨지네, required로 바꾸자"는 잘못된 후속 판단을 막기 위해서다.

`ClaudeLayoutContent`(`types/detail-page.ts:184`)와 `GeneratedSection`(`page.tsx:15~19`)에는 검증만 할 경우 추가하지 않아도 된다. UI에서 beat를 참조하게 되면 그때 추가한다.

### ⑤ compare 비트 구현

새 블록 타입을 만들지 않는다. 기존 `columns` 2단 대비 카드로 구현한다 — 좌측에 기존 방식의 한계, 우측에 우리 제품.

`CLAUDE_SYSTEM`에 규칙을 추가한다:

> **D4. compare 섹션은 카테고리 공지의 사실만 다룬다.** 특정 경쟁사·브랜드 지목 금지. 배수·퍼센트·순위 표현 금지.
> 예: "면 100%는 땀을 머금어 무거워진다" (○) / "타사 대비 3배 빠른 건조" (✗) / "업계 1위 흡수력" (✗)

**프롬프트 지시만으로는 부족하다.** 이번 progress_bar 사고가 정확히 "지시는 있었으나 위반된" 구조다. `compare` 섹션 텍스트에 대해 결정론적 검사를 병행한다:

- 배수 표현: `/\d+\s*배/`
- 퍼센트: `/\d+\s*%/`
- 순위: `/\d+\s*위/`, `/업계\s*1위/`

검출 시 `narrative` warning으로 남기고 repair 대상에 포함한다.

### ⑥ progress_bar 수치 봉쇄 — provenance 방식

**형식 검사로는 막을 수 없다.** `displayValue: "92%"`는 "단위가 붙은 수치"라서 어떤 형식 규칙도 통과한다. 정규식은 형식을 볼 뿐 출처를 보지 못한다.

**판정: 입력 대조(provenance)**

`progress_bar`의 각 item에 대해:

1. `displayValue`가 **없으면 → 제거.** 렌더러가 바 길이를 `${pct}%`로 노출하므로(`section-renderer.ts:823`) 방치하면 지어낸 수치가 화면에 그대로 찍힌다.
2. `displayValue`에 숫자가 포함되어 있으면, 그 숫자가 **입력 원천에 등장하는지** 확인한다. 입력 원천은 `productInfo.points` 문자열들과 분석된 원본 텍스트(`route.ts:118~150`). 미등장 시 → 제거.
3. `displayValue`가 순수 정성 표현(숫자 없음)이면 → 제거. 근거가 없는 상대 강약 표현이며, 이번 사고의 형태다.
4. item 제거 후 남은 개수가 2 미만이고 **실제로 필터링이 일어났다면** 블록을 드롭한다 (`cleanStatBlocks`의 기존 규칙과 동일 — 원래도 1개였던 블록은 건드리지 않는다).

**구현 위치**: `cleanStatBlocks`를 확장한다. 이 함수는 이미 cols 재귀와 topLevel 분기를 갖추고 있어 `progress_bar`를 같은 자리에서 처리하는 것이 자연스럽다. `statHygiene` 플래그와 동일하게 게이트한다.

**숫자 매칭 규칙** (커밋 `5b0a49ba`의 교훈 반영 — 부분일치 정규식이 "폭발"·"개월"에서 오탐을 냈고 완전일치 Set + 앵커 + 상한으로 재작업됨):

- `displayValue`에서 숫자 토큰을 추출할 때 단위를 포함한 완전 토큰으로 뽑는다 (`180g`, `30초`, `95cm`)
- 입력 원천 대조는 숫자 부분의 완전일치로 한다. 단위 환산(`0.18kg` vs `180g`)과 반올림은 대조 실패로 처리한다 — **오탐(허용해야 할 것을 제거)은 감수하고 미탐(막아야 할 것을 통과)을 0으로 만든다.**

**`radar_chart`는 적용 대상에서 제외한다.** `CLAUDE_SYSTEM`의 블록 목록(`system-prompt.ts:18~32`)에 없어 생성 경로에서 나오지 않는다.

**남는 한계 (문서화)**: `displayValue`가 입력 대조를 통과한 실측치(`180g`)여도 **바 길이 `value`(0~100)는 여전히 임의 스케일**이다. "180g에 72% 길이 바"라는 정량 인상은 남는다. 근본 해결은 progress_bar 폐기이나, 이번에는 채택하지 않는다. 2단계 이후 재평가한다.

**자동 변환은 하지 않는다.** 기존 sanitize는 제거·클램프·주입만 수행한다. `progress_bar → bullet_list` 같은 블록 타입 변환은 새로운 종류의 변형이라 위험하다. 결정론 단계는 item 제거와 블록 드롭까지만 하고, 대체 표현은 repair(LLM)에 맡긴다.

### ⑦ repair 정합

**`REPAIR_SYSTEM` 규칙 4를 완화한다.** 현행은 *"Keep all valid content and structure unchanged"* 인데, 비트 재배치(섹션 순서 변경)는 이 지시와 정면 충돌한다. `narrative` 위반이 있을 때만 순서 변경을 허용하도록 단서를 단다.

**beat 어휘를 repair에 전달한다.** 알려주지 않으면 repair가 미지 필드인 `beat`를 지워버릴 수 있다. `REPAIR_SYSTEM`에 어휘 9종과 규칙을 추가한다:

> 7. `narrative` 이슈가 있으면 섹션 순서를 재배치하거나 `beat` 값을 교정한다. 모든 섹션은 `beat` 필드를 유지해야 하며 절대 삭제하지 않는다.

### ⑧ repair 실패 시 처리

현행은 repair 실패·미해결 시 `console.warn` 후 200 응답이다. 스토리라인이 없는 페이지가 조용히 사용자에게 전달된다.

**결과 화면에 경고를 표시한다.** 응답에 잔존 위반 요약을 실어 보내고(`{ success: true, sections, warnings? }`), PRO 결과 화면에서 한 줄 배너로 노출한다. 생성을 막지는 않는다 — 스토리라인 미달은 페이지를 못 쓰게 만드는 결함이 아니라 품질 저하다(옵션 커버리지와 동일한 판단).

### ⑨ evidence 비트 ↔ shot-guide

`evidence` 비트 섹션에 `detail_closeup` 슬롯을 배정하도록 `CLAUDE_SYSTEM`에 규칙을 건다. 기존 shot-guide는 `slotType === 'detail_closeup'`만 보고 추출하므로(`shot-guide.ts:9~14`) **추가 작업 없이 촬영 지시가 생성된다.**

**부작용 인지**: C5가 이미 물리 디테일 섹션 1~2개를 강제하므로 촬영 카드 수가 늘어난다. 또한 evidence의 내용이 시험성적서·인증서류라면 "제품 접사" 촬영 지시와 성격이 맞지 않는다. 이번 범위에서는 evidence를 **관찰 가능한 물리적 근거**(봉제 밀도, 자로 잰 치수, 물방울 테스트)로 한정하도록 프롬프트에 명시하고, 서류 촬영은 다루지 않는다.

## 4. 범위 밖

- 이미지 소스 라우팅(`existing` / `generate` / `shoot`) — 2단계
- `model_wearing` 인물 씬 생성 — 2단계
- 촬영 제안 UX, shot-guide 슬롯 확장 — 3단계
- 씬 물량 보장 — 2단계
- progress_bar의 바 길이 임의 스케일 문제 — 2단계 이후 재평가

**이 문서의 변경은 이미지 파이프라인을 한 줄도 건드리지 않는다.**

## 5. 테스트

### 신규

- `narrative` 규칙 5종 각각 (통과/위반 케이스)
- `compare` 구조 조건: `columns` 없는 compare 섹션이 걸리는지
- provenance 판정: 입력에 있는 숫자 통과 / 없는 숫자 제거 / `displayValue` 누락 제거 / 순수 정성 표현 제거
- item 제거 후 2개 미만 → 블록 드롭, 단 원래 1개였던 블록은 보존
- `narrative` 플래그 off일 때 검증이 돌지 않는지
- 배수·퍼센트·순위 표현 검출

### 회귀

- **`layout-validator.test.ts:15~17`이 beat 없는 fixture로 `isClean=true`를 기대한다.** `narrative`를 플래그 없이 켜면 대량 실패한다 — 플래그 게이트가 이 테스트로 검증된다.
- `generate-pro-layout.test.ts:17~18`은 `repairProLayout`을 identity mock으로 둔다. fixture에 beat가 없으면 모든 route 테스트가 repair 분기로 진입해 기대 흐름이 바뀐다 — fixture에 beat를 추가하거나 플래그를 끈다.
- beat 필드가 sanitize·render 경로를 통과해 보존되는지

### 실물 픽스처

현재 민소매 티셔츠 레이아웃을 픽스처로 넣고 다음이 실제로 잡히는지 확인한다: `compare` 누락, progress_bar 3개 item 전부 제거 → 블록 드롭.

## 6. 리스크

1. **도입 초기 repair 폭증** — `beat` 누락이 error이므로 프롬프트가 안정되기 전까지 거의 매 생성마다 Sonnet repair 1-pass가 붙는다. Opus 생성 + Sonnet repair 직렬이라 체감 지연이 크다(`maxDuration` 180s 안이긴 하다). 완화: `CLAUDE_SYSTEM`에 beat 필드를 강하게 명시하고 예시를 준다.
2. **beat는 자기신고 라벨** — `compare`에 구조 조건을 걸었지만 다른 비트는 여전히 라벨만 붙이고 통과할 수 있다. 구조 조건을 다른 비트로 확대할지는 실물 결과를 본 뒤 판단한다.
3. **progress_bar가 사실상 대부분 사라진다** — 현재 생성되는 progress_bar는 거의 전부가 정성 표현(`높음`/`빠름`) 또는 근거 없는 수치다. §⑥ 규칙을 적용하면 입력에 실측치를 적어둔 상품이 아닌 한 블록째로 드롭된다. **의도된 결과**이며, 지어낸 숫자를 남기는 것보다 낫다는 판단이다. 다만 페이지가 시각적으로 허전해질 수 있으므로, 실물 확인 후 빈자리를 `bullet_list`나 `icon_grid`로 채우도록 `CLAUDE_SYSTEM`을 조정할 수 있다.
4. **provenance 오탐** — 단위 환산·반올림된 정당한 수치가 제거된다. 미탐 0을 우선한 의도적 선택이며, 사용자가 실측값을 입력에 그대로 적으면 통과한다.
5. **repair가 beat를 지울 가능성** — ⑦로 완화하지만 LLM 동작이라 100%는 아니다. 재정화 후 `beat` 누락이 남으면 경고에 포함된다.
