# AI 키워드 추천 + 네이버 실데이터 자동 조회 설계

**날짜:** 2026-04-22
**상태:** 승인됨

---

## 개요

키워드 목록 탭의 "✨ AI 추천" 기능이 키워드 이름만 제안하고 실제 수치(월 검색량, 경쟁 상품수)는 0으로 남겨두는 문제를 해결한다. Claude가 키워드 후보를 생성한 뒤 네이버 API로 실데이터를 자동 조회해 모달에 통과/탈락 판정과 함께 표시한다.

---

## 결정 사항

| 항목 | 결정 |
|------|------|
| 월 검색량 출처 | 네이버 검색광고 API (`/keywordstool`) — PC + 모바일 합산 |
| 경쟁 상품수 출처 | 네이버 쇼핑 검색 API (`/v1/search/shop.json`) — `total` 필드 |
| 상위 리뷰수 | 자동화 불가 — 수동 입력 유지 |
| Naver API 실패 시 | graceful degradation — 키워드는 표시, 수치만 `null` |
| 프롬프트 방향 | 2~3단어 조합으로 수정 (긴 키워드 지양) |

---

## 아키텍처

### 신규 파일

**`src/lib/naver-ad.ts`**
- 네이버 검색광고 API HMAC-SHA256 인증 헬퍼
- `getKeywordStats(keywords: string[]): Promise<KeywordStat[]>` 함수
- 환경변수: `NAVER_AD_API_KEY`, `NAVER_AD_SECRET_KEY`, `NAVER_AD_CUSTOMER_ID`

**`src/app/api/naver/keyword-stats/route.ts`**
- POST `{ keywords: string[] }` → `{ stats: KeywordStat[] }`
- 내부에서 `getKeywordStats` + 네이버 쇼핑 검색 API 호출
- 인증 필요 (`requireAuth`)

### 수정 파일

**`src/app/api/ai/keyword-suggest/route.ts`**
- Claude 응답 후 `/api/naver/keyword-stats` 내부 호출 (또는 직접 lib 함수 호출)
- 응답 타입에 `searchVolume: number | null`, `competitorCount: number | null` 추가
- 프롬프트 수정: 2~3단어 키워드 지향, "구체적이고 특화된" 지시 제거

**`src/components/sourcing/KeywordTrackerTab.tsx`**
- `SuggestedKeyword` 타입에 `searchVolume`, `competitorCount` 필드 추가
- 모달 결과 리스트: 수치 + 통과/탈락 배지 표시
- 통과 키워드 상단 정렬
- 로딩 단계 표시: "Claude 분석 중..." → "검색량 조회 중..."

---

## 데이터 타입

```typescript
interface KeywordStat {
  keyword: string;
  searchVolume: number | null;   // PC + 모바일 월 검색수 합산, null = 조회 실패
  competitorCount: number | null; // 네이버 쇼핑 등록 상품수, null = 조회 실패
}

interface SuggestedKeyword {
  keyword: string;
  reason: string;
  searchVolume: number | null;
  competitorCount: number | null;
}
```

---

## 네이버 검색광고 API 명세

**엔드포인트:** `GET https://api.searchad.naver.com/keywordstool?hintKeywords={키워드1,키워드2,...}`

**인증 헤더:**
```
X-Timestamp: {Unix ms timestamp}
X-API-KEY: {NAVER_AD_API_KEY}
X-Customer: {NAVER_AD_CUSTOMER_ID}
X-Signature: HMAC-SHA256(timestamp + "." + method.toUpperCase() + "." + path, NAVER_AD_SECRET_KEY)
```

**응답:**
```json
{
  "keywordList": [
    {
      "relKeyword": "방수 백팩",
      "monthlyPcQcCnt": 3200,
      "monthlyMobileQcCnt": 8500
    }
  ]
}
```

`searchVolume = monthlyPcQcCnt + monthlyMobileQcCnt`

---

## 네이버 쇼핑 검색 API 명세

**엔드포인트:** `GET https://openapi.naver.com/v1/search/shop.json?query={keyword}&display=1`

**인증 헤더:**
```
X-Naver-Client-Id: {NAVER_CLIENT_ID}
X-Naver-Client-Secret: {NAVER_CLIENT_SECRET}
```

**응답:** `{ "total": 342 }` → `competitorCount = total`

---

## 프롬프트 수정

기존 지시 (제거):
> "구체적이고 특화된 키워드 (예: "백팩"보다 "방수 직장인 백팩 15인치")"

변경 후:
> "2~3단어 조합 키워드. 너무 구체적인 4단어 이상 조합은 검색량이 낮으므로 지양."

---

## UI 변경

### 모달 키워드 목록 행

```
☑  방수 등산 배낭              ✅ 통과 (검색량 8,200 · 경쟁 312)
   이유: 야외활동 수요 안정적, 브랜드 로열티 낮음

☑  미니 선풍기 USB             ❌ 탈락 (검색량 42,000 · 경쟁 1,204)
   이유: 여름 시즌 수요 높음
```

- 통과 항목 상단 정렬
- 탈락 항목 흐리게 (opacity 0.5) 표시, 체크박스 비활성화(기본) but 선택 가능

### 로딩 단계 UI

```
추천 받기 클릭 →
  "Claude가 키워드를 분석하는 중..." (1~3초)
  "네이버에서 검색량을 조회하는 중..." (2~5초)
  결과 표시
```

---

## 변경 범위

| 파일 | 변경 유형 |
|------|---------|
| `src/lib/naver-ad.ts` | 신규 — 검색광고 API 클라이언트 |
| `src/app/api/naver/keyword-stats/route.ts` | 신규 — keyword stats 라우트 |
| `src/app/api/ai/keyword-suggest/route.ts` | 수정 — enriched 응답 + 프롬프트 수정 |
| `src/components/sourcing/KeywordTrackerTab.tsx` | 수정 — 모달 UI 업데이트 |

**변경하지 않는 것:** 수동 입력 폼, 저장/삭제 로직, 통과 판정 기준, 다른 소싱 탭
