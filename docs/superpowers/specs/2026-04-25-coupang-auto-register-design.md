# 쿠팡 자동등록 (URL → 쿠팡윙스) 기능 설계

**날짜:** 2026-04-25
**상태:** 승인됨

---

## 개요

도매꾹 또는 코스트코 코리아 상품 페이지 URL을 입력하면, AI가 상품 데이터를 가져와 쿠팡 등록 필드를 채우고 단계별 wizard로 사용자 확인을 거쳐 쿠팡윙스 API로 직접 등록하는 기능. 반복 등록을 통해 필드별 수정 패턴을 학습하고, 학습 완료 후 사용자가 자동 모드를 활성화하면 확인 없이 바로 등록된다.

---

## 결정 사항

| 항목 | 결정 |
|------|------|
| 실행 환경 | 웹 앱 UI (smart_seller_studio 내 새 페이지) |
| 등록 플랫폼 | 쿠팡윙스 단독 |
| 지원 소스 | 도매꾹, 코스트코 코리아(costco.co.kr) |
| UX 방식 | 단계별 wizard (6단계) |
| 자동화 기준 | 학습 기반 — N회 등록 후 사용자가 수동으로 자동 모드 활성화 |
| 기존 코드 재사용 | edit-thumbnail API, domeggook/prepare API, buildCoupangPayload() |

---

## 아키텍처

### 신규 파일

```
src/app/listing/auto-register/page.tsx
src/components/listing/auto-register/
  ├── UrlInputStep.tsx          ← URL 입력 + 상품 미리보기
  ├── WizardShell.tsx           ← 단계 진행 상태 표시
  └── steps/
      ├── Step1BasicInfo.tsx    ← 상품명, 카테고리, 브랜드
      ├── Step2PriceStock.tsx   ← 가격, 재고, 마진 미리보기
      ├── Step3Images.tsx       ← 썸네일 + 추가이미지 + AI 편집
      ├── Step4DetailPage.tsx   ← 상세페이지 HTML + AI 편집
      ├── Step5Delivery.tsx     ← 배송방법, 출하지, 반품센터
      └── Step6Keywords.tsx     ← 검색 태그 + 최종 확인 + 등록 버튼
src/app/api/auto-register/
  ├── parse-url/route.ts        ← URL → 상품 데이터 fetch
  └── ai-map/route.ts           ← 상품 데이터 → 쿠팡 필드 AI 매핑
src/lib/auto-register/
  ├── url-parser.ts             ← URL 패턴 → source + itemId 추출
  ├── ai-field-mapper.ts        ← Claude API 활용 필드 매핑
  └── learning-engine.ts        ← 수정 이력 관리 + 신뢰도 계산
```

### 재사용하는 기존 코드

| 기존 파일 | 재사용 목적 |
|----------|-----------|
| `src/lib/listing/coupang-client.ts` | `registerProduct()` 호출 |
| `src/lib/sourcing/domeggook-client.ts` | `getItemView(itemNo)` |
| `src/lib/sourcing/costco-client.ts` | OCC API 단일 상품 조회 (확장) |
| `src/lib/listing/payload-mappers.ts` | `buildCoupangPayload()` |
| `src/lib/listing/image-processor.ts` | 이미지 리사이즈 + 업로드 |
| `src/app/api/ai/edit-thumbnail/route.ts` | Step3 썸네일 AI 편집 |
| `src/app/api/listing/domeggook/prepare/route.ts` | 도매꾹 상세페이지 HTML 생성 |

---

## 데이터 흐름

```
사용자 입력 URL
      ↓
[url-parser.ts]
  도매꾹: domeggook.com/.../상품번호 → { source: 'domeggook', itemId }
  코스트코: costco.co.kr/p/상품코드  → { source: 'costco', itemId }
      ↓
[parse-url API route]
  도매꾹: domeggook-client.getItemView(itemNo)
  코스트코: costco.co.kr/p/{productCode} URL에서 추출한 코드로 OCC v2 API `/products/{code}` 단일 조회 (기존 costco-client 확장)
      ↓
[ai-map API route]  ← Claude API (claude-sonnet-4-6)
  입력: 상품명, 가격, 이미지URL 목록, 설명, 카테고리 힌트
  출력: 쿠팡 필드별 { value, confidence: 0~1 }
  예시:
  {
    sellerProductName:    { value: "OOO 3kg",   confidence: 0.95 },
    displayCategoryCode:  { value: "56137",      confidence: 0.72 },
    salePrice:            { value: 29900,        confidence: 0.88 },
    searchTags:           { value: ["키워드1"…], confidence: 0.60 }
  }
      ↓
[WizardShell]
  학습 미완료 또는 confidence < 0.8 필드 → wizard 표시
  학습 완료 + confidence ≥ 0.8 + 자동 모드 활성화 → 자동 통과
      ↓
[사용자 6단계 확인/수정]
      ↓
[auto_register_corrections 저장]
      ↓
[coupang-client.registerProduct()]
```

