# 상품 발굴 (Product Discovery) — 시드 발굴 재설계

**작성일:** 2026-05-01
**상태:** 설계 완료, 사용자 검토 대기
**관련 영상/문서:**
- `[잘 팔리는 상품 소싱? 쿠팡, 스마트스토어 키워드 찾는법 (2026-03-10)]`
- `[쿠팡강연유출 — 로켓그로스 억대셀러 소싱법 (2025-09-29)]`
- `[초보가 소싱이 어려운 이유 (2025-11-17)]`
- `[로켓그로스 소싱은 딱 이렇게 하세요. 100만원으로 시작하기 (2025-11-04)]`

---

## 1. 배경

### 1.1 기존 시드 발굴 탭의 본질적 한계

2주간 개발한 시드 발굴 탭은 다음 흐름이었다:

```
카테고리 선택 → 시드 키워드 → 자동완성 → 검색량 필터 → 후보 키워드
```

이 흐름은 사용자가 "추천된 키워드들이 모두 쿠팡 리뷰 1만+ 시장이라 채널 기준 50개 미만 만족 키워드가 0개"라는 문제를 반복 보고했다.

### 1.2 진짜 원인: 채널 흐름과 반대 방향

making-money-hippo 채널 검증 결과, 채널이 일관되게 가르치는 흐름은 다음과 같다:

> "키워드를 먼저 쥐고 상품을 찾으면 결국 레드오션만 나온다"
> — `[잘 팔리는 상품 소싱? (2026-03-10)]`

```
도매꾹/1688 상품 훑기
  → 손가락 느낌 가는 상품 5~10개
  → 그 상품의 이름/속성으로 키워드 역추출
  → 검색량(3k~30k) + 쿠팡 리뷰(<50개) 검증
  → 통과 시 발주/등록
```

기존 우리 시드 발굴 탭은 **순서가 정확히 반대**였다. 검색량/CTR/compIdx 등 알고리즘을 아무리 조정해도 본질이 안 변했다.

또한 "검색량 3k~30k + 리뷰 50개 미만"은 채널의 **검증 통과 기준**이지, **발굴 알고리즘 입력값**이 아니라는 것을 인용으로 확인했다.

### 1.3 환경 제약

- **쿠팡 자동 검증 불가** — coupang.com 봇 차단 (Access Denied)
- **네이버 데이터로 쿠팡 추정 부정확** — 카탈로그가 다름
- **자동화 100%는 채널 정신과 어긋남** — 채널은 "결국 눈으로 봐야 안다" 강조

---

## 2. 목표 및 성공 기준

### 2.1 목표

채널이 가르치는 "상품 → 키워드 역추출 → 검증 → 등록" 흐름을 도구로 지원한다.

### 2.2 성공 기준

1. 사용자가 도매꾹/1688/외부 어디서든 본 상품을 도구에 입력할 수 있다.
2. AI가 그 상품에서 5~10개의 후보 키워드를 제안한다.
3. 사용자가 채택/추가/삭제로 최종 키워드 셋을 확정한다.
4. 자동 검색량 측정 + 사용자 수동 쿠팡 리뷰 입력으로 통과 키워드를 골라낸다.
5. 통과 키워드와 상품 정보가 상품등록 탭으로 끊김 없이 연결된다.

---

## 3. 결정 사항 (브레인스토밍 합의)

| 영역 | 결정 |
|------|------|
| 탭 정체성 | 기존 시드 발굴 탭을 **"🌱 상품 발굴"** 로 리네임 + 워크플로우 새로 |
| 도매꾹 탭과의 관계 | 도매꾹 탭은 **보조 진입점** (선택 사항). 메인은 직접 입력 |
| 진입점 형태 | **텍스트 입력 + URL 붙여넣기** 동시 지원 |
| 키워드 추출 | **AI 제안 + 사용자 편집** (후보 5~10개 제안 → 사용자가 채택/추가/삭제) |
| 검증 범위 | **검색량 자동 + 쿠팡 리뷰 수동 입력** (마진은 별도 마진계산기 탭) |
| 다음 단계 | **DB 저장 + 상품등록 탭 자동 연결** |
| 워크플로우 | **3단계 압축** (입력 → 검증 → 결과·등록) |

