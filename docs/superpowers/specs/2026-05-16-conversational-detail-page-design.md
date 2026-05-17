# 대화식 상세페이지 생성 — Design

**작성일**: 2026-05-16
**상태**: Draft (사용자 리뷰 대기)
**스코프**: 자산 탭(`/listing` → 자산 모드)에 "대화로 만들기" 진입점 추가

---

## 1. 개요

### 목적
현재 자산 탭의 상세페이지 자동 생성은 사진·상품명·스펙만으로 한 번에 HTML을 만들지만, **타겟·USP·톤** 같은 마케팅 컨텍스트가 없어 결과가 평이하다. 본 기능은 모달 채팅창에서 AI 마케터가 5~7개의 마케팅 브리프 질문을 던지고 답변을 수집한 뒤, 그 풍부한 컨텍스트로 첫 상세페이지를 생성한다.

### 비목적 (YAGNI)
- 모달 안에서 HTML 미리보기·섹션 편집을 제공하지 않는다. 생성 후 결과 패널의 기존 `DetailPageEditor`로 흐름이 이어진다.
- 대화 재개·답변 카드 표시·무제한 채팅 모드는 본 스펙에 포함하지 않는다(향후 확장).
- 모달 안에서 사진·상품명·카테고리를 새로 받지 않는다. 모달 진입 전에 자산 탭에서 입력 완료한다.

### 디자인 결정 요약
| 결정 항목 | 선택 |
|---|---|
| 큰 흐름 | 질문 수집 → 일괄 생성 |
| 기존 폼 모드와의 관계 | 공존 (자산 탭에 두 진입점) |
| 질문 설계 | 공통 5개 + 카테고리 보충 1~2개 |
| 답변 입력 방식 | 옵션 칩 + 자유 텍스트 + AI 사전 채움 |
| UI 레이아웃 | 모달 채팅창 |
| 입력 시점 | 모달 진입 전 (자산 탭에서) |
| 결과 흐름 | 기존 편집 시스템에 인계 |
| 답하기 어려운 항목 | `🤖 AI에게 맡기기` 칩 |
| AI 모델 | Sonnet(추천·생성) + Haiku(위임) |

---

## 2. 사용자 흐름

```
[자산 탭]
 ├─ 이미지 업로드 (썸네일/상세)
 ├─ 상품명 (sharedDraft.name)
 ├─ 카테고리 칩 4개  ← 신규: basic / fashion / living / food
 │
 ├─ [빠른 생성(폼)]  ← 기존 흐름 유지
 └─ [대화로 만들기]  ← 신규 진입점
      │
      ▼
[ConversationalDetailModal 열림]
 ├─ (열림 즉시) Sonnet Vision 1회 호출: 이미지+상품명+카테고리 → 칩 후보·추천 답변 사전 채움
 │
 ├─ Q1: 타겟 고객 — [추천 칩 ⭐] [대안 칩] [대안 칩] [직접 입력] [🤖 AI에게 맡기기]
 ├─ Q2: 핵심 셀링포인트(USP)
 ├─ Q3: 톤·분위기
 ├─ Q4: 페인포인트 해결
 ├─ Q5: 차별점
 ├─ Q6~7: 카테고리 보충 (1~2개)
 │
 └─ [생성하기 →]
      │
      ▼
[generate-detail-html 확장 호출]
 conversationContext = { productName, category, imageUrls, answers[] }
      │
      ▼
[모달 닫힘 → 결과 패널 활성화]
 ├─ AssetsResultPanel
 └─ DetailPageEditor (기존)
      ├─ 섹션 클릭해 편집
      ├─ /api/detail-page/edit-section (자연어 지시 → 단일 섹션 수정)
      └─ /api/ai/edit-detail-html (자연어 지시 → 전체 HTML 보충)
```

### 진입 조건
`대화로 만들기` 버튼 활성화 조건:
- 이미지 1장 이상 업로드 (썸네일 또는 상세 중 1장 이상)
- 상품명 비어있지 않음 (`sharedDraft.name`)
- 카테고리 선택됨

### 모달 내 진행률 표시
모달 상단 헤더에 `3 / 6` 형태로 단순 카운터. 진행률 바·요약 카드는 없음.

