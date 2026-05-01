# 키워드 AI 평가 — 고정 기준 제거 및 AI 판단 도입 설계

**날짜:** 2026-04-23
**상태:** 승인됨

---

## 개요

키워드 트래커의 통과/탈락 판정이 고정 숫자 기준(월검색량 3,000~30,000 / 경쟁상품수 500 / 리뷰 50)에 의존해 실제 시장에서 통과하는 키워드를 찾기 어렵다. 카테고리마다 경쟁 구조가 달라 단일 기준이 맞지 않기 때문이다. 고정 임계값을 완전히 제거하고 AI가 카테고리 맥락을 고려해 O/X 판정과 근거를 제공하도록 교체한다.

---

## 결정 사항

| 항목 | 결정 |
|------|------|
| 판정 표시 | O/X 유지 (✅/❌), 표시 방식 변경 없음 |
| 판단 주체 | AI (카테고리 맥락 기반), 고정 숫자 기준 완전 제거 |
| 평가 트리거 | AI 추천 시 자동, 수동 저장 시 searchVolume + competitorCount 둘 다 있으면 자동 |
| 데이터 부족 | searchVolume 또는 competitorCount 없으면 `—` 표시 (평가 스킵) |
| 근거 표시 | ✅/❌ 배지에 마우스 오버 시 툴팁으로 `reasoning` 표시 |
| 사용자 설정 | 없음 — AI가 전적으로 판단 |

---

## 아키텍처

### 신규 파일

**`src/app/api/ai/keyword-evaluate/route.ts`**

POST `{ keyword, searchVolume, competitorCount, topReviewCount? }` → `{ pass: boolean, reasoning: string }`

- 인증 필요 (`requireAuth`)
- Claude Haiku 사용
- `topReviewCount`는 optional — 없어도 평가 가능 (searchVolume + competitorCount 기반)
- 평가 불가 시 (API 오류 등) → `{ pass: null, reasoning: null }` 반환

### 수정 파일

**`src/app/api/ai/keyword-suggest/route.ts`**

- 기존 enriched 응답(searchVolume, competitorCount) 이후 `/api/ai/keyword-evaluate` 내부 호출
- `SuggestedKeyword` 타입에 `pass: boolean | null`, `reasoning: string | null` 추가
- Naver 데이터 없으면 평가 스킵 (`pass: null`)

**`src/components/sourcing/KeywordTrackerTab.tsx`**

- `KeywordEntry` 인터페이스에 `aiPass: boolean | null`, `aiReasoning: string | null` 추가
- `judgeKeyword` 함수 제거
- 수동 저장(`handleAdd`) 시: searchVolume + competitorCount 모두 있으면 `/api/ai/keyword-evaluate` 호출 후 결과 저장
- 테이블 "판정" 컬럼: `aiPass` 기반 렌더링 + reasoning 툴팁
- 상단 통계: `aiPass === true` 카운트 → 통과, `aiPass === false` → 탈락, `aiPass === null` → 미평가

---

## 데이터 타입

```typescript
// KeywordEntry 수정
interface KeywordEntry {
  id: string;
  keyword: string;
  searchVolume: number;
  competitorCount: number;
  topReviewCount: number;
  domeggookNos: string;
  memo: string;
  createdAt: string;
  aiPass: boolean | null;       // 신규
  aiReasoning: string | null;   // 신규
}

// SuggestedKeyword 수정
interface SuggestedKeyword {
  keyword: string;
  reason: string;
  searchVolume: number | null;
  competitorCount: number | null;
  pass: boolean | null;         // 신규 (aiPass와 구분)
  reasoning: string | null;     // 신규
}
```

---

## AI 프롬프트 명세

**System Prompt:**
```
당신은 한국 온라인 쇼핑몰(네이버 스마트스토어, 쿠팡) 키워드 소싱 전문가입니다.
셀러가 신규로 진입할 수 있는 키워드인지 판단합니다.

판단 기준:
- 이 카테고리의 일반적인 경쟁 수준을 고려할 것
- 수요(검색량) 대비 공급(경쟁 상품수) 비율을 볼 것
- 상위 리뷰수가 있으면 경쟁 강도 추가 반영
- 신규 셀러 기준: 광고비 없이 자연 노출로 판매 가능한지

반드시 JSON만 응답:
{"pass": true/false, "reasoning": "판단 근거 1~2문장"}
```

**User Prompt:**
```
키워드: {keyword}
월 검색량: {searchVolume}
경쟁 상품수: {competitorCount}
상위 리뷰수: {topReviewCount ?? "데이터 없음"}

이 키워드가 신규 셀러 진입에 적합한지 판단해주세요.
```

---

## UI 변경

### 테이블 판정 컬럼

| 상태 | 표시 |
|------|------|
| `aiPass === true` | ✅ (마우스 오버 → reasoning 툴팁) |
| `aiPass === false` | ❌ (마우스 오버 → reasoning 툴팁) |
| `aiPass === null` | — |

### 수동 저장 플로우

```
저장 클릭
  → searchVolume AND competitorCount 있음?
      YES → /api/ai/keyword-evaluate 호출 (비동기)
            → 응답 받으면 해당 행 aiPass/aiReasoning 업데이트
            → localStorage도 업데이트
      NO  → aiPass: null로 저장
```

저장은 즉시 이루어지고, 평가는 백그라운드에서 비동기로 실행. 평가 완료 전까지 해당 행은 `—` 표시.

### 상단 통계

```
총 {N}개 · 통과 {passCount}개 · 탈락 {failCount}개 · 미평가 {nullCount}개
```

---

## 변경 범위

| 파일 | 변경 유형 |
|------|---------|
| `src/app/api/ai/keyword-evaluate/route.ts` | 신규 |
| `src/app/api/ai/keyword-suggest/route.ts` | 수정 — evaluate 결과 포함 |
| `src/components/sourcing/KeywordTrackerTab.tsx` | 수정 — judgeKeyword 제거, aiPass/aiReasoning 필드, 저장 트리거, 툴팁 |

**변경하지 않는 것:** 네이버 API 조회 로직, 수동 입력 폼 구조, 저장/삭제 로직, localStorage 키