---

## 4. 아키텍처

### 4.1 전체 흐름

```
[도매꾹 탭]                       [🌱 상품 발굴 탭]
   │                                   │
   │ "검증 보내기" (선택)              │ 사용자 직접 진입 (메인)
   └──→ 상품 정보 전달 ───────────────→├ Step 1: 상품 입력 + AI 키워드
                                      │   - 텍스트 OR 도매꾹 URL
                                      │   - AI가 5~10개 키워드 제안
                                      │   - 사용자가 채택/추가/삭제
                                      │
                                      ├ Step 2: 검증
                                      │   - 검색량 자동 (Naver Ad API)
                                      │   - 쿠팡 리뷰 수동 입력
                                      │
                                      └ Step 3: 결과 + 다음 단계
                                          - 통과 키워드 + 상품 정보 저장
                                          - "상품등록 탭으로 보내기" 버튼
                                                    │
                                                    ↓
                                              [상품등록 탭 — 자동 채움]
```

### 4.2 컴포넌트 구조

```
src/
├─ app/api/sourcing/
│   ├─ product-discover/
│   │   ├─ extract-keywords/route.ts   POST — 상품명/URL → AI 키워드 추출
│   │   ├─ validate/route.ts            POST — 키워드 셋 → 검색량+CTR 검증
│   │   ├─ confirm/route.ts             POST — 통과 키워드 + 상품 → DB 저장
│   │   └─ parse-url/route.ts           POST — 도매꾹 URL → 상품 메타 추출
│   └─ seed-discover/                   ← 폐기 (deprecated, 라우트 제거)
│
├─ components/sourcing/
│   ├─ ProductDiscoveryTab.tsx          ← SeedDiscoveryTab.tsx 리네임/재구성
│   ├─ steps/
│   │   ├─ StepProductInput.tsx         Step 1
│   │   ├─ StepValidation.tsx           Step 2 (기존 StepReviewInput 재활용)
│   │   └─ StepResult.tsx               Step 3
│   └─ CriteriaPanel.tsx                기존 패널, 내용 갱신
│
├─ store/
│   └─ useProductDiscoveryStore.ts      ← useSeedDiscoveryStore.ts 리네임/단순화
│
├─ lib/sourcing/
│   ├─ ai-keyword-extract.ts            AI 호출 + 프롬프트 (신규)
│   ├─ domeggook-url-parser.ts          도매꾹 URL → 상품 정보 (신규)
│   └─ seed-scoring.ts                  기존 점수 산식 그대로
│
└─ types/sourcing.ts                    ProductCandidate 타입 추가
```

### 4.3 재활용 자산

- **DB 테이블**: `seed_sessions`, `sourcing_items.seed_keyword/seed_score/seed_session_id` 그대로 활용 (테이블 구조 변경 없음, 의미만 "시드 발굴" → "상품 발굴 세션"으로 재해석)
- **점수 산식**: `seed-scoring.ts` 그대로
- **검색량/자동완성 라이브러리**: `naver-ad.ts`, `naver-shopping.ts` 그대로
- **검증 UI**: 기존 `StepReviewInput`의 쿠팡 리뷰 입력 UX 재활용 (input + "쿠팡↗" 버튼 + 50개 이상 자동 탈락)

### 4.4 신규 작성

- 상품 입력 UI (텍스트/URL 토글 + 입력 필드)
- AI 키워드 추출 라이브러리 (`ai-keyword-extract.ts`) + 프롬프트 설계
- 도매꾹 URL 파서 (실패 시 텍스트 입력으로 fallback)
- 상품 메타데이터 → 상품등록 탭 전달 메커니즘 (`/listing?draftId=...`)

---

