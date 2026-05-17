# 소싱 자동화 에이전트 설계

**날짜**: 2026-05-16  
**작성자**: Seungmin Lee  

---

## Context

돈버는하마 채널의 소싱 패턴(쿠팡 세부 카테고리 판매순위 → 도매꾹/1688 동일 아이템 매칭 → 마진 검증)을 자동화한다. 하루 5개 소싱 후보를 발굴해 앱 내 탭에서 확인하는 에이전트.

---

## 전체 아키텍처

```
[cron 오전 6시 / 수동 트리거]
         ↓
[1단계] 쿠팡 카테고리 크롤러
  - Playwright stealth (AutomationControlled 차단, 랜덤 딜레이 2~5초)
  - 세부 카테고리 1개 선택 (last_crawled_at 기준 순환)
  - 판매량 상위 20개: 상품명 + 이미지 URL + 쿠팡 상품 URL 수집
         ↓
[2단계] 매칭 엔진
  - ai-keyword-extract.ts → 핵심 키워드 추출
  - domeggook-client.ts → 키워드 검색 → 후보 5~10개 + 도매꾹 URL
  - Claude Vision → 이미지 유사도 비교 (80% 이상만 매칭 확정)
  - 1688 병렬 검색 → 중국어 키워드 변환 → 1688 URL
         ↓
[3단계] 마진 계산
  - domeggook-pricing.ts → 도매꾹 위탁 마진
  - margin-1688.ts → 관세/배송비 포함 사입 마진
  - 마진율 30% 미만 자동 제외
         ↓
[4단계] 상위 5개 저장 (마진율 내림차순)
  - Render PostgreSQL → sourcing_agent_results 테이블
  - 동일 쿠팡 상품 ID 30일 내 중복 차단
```

---

## 카테고리 풀 (세부 카테고리)

**제외**: 식품/음료, 가전/전자기기, 가구/대형가전, 신선식품, 의약품

**순환 대상 세부 카테고리 (30일 간격 재탐색)**

| 분류 | 세부 카테고리 |
|---|---|
| 생활용품 | 욕실 수납함, 지퍼백/위생봉투, 칫솔/치약홀더, 걸레/밀대, 계량도구/주방타이머 |
| 수납/정리 | 케이블 정리함, 서랍 정리대, 냉장고 정리함 |
| 반려견용품 | 장난감, 리드줄/하네스, 의류/코스튬, 배변패드 |
| 반려묘용품 | 장난감, 스크래처, 급수기/식기 |
| 뷰티소품 | 헤어핀/헤어밴드, 네일스티커, 화장솜/면봉 |
| 유아소품 | 목욕완구, 이유식 도구, 치발기 |
| 캠핑소품 | 캠핑 식기, 캠핑 조명, 캠핑 수납 |
| 피트니스 소품 | 폼롤러, 요가블록, 미니 밴드 |
| 문구/오피스 | 볼펜/형광펜 세트, 포스트잇, 다이어리/노트 |

**상품 크기 필터**: 최대 변 50cm 이하, 무게 5kg 이하

---

## DB 스키마 (Render PostgreSQL)

```sql
-- 카테고리 관리
CREATE TABLE sourcing_agent_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,                    -- 예: '욕실 수납함'
  coupang_category_url TEXT NOT NULL,    -- 쿠팡 카테고리 URL
  last_crawled_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

-- 소싱 결과
CREATE TABLE sourcing_agent_results (
  id SERIAL PRIMARY KEY,
  crawled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category_id INT REFERENCES sourcing_agent_categories(id),

  -- 쿠팡 데이터
  coupang_product_id TEXT NOT NULL,
  coupang_product_name TEXT NOT NULL,
  coupang_rank INT,
  coupang_price INT,
  coupang_image_url TEXT,
  coupang_url TEXT NOT NULL,

  -- 도매꾹 매칭
  domeggook_product_name TEXT,
  domeggook_price INT,
  domeggook_url TEXT,
  domeggook_image_url TEXT,
  domeggook_similarity FLOAT,           -- Vision 유사도 점수

  -- 1688 매칭
  china_product_name TEXT,
  china_price_krw INT,                  -- 관세/배송비 포함 원화 환산
  china_url TEXT,
  china_image_url TEXT,

  -- 마진
  domeggook_margin_rate FLOAT,          -- 도매꾹 위탁 마진율
  china_margin_rate FLOAT,              -- 1688 사입 마진율

  UNIQUE(coupang_product_id, crawled_at::DATE)
);
```

---

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/sourcing/agent/run` | 수동 실행 (카테고리 선택 가능) |
| GET | `/api/sourcing/agent/results` | 결과 목록 조회 (필터/정렬) |
| GET | `/api/sourcing/agent/categories` | 카테고리 목록 + last_crawled_at |
| POST | `/api/sourcing/cron` | 기존 cron 패턴 재활용 |

---

## UI — '소싱 에이전트' 탭

**결과 테이블 컬럼**

| 쿠팡 상품명 | 카테고리 | 쿠팡 순위 | 도매꾹가 | 1688가(원) | 마진율 | 발굴일 | 출처 |
|---|---|---|---|---|---|---|---|
| 실리콘 냄비받침 4P | 욕실수납 | 3위 | 2,300원 | 980원 | 42% | 5/16 | 쿠팡↗ 도매꾹↗ 1688↗ |

**상세 슬라이드오버**
- 쿠팡 / 도매꾹 / 1688 이미지 나란히 표시
- 유사도 점수 배지
- 쿠팡 URL / 도매꾹 URL / 1688 URL 바로가기 버튼 3개

**수동 트리거**
- "지금 소싱" 버튼 → 카테고리 드롭다운 → 실행
- 진행 상태 표시: 크롤링 → 매칭 → 마진계산 → 완료

---

## 재활용 기존 코드

| 파일 | 용도 |
|---|---|
| `src/lib/sourcing/ai-keyword-extract.ts` | 상품명 → 핵심 키워드 추출 |
| `src/lib/sourcing/domeggook-client.ts` | 도매꾹 검색 |
| `src/lib/sourcing/domeggook-pricing.ts` | 도매꾹 마진 계산 |
| `src/lib/sourcing/margin-1688.ts` | 1688 마진 계산 |
| `src/lib/ai/claude-vision.ts` | 이미지 유사도 비교 |
| `src/app/api/sourcing/cron/` | 스케줄러 패턴 |

---

## 스케줄링

- **자동**: 매일 오전 6시 cron → `last_crawled_at` 가장 오래된 카테고리 1개 선택 → 상위 20개 크롤 → 필터 후 5개 저장
- **수동**: UI 버튼 → 즉시 실행
- **중복 방지**: 동일 `coupang_product_id` 30일 내 재저장 차단 / 동일 카테고리 30일 간격 재탐색

---

## 크롤링 anti-detection 조치

- Playwright `--disable-blink-features=AutomationControlled`
- 페이지 이동 간 랜덤 딜레이 2~5초
- 자연스러운 스크롤 시뮬레이션
- Chrome 최신 User-Agent 사용
- 결과 DB 캐시 → 당일 재요청 없음

---

## 검증 방법

1. `POST /api/sourcing/agent/run` 수동 실행 → 결과 5개 반환 확인
2. 쿠팡 URL / 도매꾹 URL / 1688 URL 모두 유효한 링크인지 확인
3. 마진율 30% 미만 상품이 결과에 없는지 확인
4. 30일 내 동일 상품 재등록 차단 동작 확인
5. 카테고리 순환 — `last_crawled_at` 업데이트 확인
