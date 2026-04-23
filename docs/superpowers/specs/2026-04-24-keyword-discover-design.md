# 키워드 발굴 — 트렌드 기반 시드 확장 설계

**날짜:** 2026-04-24
**상태:** 승인됨

---

## 개요

`/sourcing > 키워드 목록`의 AI 추천이 Claude가 상상으로 생성한 일반적·인기 키워드를 반환해, 실제 ItemScout 검색 시 경쟁상품수가 너무 많아 소싱 조건에 맞지 않는다. 근본 원인은 Claude에게 "발굴"을 맡겼기 때문이다 — AI는 데이터 없이 저경쟁 키워드를 알 수 없다.

해결책: 실시간 트렌드(YouTube·인스타그램·쓰레드·네이버 DataLab)에서 **씨드 키워드**를 먼저 수집하고, 네이버 검색광고 API의 `hintKeywords` 확장으로 관련 키워드를 100+개 뽑은 뒤, 검색량·경쟁상품수로 필터링 → AI 평가 순서로 처리한다.

---

## 결정 사항

| 항목 | 결정 |
|------|------|
| 트렌드 수집 | Gemini 2.0 Flash + google_search grounding (별도 API 키 불필요) |
| 플랫폼 | YouTube, 인스타그램, 쓰레드, Naver DataLab |
| 씨드 저장 | Render PostgreSQL `trend_seeds` 테이블 (getSourcingPool) |
| 갱신 주기 | 매일 1회 크론 (KST 오전 11시 = UTC 02:00) |
| 키워드 확장 | Naver 검색광고 API hintKeywords → 모든 relKeyword 수집 |
| 필터 조건 | 검색량 2,000~50,000 AND 경쟁상품수 <500 |
| AI 평가 | 필터 통과 키워드 최대 30개를 기존 evaluateKeyword로 평가 |
| UI 진입점 | 기존 "AI 추천" 버튼 옆 "키워드 발굴" 버튼 |
| 결과 표시 | 기존 제안 모달과 동일 패턴 (pass/reasoning 포함) |
| 씨드 없을 때 | 기본 씨드 5개 폴백 사용 |

---

## 아키텍처

```
[Daily cron] GET /api/sourcing/cron/trend-seeds
  Gemini(google_search grounding)
    → "오늘 YouTube/인스타/쓰레드 한국 생활소비재 트렌드 키워드 10개"
    → JSON 파싱 → {keyword, source, reason}[]
  Render PostgreSQL trend_seeds 테이블에 UPSERT (seed_date, keyword UNIQUE)

[User clicks "키워드 발굴"]
POST /api/ai/keyword-discover
  1. trend_seeds에서 오늘 날짜 씨드 조회 (없으면 기본 씨드 폴백)
  2. expandKeywords(seeds[]):
     - hintKeywords로 Naver 검색광고 API 호출 (5개씩 배치)
     - parseKeywordStats → 모든 relKeyword + 검색량 수집
     - fetchCompetitorCounts → 관련 키워드 경쟁상품수 조회
  3. 필터: 검색량 2,000~50,000 AND 경쟁상품수 <500
  4. 검색량 내림차순 정렬, 상위 30개
  5. evaluateKeyword 병렬 평가
  6. 결과 반환 (pass/fail/reasoning 포함)
```

---

## 데이터 타입

```typescript
// trend_seeds 테이블
// seed_date DATE, keyword TEXT, source TEXT, reason TEXT
// UNIQUE(seed_date, keyword)

// DiscoveredKeyword (keyword-discover 응답)
interface DiscoveredKeyword {
  keyword: string;
  searchVolume: number;
  competitorCount: number;
  pass: boolean | null;
  reasoning: string | null;
}
```

---

## 신규/수정 파일

| 파일 | 변경 유형 | 역할 |
|------|---------|------|
| `src/lib/sourcing/trend-discovery.ts` | 신규 | Gemini grounding으로 트렌드 씨드 수집 |
| `src/lib/naver-ad.ts` | 수정 | `expandKeywords()` 추가 — 씨드 확장 |
| `src/app/api/sourcing/cron/trend-seeds/route.ts` | 신규 | 일일 크론: 씨드 수집 → Render DB 저장 |
| `src/app/api/ai/keyword-discover/route.ts` | 신규 | 사용자 트리거: 씨드 확장 → 필터 → AI 평가 |
| `src/components/sourcing/KeywordTrackerTab.tsx` | 수정 | "키워드 발굴" 버튼 + 결과 표시 |
| `vercel.json` | 수정 | 크론 스케줄 추가 |

**변경하지 않는 것:** keyword-evaluate, keyword-suggest, 기존 KeywordEntry 타입, localStorage 키, 기존 모달 UI 구조

---

## Gemini 프롬프트

```
오늘 한국에서 유행하는 생활용품·주방·청소·건강·반려동물 관련 소비재 트렌드를 
YouTube, 인스타그램, 쓰레드, 네이버 급상승 검색어에서 찾아줘.

이미 포화된 대형 카테고리(스마트폰, 노트북 등)는 제외.
2~3단어로 된 구체적 상품 키워드 10개를 아래 JSON 형식으로만 응답:
{"seeds": [{"keyword": "키워드", "source": "youtube|instagram|threads|naver", "reason": "트렌드 근거 1문장"}]}
```

---

## UI 변경

KeywordTrackerTab 헤더 영역:
```
[AI 추천]  [키워드 발굴 🔍]
```

- "키워드 발굴" 클릭 → 로딩 → 기존 제안 모달과 동일 구조로 결과 표시
- 모달 타이틀: "키워드 발굴 결과"
- 각 항목: 키워드명, 검색량, 경쟁상품수, ✅/❌ + reasoning 툴팁

---

## 폴백 씨드

trend_seeds에 오늘 데이터 없을 때 사용:
```typescript
const FALLBACK_SEEDS = ['주방용품', '생활용품', '청소용품', '반려동물', '캠핑용품'];
```