## 5. 데이터 흐름

### 5.1 시나리오: "16cm 펜트리수납함" 등록 결정

```
[Step 1 — 상품 입력]

사용자 액션:
  옵션 A: 텍스트 입력 "16cm 펜트리수납함 슬라이드형"
  옵션 B: 도매꾹 URL 붙여넣기 "https://domeggook.com/main/item.php?id=..."

URL인 경우 → POST /api/sourcing/product-discover/parse-url
            ← { title, image, price, supplyPrice, marketPrice }

→ POST /api/sourcing/product-discover/extract-keywords
  body: { productTitle: "16cm 펜트리수납함 슬라이드형" }
  AI 프롬프트: "쿠팡/네이버에서 검색할 만한 키워드 5~10개 제안"
  ← { suggestions: ["펜트리수납함", "슬라이드수납함", "16cm수납함",
                    "주방펜트리", "슬라이드정리함", ...] }

UI: AI 후보를 칩으로 표시 → 사용자가 채택/삭제 + 직접 추가
    [최종 키워드 셋: 5~7개 확정]


[Step 2 — 검증]

→ POST /api/sourcing/product-discover/validate
  body: { keywords: [...], productInfo }
  병렬:
    - Naver Ad API → 검색량 + compIdx + 평균 CTR
    - Naver Shopping API → 경쟁상품수
  ← { results: [
        { keyword, searchVolume, compIdx, avgCtr, competitorCount, passed }
      ] }

UI: 키워드별 데이터 표시 + "쿠팡↗" 버튼
    사용자가 상위 3개 중 최대 리뷰수 입력
    50개 이상 자동 X 표시


[Step 3 — 결과 + 등록]

사용자: 50개 미만 통과 키워드 N개 선택 → "상품등록 보내기"

→ POST /api/sourcing/product-discover/confirm
  body: { sessionId, productInfo, keywords: [...passed] }
  DB:
    - seed_sessions: state_json에 productInfo + keywords, status='confirmed'
    - sourcing_items: 도매꾹 URL인 경우 itemNo 매칭 + seed_keyword/seed_score 업데이트
  ← { success: true, listingDraftId: "..." }

클라이언트: window.location → /listing?draftId=...
            상품등록 탭이 productInfo + keywords 자동 채움
```

### 5.2 강조 포인트

- **AI 호출은 한 번만** (Step 1) — 이후 검증/저장은 비-AI
- **검색량/경쟁수는 병렬 호출** — 응답 시간 최소화
- **상품등록 연결**은 URL 파라미터(`draftId`) + DB 세션 ID로 안전하게 전달

---

## 6. AI 키워드 추출 설계

### 6.1 프롬프트 (초안 — 구현 단계에서 정밀 튜닝)

```
당신은 한국 e-commerce 키워드 발굴 전문가입니다.

다음 상품 정보를 보고, 한국 소비자가 쿠팡/네이버 쇼핑에서 검색할 만한
키워드 후보를 5~10개 제안해 주세요.

상품명: {productTitle}
[추가 정보(있는 경우)]: {description}, {category}

원칙:
1. 단순한 카테고리어("수납함", "방향제")는 피하고, 2단어 이상 조합 위주
2. 사용 상황/속성/타겟을 포함한 long-tail 키워드 위주
3. 너무 좁지도 너무 넓지도 않은 검색량 3k~15k 범위가 가능한 키워드
4. 각 키워드는 한국어, 띄어쓰기 없는 형태 또는 자연스러운 형태

JSON 응답:
{
  "keywords": ["키워드1", "키워드2", ...]
}
```

### 6.2 모델 선택

- **Gemini Flash** (저비용, 한국어 OK) — 1차 후보
- **Claude Sonnet** (고품질, 비용 중간) — fallback 또는 비교 옵션

구현 단계에서 비용/품질 비교 후 결정.

### 6.3 응답 검증

- JSON 파싱 실패 → null 반환 → UI에서 fallback("키워드 직접 입력")
- 응답 키워드 0개 → 사용자 직접 입력 모드만 활성화

