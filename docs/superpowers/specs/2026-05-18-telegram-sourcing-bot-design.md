# 텔레그램 소싱 봇 + 소싱에이전트 탭 리뉴얼 설계

## 개요

텔레그램 봇을 통해 원격으로 상품 소싱 분석을 실행하고, Smart Seller Studio의 소싱에이전트 탭에서 결과 이력을 관리하는 시스템.

**핵심 원칙**
- 쿠팡 크롤링 완전 제거 (봇 감지 리스크 Zero)
- 사용자는 상품명만 보내면 됨 (가격 입력 불필요)
- 네이버쇼핑으로 소비자가 자동 조회
- PC 없이도 텔레그램으로 원격 소싱 가능

---

## 사용자 플로우

```
1. 사용자가 쿠팡 앱에서 관심 상품 발견
2. 상품명 복사
3. 텔레그램 봇에 상품명 전송
4. 봇이 즉시 "분석 시작" 메시지 응답
5. 백그라운드에서 분석 실행 (30초~3분)
6. 결과 텔레그램으로 수신
7. 앱 소싱에이전트 탭에서 이력 확인
```

---

## 아키텍처

```
[텔레그램]
    │ 상품명 전송
    ▼
POST /api/telegram/webhook
    │ 200 즉시 응답 (Telegram 30초 타임아웃 회피)
    │ waitUntil()로 백그라운드 분석 실행
    ▼
keyword-pipeline.ts
    ├─ 네이버쇼핑 검색 → 소비자 판매가 확인
    ├─ Domeggook 검색 → 상위 10개 도매 상품
    ├─ 각 상품: 1688 매칭 + 마진 계산
    ├─ 마진 30% 미만 필터링
    ├─ 마진 내림차순 상위 5개 DB 저장
    └─ 텔레그램으로 결과 전송

[Smart Seller Studio]
소싱에이전트 탭 → keyword_sourcing_requests 조회 → 결과 이력 표시
```

---

## DB 스키마

### 신규 테이블

```sql
-- 소싱 요청 이력
CREATE TABLE keyword_sourcing_requests (
  id            SERIAL PRIMARY KEY,
  keyword       TEXT NOT NULL,
  chat_id       TEXT,                     -- 텔레그램 채팅 ID
  status        TEXT DEFAULT 'pending',   -- pending | done | error
  error_message TEXT,
  requested_at  TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- 요청 당 최대 5개 결과 (마진 내림차순)
CREATE TABLE keyword_sourcing_results (
  id                     SERIAL PRIMARY KEY,
  request_id             INTEGER NOT NULL REFERENCES keyword_sourcing_requests(id) ON DELETE CASCADE,
  rank                   INTEGER NOT NULL,   -- 1~5위
  naver_price            INTEGER,            -- 네이버쇼핑 소비자가 (원)
  naver_url              TEXT,
  domeggook_product_name TEXT,
  domeggook_price        INTEGER,            -- 도매꾹 도매가 (원)
  domeggook_url          TEXT,
  domeggook_image_url    TEXT,
  domeggook_margin_rate  NUMERIC,            -- 도매꾹 기준 마진율 (%)
  china_product_name     TEXT,
  china_price_krw        INTEGER,            -- 1688 소싱가 원화 환산
  china_url              TEXT,
  china_margin_rate      NUMERIC,            -- 1688 기준 마진율 (%)
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON keyword_sourcing_requests(requested_at DESC);
CREATE INDEX ON keyword_sourcing_results(request_id);
```

### 삭제 테이블
- `sourcing_agent_results`
- `sourcing_agent_categories`

---

## 파일 변경 목록

### 신규 생성
| 파일 | 역할 |
|------|------|
| `src/app/api/telegram/webhook/route.ts` | 텔레그램 webhook 수신, waitUntil 백그라운드 실행 |
| `src/lib/telegram/client.ts` | Telegram Bot API 호출 (sendMessage) |
| `src/lib/sourcing-agent/keyword-pipeline.ts` | 키워드 기반 소싱 분석 파이프라인 |
| `src/lib/sourcing-agent/keyword-db.ts` | 신규 DB 테이블 CRUD |

### 수정
| 파일 | 변경 내용 |
|------|----------|
| `src/components/sourcing/SourcingAgentTab.tsx` | 전면 리뉴얼 (이력 뷰어로 교체) |
| `src/app/api/sourcing/agent/results/route.ts` | 신규 테이블 조회로 교체 |

### 삭제
| 파일 | 이유 |
|------|------|
| `src/lib/sourcing-agent/coupang-crawler.ts` | 쿠팡 크롤링 제거 |
| `src/lib/sourcing-agent/pipeline.ts` | 카테고리 기반 파이프라인 대체 |
| `src/lib/sourcing-agent/domeggook-matcher.ts` | 이미지 유사도 기반 매칭 → 키워드 직접 검색으로 교체 |
| `src/lib/sourcing-agent/image-similarity.ts` | domeggook-matcher.ts 삭제로 참조 없어짐 |
| `src/app/api/sourcing/agent/run/route.ts` | 텔레그램 webhook으로 대체 |
| `src/app/api/sourcing/agent/categories/route.ts` | 카테고리 개념 제거 |