### 모달 내 사용자 액션 (각 질문 턴)
하나의 질문 카드는 다음 5개의 칩/입력을 가진다:
1. **추천 칩 ⭐** — Sonnet이 사전 채운 추천 답변 1개
2. **대안 칩 × 2~3** — Sonnet이 제안한 대안
3. **자유 입력** — textarea 클릭 → 직접 입력
4. **`🤖 AI에게 맡기기`** — Haiku 호출 → 결과를 답변으로 채움
5. **(상단 헤더) ← 뒤로** — 직전 질문으로 돌아가 수정

답변 확정 시 다음 질문으로 자동 진행.

---

## 3. UI 컴포넌트

### 3.1 신규: `ConversationalDetailModal`
- 위치: `src/components/listing/assets/ConversationalDetailModal.tsx`
- 책임: 모달 컨테이너 + 질문 카드 렌더 + 진행 상태 관리 + 사전 채움·위임·생성 API 호출
- 외부 인터페이스
  ```ts
  interface ConversationalDetailModalProps {
    productName: string;
    category: CategoryKey;
    imageUrls: string[];
    onClose: () => void;
    onComplete: (result: {
      html: string;
      content?: DetailPageContent;
      conversationContext: ConversationContext;
    }) => void;
  }
  ```
- 내부 상태(React `useReducer`): `phase`(`loading_suggestions` | `qna` | `generating` | `error`), `currentQuestionIndex`, `answers[]`, `suggestions[]`(사전 채움 결과)

### 3.2 수정: `AssetsInputPanel`
- 카테고리 칩 셀렉터 추가 (이미지 업로드 영역 아래)
- `대화로 만들기` 버튼 추가 (`자산 생성` 버튼 옆)
- 모달 마운트 상태 관리는 `AssetsTab` 또는 `AssetsInputPanel`에 추가

### 3.3 손대지 않는 컴포넌트
- `AssetsResultPanel`, `DetailPageEditor`, 섹션 편집기, `AiEditModal` — 변경 없음.

---

## 4. 데이터 모델

### 4.1 새 타입
```ts
// src/lib/conversational-detail/types.ts (신규)

export type CategoryKey = 'basic' | 'fashion' | 'living' | 'food';

export interface QuestionDefinition {
  id: string;
  text: string;                    // 사용자에게 보이는 질문
  staticChips?: string[];          // 카테고리 무관 고정 칩 (예: tone의 5개 톤)
  appliesToCategory?: CategoryKey[]; // 카테고리 보충 질문이면 명시. 없으면 공통
}

export interface ChipSuggestion {
  questionId: string;
  chips: string[];          // 3~4개. 첫 번째가 추천(⭐)
  recommendedIndex: number; // 보통 0
}

export interface QuestionAnswer {
  questionId: string;
  selectedChip?: string;
  freeText?: string;
  delegatedToAi?: boolean;
  resolvedValue: string;    // 최종 답변. 모든 경로(칩/자유/위임)가 이 한 필드로 통일.
}

export interface ConversationContext {
  productName: string;
  category: CategoryKey;
  imageUrls: string[];      // Supabase 공개 URL. 최대 5장.
  answers: QuestionAnswer[];
}
```

### 4.2 store 변경 (`useListingStore.ts`)
`AssetsDraft`에 두 필드 추가:
```ts
interface AssetsDraft {
  // ...기존 필드
  category: CategoryKey | null;                      // 신규
  conversationAnswers: QuestionAnswer[];             // 신규 (마지막 대화의 답변. 결과 디버깅·재현용)
}
```

초기값: `category: null`, `conversationAnswers: []`.

---

## 5. AI 통합

### 5.1 사전 채움 — `POST /api/ai/detail-page-suggest-answers` (신규)
**목적**: 모달 열림 직후 1회. 이미지·상품명·카테고리로 각 질문의 칩 후보(3~4개)와 추천 답변을 생성한다.

**입력 (Zod)**
```ts
{
  productName: z.string().min(1).max(200),
  category: z.enum(['basic', 'fashion', 'living', 'food']),
  imageUrls: z.array(z.string().url()).min(1).max(5),
  questionIds: z.array(z.string()).min(1), // 어떤 질문에 답을 만들지
}
```

**처리**
- `Sonnet 4.6` Vision 호출. system prompt: "당신은 한국 이커머스 마케팅 카피라이터입니다. 다음 상품의 마케팅 브리프를 작성하기 위한 질문들에 대해 가장 적합한 답변 후보 3~4개씩을 JSON으로 제안하세요. 첫 번째 후보가 가장 추천입니다."
- 응답을 `ChipSuggestion[]`로 파싱. 각 질문당 3~4개 칩.