---

## 7. URL 파싱

### 7.1 지원 범위 (MVP)

- **도매꾹 URL** (`domeggook.com/main/item.php?id=...`): 우리 코드에 이미 fetcher 있음 (`lib/sourcing/domeggook-fetcher.ts` 등) → 재활용
- **1688/알리/기타**: MVP에서 미지원. UI에 "현재 도매꾹 URL만 자동 파싱됩니다" 안내

### 7.2 파싱 결과

```typescript
interface ProductInfo {
  source: 'manual' | 'domeggook';
  title: string;
  image?: string;
  price?: number;
  supplyPrice?: number;
  marketPrice?: number;
  itemNo?: number; // 도매꾹 상품번호 (있는 경우)
}
```

### 7.3 실패 처리

- 도매꾹 URL이지만 차단/타임아웃 → "URL 파싱 실패. 상품명을 직접 입력해 주세요" + 텍스트 입력으로 자동 전환

---

## 8. 검증 단계 상세

### 8.1 자동 측정

- **검색량 + CTR + compIdx**: Naver Ad keywordstool API (현재 기존 코드 그대로)
- **경쟁상품수**: Naver Shopping API total
- **노출가능성 ratio**: 검색량 / 경쟁상품수 × 1000

### 8.2 수동 측정

- **쿠팡 상위 리뷰**: 사용자가 쿠팡에서 직접 검색 → 상위 3개 중 최대값 입력
  - 50개 이상 → 자동 탈락 표시 (RED)
  - 0~49개 → 통과 가능 (점수 산출)
- **"쿠팡↗" 버튼**: 키워드별 단독 새 탭, 또는 전체 일괄 열기

### 8.3 통과 기준

- 검색량 3,000 ~ 15,000 (자동)
- 쿠팡 리뷰 50개 미만 (수동)
- compIdx '높음' 시 점수 페널티 (-5)
- CTR 1% 미만 시 검색량 점수 50% 감점

---

## 9. 결과 + 상품등록 연결

### 9.1 결과 화면 표시

- 통과 키워드(50개 미만)는 점수 순 정렬
- 각 키워드: 검색량, 경쟁수, CTR, compIdx, 시드 점수, 등급(S/A/B/C/D)
- 사용자가 등록할 키워드 N개 체크 (default: 점수 상위 모두 체크)

### 9.2 상품등록 탭 연결

```
사용자 클릭 "상품등록 보내기"
   ↓
POST /api/sourcing/product-discover/confirm
   - seed_sessions UPDATE: state_json={productInfo, selectedKeywords}, status='confirmed'
   - sourcing_items UPSERT (도매꾹 상품인 경우만): seed_keyword/seed_score 매핑
   ← { listingDraftId: <UUID> }
   ↓
클라이언트: router.push(`/listing?draftId=${listingDraftId}`)
   ↓
[상품등록 탭]
   - draftId 받음 → seed_sessions에서 데이터 로드
   - 상품명/이미지/가격 자동 채움
   - SEO 제목 추천에 키워드 셋 활용
   - 검색태그에 통과 키워드 자동 추가
```

**상품등록 탭의 변경 범위**: 최소화. `/listing?draftId=...` URL을 받았을 때 해당 세션 데이터를 로드해서 폼에 채우는 hook 1개 추가.

---

## 10. 에러 처리