---

## 키워드 파이프라인 상세

이미지 유사도 비교 없이 키워드 직접 검색 방식으로 동작한다.
기존 `matchOnDomeggook()`(이미지 필요) 대신 `getDomeggookClient().getItemList()`를 직접 사용한다.
`extractKeywordsFromProduct()`는 재사용해 상품명에서 검색 키워드를 AI로 추출한다.

```typescript
// keyword-pipeline.ts
async function runKeywordPipeline(keyword: string, chatId: string) {
  // 1. 요청 DB 저장 (status: pending)
  // 2. 네이버쇼핑 searchNaverLowestPrice(keyword) → 소비자가
  // 3. extractKeywordsFromProduct(keyword) → 검색 키워드 추출
  // 4. getDomeggookClient().getItemList({keyword, pageSize: 10}) → 도매꾹 후보 10개
  // 5. 각 후보 상품:
  //    a. 도매꾹 마진율 계산 (네이버가 기준)
  //    b. 30% 미만 제외
  //    c. matchOn1688() → 1688 소싱가 + 마진율
  // 6. 마진 내림차순 상위 5개 DB 저장
  // 7. status: done, completed_at 갱신
  // 8. 텔레그램 결과 메시지 전송
}
```

---

## 텔레그램 메시지 포맷

**사용자 입력**
```
라 사본느리 드 니옹 프랑스 비누 대형 틴케이스
```

**봇 즉시 응답**
```
🔍 분석 시작합니다
📦 라 사본느리 드 니옹 프랑스 비누 대형 틴케이스
잠시만 기다려주세요...
```

**결과 메시지**
```
✅ 소싱 분석 완료
📦 라 사본느리 드 니옹 프랑스 비누 대형 틴케이스
💰 네이버 판매가: 28,900원

─────────────────
🥇 1위 | 도매꾹 마진 42.3%
  도매꾹: 12,800원 → [링크]
  1688:  8,200원  → [링크] (마진 71.6%)

🥈 2위 | 도매꾹 마진 35.1%
  도매꾹: 14,500원 → [링크]
  1688:  없음
─────────────────
전체 결과는 소싱에이전트 탭에서 확인
```

**에러 메시지**
```
❌ 분석 실패
📦 라 사본느리 드 니옹 프랑스 비누 대형 틴케이스
도매꾹에서 매칭 상품을 찾지 못했습니다.
```

---

## 소싱에이전트 탭 UI

```
┌─────────────────────────────────────────────┐
│ 소싱 에이전트                                │
│ 텔레그램 봇에 상품명을 보내면 자동 분석됩니다  │
├─────────────────────────────────────────────┤
│ [전체 23건]  [이번 주 5건]  [평균 마진 38%]  │
├─────────────────────────────────────────────┤
│ 🔍 키워드 검색...                            │
├─────────────────────────────────────────────┤
│ ● 라 사본느리 드 니옹 프랑스 비누...          │
│   2026-05-18 14:32  ✅ 완료  마진 최고 42%   │
│   ▼ 결과 보기                               │
│   ┌─────────────────────────────────────┐   │
│   │ 1위  도매꾹 42.3%  │ 1688 71.6%    │   │
│   │ 네이버 28,900원                      │   │
│   │ 도매꾹 12,800원  [링크]              │   │
│   │ 1688  8,200원   [링크]              │   │
│   └─────────────────────────────────────┘   │
│                                             │
│ ● 무선 청소기 흡입력 강력...                  │
│   2026-05-18 11:15  ⏳ 분석 중...           │
│                                             │
│ ● 주방 실리콘 주걱 세트...                   │
│   2026-05-17 09:40  ✅ 완료  마진 최고 35%  │
└─────────────────────────────────────────────┘
```

---

## 환경 변수

```env
TELEGRAM_BOT_TOKEN=         # 텔레그램 봇 토큰 (@BotFather 발급) — 신규
TELEGRAM_WEBHOOK_SECRET=    # webhook 검증용 시크릿 (임의 생성) — 신규
NAVER_CLIENT_ID=            # 네이버 오픈API 클라이언트 ID — 기존
NAVER_CLIENT_SECRET=        # 네이버 오픈API 시크릿 — 기존
```

---

## Webhook 설정

배포 후 한 번 실행:
```
POST https://api.telegram.org/bot{TOKEN}/setWebhook
  url: https://{vercel-domain}/api/telegram/webhook
  secret_token: {TELEGRAM_WEBHOOK_SECRET}
```

---

## 마진 계산 기준

- **도매꾹 마진율** = (네이버가 - 도매꾹가) / 네이버가 × 100
- **1688 마진율** = (네이버가 - 1688가) / 네이버가 × 100
- 도매꾹 마진 30% 미만 상품은 결과에서 제외
- 결과 없음 시 에러 메시지 전송