---

## Wizard 단계 상세

### Step 1 — 기본 정보
- 필드: 상품명(`sellerProductName`), 카테고리(`displayCategoryCode`), 브랜드
- AI 제안값 표시, 카테고리 불일치 시 카테고리 검색 UI 인라인 표시

### Step 2 — 가격 · 재고
- 필드: 판매가(`salePrice`), 재고(`stockQuantity`)
- 기존 `calcCoupangWing()` 활용한 마진 미리보기 표시

### Step 3 — 썸네일 편집
- 소스에서 가져온 원본 이미지 표시
- "AI 편집" 버튼 → instruction 입력 → 기존 `edit-thumbnail` API 호출
- "이 이미지로 진행" 확인 후 다음 단계

### Step 4 — 상세페이지 편집
- 도매꾹: `domeggook/prepare` API가 생성한 HTML 로드
- 코스트코: AI가 상품 데이터로 HTML 생성
- instruction chips로 추가 AI 편집 가능 (기존 Step3ReviewRegister 방식 재사용)

### Step 5 — 배송 · 반품
- `COUPANG_OUTBOUND_CODE`, `COUPANG_RETURN_CENTER_CODE` env값 자동 적용
- 변경 필요 시만 수정

### Step 6 — 검색 태그 · 최종 확인
- AI 키워드 제안 표시, 직접 추가/삭제 가능
- 전체 필드 요약 표시
- "쿠팡에 등록하기" 버튼

---

## 학습 엔진

### Supabase 테이블

```sql
CREATE TABLE auto_register_corrections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type    text NOT NULL,    -- 'domeggook' | 'costco'
  field_name     text NOT NULL,    -- 'sellerProductName' | 'displayCategoryCode' | ...
  ai_value       text,
  accepted_value text,
  was_corrected  boolean NOT NULL,
  created_at     timestamptz DEFAULT now()
);
```

### 학습 로직

- **기준**: `source_type` 별로 독립 계산 (도매꾹 학습이 코스트코에 영향 주지 않음). 필드별 최근 5회 등록 기록 사용.
- **신뢰 조건**: 5회 중 수정 없이 통과 비율 ≥ 80% → 해당 필드 "신뢰됨"
- **자동 모드 전환**: 해당 source_type의 모든 필드가 신뢰됨 상태가 되면 "자동 등록 모드 사용 가능" 배너 표시 → 사용자가 직접 활성화
- **자동 모드에서도**: 신뢰도 낮은 필드는 wizard로 표시

### UI 학습 진행 표시

```
[학습 현황] 6/8 필드 학습 완료  ████████░░  75%
자동 모드까지: 상품명, 카테고리 2개 필드 추가 학습 필요
```

### 썸네일 · 상세페이지 편집 학습

- 편집 instruction이 반복될 경우, 학습 엔진이 해당 instruction을 기본값으로 자동 적용 제안

---

## 에러 처리

| 상황 | 처리 |
|------|------|
| URL 패턴 불일치 | "지원하지 않는 URL 형식" 토스트, 입력 초기화 |
| 도매꾹/코스트코 API 실패 | 에러 메시지 + 재시도 버튼 |
| AI 매핑 타임아웃 (10초 초과) | 빈 필드로 wizard 진입 (사용자 직접 입력) |
| 쿠팡 API 등록 실패 | 에러 코드 + 원인 표시, wizard 마지막 단계에 머뭄 |
| 카테고리 코드 불일치 | 카테고리 검색 UI 인라인 표시 |

---

## 변경 범위

| 항목 | 유형 |
|------|------|
| `src/app/listing/auto-register/page.tsx` | 신규 |
| `src/components/listing/auto-register/` (7개 파일) | 신규 |
| `src/app/api/auto-register/parse-url/route.ts` | 신규 |
| `src/app/api/auto-register/ai-map/route.ts` | 신규 |
| `src/lib/auto-register/` (3개 파일) | 신규 |
| `src/lib/sourcing/costco-client.ts` | 단일 상품 조회 메서드 추가 |
| Supabase `auto_register_corrections` 테이블 | 신규 마이그레이션 |

**변경하지 않는 것:** 기존 Step1-3 wizard, 쿠팡/네이버 동시등록 흐름, 소싱탭 UI