| 단계 | 실패 상황 | 처리 |
|------|----------|------|
| Step 1 | 도매꾹 URL fetch 차단/타임아웃 | "URL 파싱 실패. 상품명 직접 입력" + 텍스트 모드 전환 |
| Step 1 | 지원 안 되는 URL (1688/알리) | "도매꾹 URL만 자동 파싱. 상품명 직접 입력" |
| Step 1 | AI 호출 실패 | "AI 추천 실패. 키워드 직접 입력" + 직접 입력 모드 fallback |
| Step 1 | AI 응답 JSON 파싱 실패 | 위와 동일 |
| Step 2 | Naver Ad API 키 누락 | 500 + 명시적 에러 (기존 동일) |
| Step 2 | 키워드 검색량 0 또는 데이터 없음 | "데이터 없음" 표시. 진행 가능 (점수 0) |
| Step 2 | Naver Shopping 실패 | "측정 불가" 표시. 노출가능성 보정 0 |
| Step 2 | 쿠팡 리뷰 미입력 | 다음 단계 잠금 (기존 동일) |
| Step 3 | DB 저장 실패 | UI 에러 + 재시도 버튼. store 상태 보존 |
| Step 3 | /listing 이동 실패 | DB 저장된 상태이므로 사용자 수동 이동 가능 |

**원칙:**
- AI 실패 = fallback 가능 (사용자 직접 입력)
- 외부 API 실패 = 부분 진행 (데이터 없는 항목은 표시하고 통과)
- DB 실패만 차단

---

## 11. 테스트 전략

| 영역 | 종류 | 대상 |
|------|------|------|
| AI 키워드 추출 | 단위 (mock) | `extractKeywordsFromProduct()` — 입력→출력 형식, 에러 처리 |
| 도매꾹 URL 파서 | 단위 (mock fetch) | 정상 URL → 파싱 결과, 실패 → null |
| AI 프롬프트 안정성 | 스냅샷 | 프롬프트 변경 시 응답 형식 검증 |
| 검증 라우트 | 통합 (mock Naver) | 키워드 셋 → 결과 형식 |
| 저장 라우트 | 통합 (실 DB or mock pool) | INSERT/UPSERT/롤백 |
| 점수 산식 | 단위 | 기존 28개 테스트 그대로 유지 |
| Step 1 컴포넌트 | RTL | 텍스트/URL 토글, AI 호출 트리거, 키워드 칩 |
| Step 2 컴포넌트 | RTL | 입력 칸, 50 이상 자동 X, 잠금 |
| Step 3 컴포넌트 | RTL | 통과 표시, 상품등록 이동 (router mock) |
| E2E | Playwright | 텍스트 입력 → AI(mock) → 검증 → 등록 (MVP 이후) |

**우선순위:** 단위 → API 통합 → 컴포넌트 → E2E

---

## 12. 마이그레이션 / 폐기

### 12.1 기존 시드 발굴 탭

- `SeedDiscoveryTab.tsx` → `ProductDiscoveryTab.tsx`로 리네임 + 새 워크플로우
- 기존 7단계 워크플로우 코드(StepCategorySelect 등) 폐기
- `useSeedDiscoveryStore.ts` → `useProductDiscoveryStore.ts`로 리네임 + 단순화
- `/api/sourcing/seed-discover/*` 라우트 폐기 (또는 410 Gone)

### 12.2 DB

- `seed_sessions` 테이블 그대로 (의미만 재해석)
- `sourcing_items.seed_*` 컬럼 그대로
- 마이그레이션 스크립트 불필요

### 12.3 사용자 데이터

- 기존 `seed_sessions` 데이터(카테고리 기반)는 그대로 보존 (사용자가 이력으로 볼 수 있음)
- 새로 생성되는 세션은 카테고리 빈 배열 + state_json에 productInfo 포함

---

## 13. 범위 외 (Out of Scope)

- 1688/알리익스프레스 URL 자동 파싱 (MVP 이후 검토)
- AI가 이미지 분석으로 키워드 추출 (텍스트 기반 MVP만)
- 쿠팡 자동 리뷰 측정 (기술적 차단)
- 마진 계산 통합 (별도 마진계산기 탭 활용)
- 키워드 추세/성장률 분석 (HELP STORE 같은 신규 키워드 필터)
- E2E 테스트 (MVP 이후 추가)

---

## 14. 다음 단계

이 spec 사용자 승인 후 → `superpowers:writing-plans` 스킬로 단계별 구현 플랜 작성.