**출력**
```ts
{ success: true, data: { suggestions: ChipSuggestion[] } }
| { success: false, error: string }
```

**Rate Limit**: IP+user 기준 분당 5회.
**모델 비용 안전장치**: `imageUrls` 최대 5장. 한 번 호출이라 누적 비용 낮음.

### 5.2 위임 — `POST /api/ai/detail-page-delegate-answer` (신규)
**목적**: 사용자가 `🤖 AI에게 맡기기` 누를 때 단일 항목 결정.

**입력**
```ts
{
  productName: z.string().min(1).max(200),
  category: z.enum([...]),
  imageUrls: z.array(z.string().url()).min(1).max(5).optional(), // Haiku는 텍스트 위주라 이미지 생략 가능
  questionId: z.string(),
  questionText: z.string(),
  previousAnswers: z.array(/* QuestionAnswer 축약 */),
}
```

**처리**
- `Haiku 4.5` 호출. 가벼운 한 줄 결정. JSON `{ value: string }` 반환.

**출력**
```ts
{ success: true, data: { value: string } }
| { success: false, error: string }
```

**Rate Limit**: 분당 20회 (질문마다 사용 가능하므로 다소 높게).

### 5.3 HTML 생성 — `POST /api/ai/generate-detail-html` (확장)
**변경**
- Zod 입력 스키마에 `conversationContext?: ConversationContext` 옵셔널 필드 추가
- 라우트 내부에서 컨텍스트가 있으면 `buildDetailPageUserPrompt`에 마케팅 브리프 블록으로 주입

**기존 호출 영향 0** — 옵셔널 필드 추가만으로 기존 빠른 생성 흐름은 그대로 작동.

**마케팅 브리프 주입 형식** (예시)
```
[마케팅 브리프]
- 타겟 고객: 30대 워킹맘
- 핵심 셀링포인트: 한 손으로도 열리는 원터치 버튼
- 톤·분위기: 신뢰감 있는 전문가 톤
- 페인포인트: 출근길 한 손이 바쁠 때
- 차별점: 동급 대비 절반 두께
- (카테고리 보충 — living) 사용 환경: 좁은 주방 카운터
- (카테고리 보충 — living) 관리 편의: 분리세척 가능
```

이 블록을 `buildDetailPageUserPrompt`가 생성하는 user 메시지 상단에 prepend.

---

## 6. 질문 셋 명세

### 6.1 공통 질문 (5개, 모든 상품)

| ID | 질문 텍스트 | 정적 칩 후보 | 비고 |
|---|---|---|---|
| `target` | 누구를 위한 상품인가요? | 30대 여성 / 20대 남성 / 워킹맘 / 인테리어 관심 20대 / 시니어 | Sonnet이 카테고리·사진 보고 동적 보완 |
| `usp` | 가장 먼저 떠올리게 할 한 가지 강점은? | (정적 없음, Sonnet 동적) | |
| `tone` | 톤·분위기는? | 감성적 / 전문적 / 캐주얼 / 유머러스 / 신뢰감 | 5개 고정 |
| `pain` | 어떤 불편을 해결하나요? | (정적 없음, 동적) | |
| `differentiator` | 경쟁 상품과 결정적으로 다른 점은? | (정적 없음, 동적) | |

### 6.2 카테고리 보충 (각 카테고리 2개)

| 카테고리 | 질문 1 | 질문 2 |
|---|---|---|
| `basic` | 주된 재질·구성은? | 어떤 규격·호환성을 강조할까요? |
| `fashion` | 핏·사이즈 특성은? (오버핏/슬림/표준 등) | 어떤 코디 상황에 추천할까요? |
| `living` | 어떤 공간에서 주로 쓰나요? | 청소·관리 편의를 어떻게 강조할까요? |
| `food` | 보관·원산지를 어떻게 강조할까요? | 맛을 어떻게 표현할까요? |

**총 질문 수**: 5 + 2 = **7개**.

질문 정의는 `src/lib/conversational-detail/questions.ts` 모듈에 상수로 둔다(타입: `QuestionDefinition[]`).

---

## 7. 보안·안정성

### 7.1 인증·인가
모든 신규 라우트는 기존 `requireAuth` 미들웨어 사용. 미인증 시 401.

### 7.2 Rate Limit
- `detail-page-suggest-answers`: 분당 5회 (Sonnet Vision 비용 보호)
- `detail-page-delegate-answer`: 분당 20회 (Haiku, 가벼움)
- `generate-detail-html`: 기존 제한 유지

### 7.3 입력 검증
- `imageUrls`: 5장 제한 + URL 형식 검증
- 텍스트 필드: 길이 제한 (`productName` 200자, `freeText` 500자)
- `category`: enum 검증
- `questionIds`: 사전 정의된 화이트리스트만 허용

### 7.4 AI 응답 견고성
- JSON 파싱 실패 → 500 + 사용자에게 "다시 시도" 안내
- 사전 채움 실패 시 모달은 정적 칩만으로 진행 가능 (graceful degradation)

### 7.5 Token 절감
- 사전 채움 system prompt에 "응답은 JSON만, 설명 텍스트 금지" 명시
- 위임 응답은 단일 필드 `{value: string}`만

---

## 8. 파일 영향 범위

### 신규 파일
| 경로 | 책임 |
|---|---|
| `src/components/listing/assets/ConversationalDetailModal.tsx` | 모달 UI + 상태 관리 |
| `src/app/api/ai/detail-page-suggest-answers/route.ts` | 사전 채움 라우트 |
| `src/app/api/ai/detail-page-delegate-answer/route.ts` | AI 위임 라우트 |
| `src/lib/conversational-detail/types.ts` | 공유 타입 정의 |
| `src/lib/conversational-detail/questions.ts` | 질문 정의 상수 |

### 수정 파일
| 경로 | 변경 |
|---|---|
| `src/components/listing/assets/AssetsInputPanel.tsx` | 카테고리 칩 + `대화로 만들기` 버튼 추가, 모달 마운트 |
| `src/store/useListingStore.ts` | `AssetsDraft.category`, `AssetsDraft.conversationAnswers` 추가 |
| `src/app/api/ai/generate-detail-html/route.ts` | `conversationContext` 옵셔널 필드 추가 |
| `src/lib/ai/prompts/detail-page.ts` | `buildDetailPageUserPrompt`가 `conversationContext` 받아 브리프 블록 prepend |

### 손대지 않는 파일
- `AssetsResultPanel.tsx`, `DetailPageEditor` 및 그 하위 컴포넌트
- `edit-section`, `edit-detail-html` 라우트
- `AiEditModal.tsx` (직전 작업으로 별도 변경됨)

---

## 9. 테스트 전략

### 9.1 단위 테스트
- `lib/conversational-detail/questions.ts`: 카테고리별 질문 셋이 정의되었는지
- `buildDetailPageUserPrompt`: `conversationContext` 주입 시 브리프 블록 형식이 올바른지

### 9.2 라우트 통합 테스트 (msw 또는 mock client)
- `detail-page-suggest-answers`: 입력 검증, Sonnet 응답 파싱, 에러 처리
- `detail-page-delegate-answer`: 입력 검증, Haiku 응답 파싱
- `generate-detail-html`: `conversationContext` 옵셔널 — 있을 때/없을 때 동작 동일성

### 9.3 UI 컴포넌트 테스트 (React Testing Library)
- `ConversationalDetailModal`: 질문 카드 순차 진행, 칩 선택, 자유 입력, AI 위임, 뒤로가기

### 9.4 수동 시나리오
1. 패션 카테고리 + 사진 2장 → 7개 질문 모두 답 → 생성 → 결과 확인
2. 식품 카테고리 + 사진 1장 → 5개 답 후 2개는 `AI에게 맡기기` → 생성 → 결과 확인
3. 사전 채움 호출 실패 시 모달이 정적 칩으로 진행 가능한지

---

## 10. 향후 확장 (스코프 외)

YAGNI로 본 스펙에서 제외:
- 결과 패널 상단에 "수집된 답변" 카드로 표시
- 대화 재개 (답변 미리 채워진 모달 재오픈)
- 모달 안에서 HTML 미리보기·실시간 빌드
- 대화 종료 후 채팅 무제한 모드 (자연어 편집은 이미 결과 패널에 존재)
- 카테고리 자동 감지 (사진 보고 AI가 카테고리 추천)
- 다국어 톤 옵션

---

## 11. 미해결 사항

(현재 없음 — 모든 본질 결정이 잡혔다. 구현 단계에서 발견되는 디테일은 별도 메모로 관리.)
