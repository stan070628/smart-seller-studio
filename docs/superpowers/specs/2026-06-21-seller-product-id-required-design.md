# seller_product_id 필수화 & 2단계 위자드 디자인

**날짜:** 2026-06-21  
**기능 영역:** CostManagementTab — 상품 추가 플로우 + DB 스키마  
**Opus 4.8 검토 반영:** 2026-06-21

---

## 1. 배경

`product_costs.seller_product_id`(쿠팡 등록상품ID)는 현재 nullable.  
마이그레이션 079(`product_cost_channels`)가 채널 연결을 정규화했으므로, 이제 모든 원가 단위가 쿠팡 등록상품 그룹 키를 보유하도록 필수화한다.

**요구사항:**
- `seller_product_id` NOT NULL 보장 (DB 레벨)
- 기존 NULL 데이터는 음수 가상 ID로 백필
- 상품 추가 UI를 2단계 위자드로 재설계
- 동일 `seller_product_id`를 가진 상품들을 그룹으로 표시 (기존 `buildTableItems()` 로직 유지)

---

## 2. 음수 가상 ID 규약

> **중요 규약:** `seller_product_id < 0` 은 "쿠팡 미연동 가상 ID"를 의미한다.  
> 실제 쿠팡 seller_product_id는 항상 양수이므로 충돌 없음.  
> 이 규약은 코드 전반에 주석으로 명시한다.

### 2-1. 가상 ID 특성

| 속성 | 실제 쿠팡 ID | 가상 ID |
|------|-------------|---------|
| 부호 | 양수 (`> 0`) | 음수 (`< 0`) |
| 고유성 | 쿠팡에서 부여 | PostgreSQL sequence로 보장 |
| 그룹화 | 2개↑이면 GroupRow | 항상 StandaloneRow |
| 표시 | 채널 셀에 쿠팡 배지 + ID | ID 숨김 |

### 2-2. 트레이드오프 인지

음수 ID를 `seller_product_id` 컬럼에 인코딩하면 두 개념(ID vs 쿠팡 연동 여부)이 혼재한다는 Opus 검토 지적이 있었다. 이 프로젝트는 1인 셀러 앱으로 규모가 작고, 규약을 코드 주석으로 명시하면 관리 가능하다고 판단해 음수 트릭을 채택한다. 향후 "쿠팡 없는 상품을 실제 쿠팡에 등록"하는 시나리오가 발생하면 해당 row의 `seller_product_id`를 실제 양수 ID로 갱신하는 별도 기능이 필요하다.

---

## 3. DB 변경 (Migration 080)

### 3-1. Sequence 생성 및 백필 (레이스컨디션 안전 순서)

```sql
-- 음수 sequence: 실제 쿠팡 양수 ID와 충돌 없음
CREATE SEQUENCE virtual_seller_product_id_seq
  INCREMENT BY -1
  START WITH -1
  MINVALUE -9223372036854775808
  NO CYCLE;

-- DEFAULT 먼저 설정: 백필 중 들어오는 INSERT도 자동으로 가상 ID를 받음
ALTER TABLE product_costs
  ALTER COLUMN seller_product_id
  SET DEFAULT nextval('virtual_seller_product_id_seq');

-- 기존 NULL 행 백필
UPDATE product_costs
  SET seller_product_id = nextval('virtual_seller_product_id_seq')
WHERE seller_product_id IS NULL;

-- NOT NULL 제약 (이 시점 이후 NULL 불가)
ALTER TABLE product_costs
  ALTER COLUMN seller_product_id SET NOT NULL;
```

> `DEFAULT`를 유지한 채 `SET NOT NULL`하므로 UPDATE와 ALTER 사이에 INSERT가 들어와도 NULL이 아닌 가상 ID가 들어간다. 이것이 레이스컨디션을 막는 핵심.

### 3-2. Unique Index 교체

기존: `CREATE INDEX ON product_costs (user_id, seller_product_id) WHERE seller_product_id IS NOT NULL;` (partial)  
변경: `(user_id, seller_product_id)` full unique index

```sql
-- 기존 partial index 이름 확인 후 DROP
DROP INDEX IF EXISTS product_costs_user_seller_product_id_idx;

-- Full unique index (user_id 스코프 필수 — 다른 셀러가 같은 쿠팡 상품 판매 가능)
CREATE UNIQUE INDEX product_costs_user_seller_product_id_uidx
  ON product_costs (user_id, seller_product_id);
```

> 마이그레이션 전 중복 점검 필수:
> ```sql
> SELECT user_id, seller_product_id, count(*)
> FROM product_costs
> WHERE seller_product_id IS NOT NULL
> GROUP BY 1, 2 HAVING count(*) > 1;
> ```
> 중복이 있으면 마이그레이션 중단 후 수동 처리.

### 3-3. 롤백 계획

```sql
-- Down migration (비가역적: 원래 어떤 행이 NULL이었는지 정보 소실)
ALTER TABLE product_costs ALTER COLUMN seller_product_id DROP NOT NULL;
-- 음수 ID 행을 NULL로 되돌림
UPDATE product_costs SET seller_product_id = NULL WHERE seller_product_id < 0;
DROP INDEX IF EXISTS product_costs_user_seller_product_id_uidx;
-- 원래 partial index 재생성
CREATE INDEX ON product_costs (user_id, seller_product_id) WHERE seller_product_id IS NOT NULL;
DROP SEQUENCE IF EXISTS virtual_seller_product_id_seq;
```

---

## 4. API 변경

### 4-1. POST /api/cost-management/products

현재 동작 (유지):
- `seller_product_id` optional, 제공 시 양수 정수 검증
- 생략 시 INSERT payload에서 누락 → DB DEFAULT(`nextval(...)`)가 음수 가상 ID 자동 부여

변경:
- "쿠팡 없이 등록" 경로: 클라이언트가 `seller_product_id`를 **전송하지 않음** → DB DEFAULT 처리
- 쿠팡 상품 선택 경로: 기존처럼 양수 `seller_product_id` 전송
- API 스키마상 optional 유지 (DB는 NOT NULL이지만 API는 optional — DB DEFAULT가 보장)

### 4-2. GET /api/cost-management/products

변경 없음. 단, 응답의 `seller_product_id`가 이제 항상 non-null이므로 클라이언트 null 가드 제거 가능.

---

## 5. AddProductModal 재설계 (2단계 위자드)

### 5-1. 기존 → 변경

| 항목 | 기존 (4탭) | 변경 (2단계 위자드) |
|------|-----------|-------------------|
| 구조 | coupang/rg/naver/manual 탭 | Step 1 → Step 2 선형 흐름 |
| 채널 연결 | 탭마다 내장 | ChannelEditPopover로 완전 위임 |
| seller_product_id | coupang 탭에서만 설정 | Step 1에서 항상 결정 |

### 5-2. Step 1 — 쿠팡 등록상품 선택

```
┌─────────────────────────────────────────┐
│ 상품 추가                               │
│ ─────────────────────────────────────── │
│ 쿠팡 등록상품 선택                       │
│ ┌───────────────────────────────────┐   │
│ │ 상품명 A           #16182237839  │   │
│ │ 상품명 B           #16000000001  │   │
│ │ ...                              │   │
│ └───────────────────────────────────┘   │
│                                         │
│ 또는 [쿠팡 없이 등록] 링크              │
│                                         │
│                        [다음 →] 버튼   │
└─────────────────────────────────────────┘
```

- 쿠팡 API에서 등록상품 목록 로드 (`/api/cost-management/coupang-products` 기존 엔드포인트 재사용)
- 상품 클릭 → 선택 상태, "다음" 버튼 활성화
- "쿠팡 없이 등록" 클릭 → `selectedCoupang = null` 상태로 Step 2 이동 (seller_product_id 생략)

### 5-3. Step 2 — 원가 단위 설정

```
┌─────────────────────────────────────────┐
│ 상품 추가 ← 커클랜드 세차 타월 #1618... │
│ ─────────────────────────────────────── │
│ 상품명                                  │
│ [커클랜드 극세사 타월 10장 — 그린    ] │
│                                         │
│ 수수료율 (%)                            │
│ [10.8                                ] │
│ 로켓그로스 기본 10.8% — 필요 시 수정   │
│                                         │
│ 소분 갯수 (선택)                        │
│ [       ]                              │
│                                         │
│                          [추가] 버튼    │
└─────────────────────────────────────────┘
```

- 상품명: 쿠팡 상품명 자동 채움, 수정 가능. "쿠팡 없이 등록" 경로는 빈 입력으로 시작
- 수수료율: 쿠팡 경로 기본 10.8%, 기타 빈값
- 소분 갯수: 선택 (기존과 동일)
- RG 옵션 체크박스 **없음** — 채널 연결은 등록 후 ChannelEditPopover에서 수행
- "추가" 버튼 클릭 → POST `/api/cost-management/products`
  - 쿠팡 상품 선택 경로: `{ product_name, seller_product_id, platform_fee_rate, ...}`
  - "쿠팡 없이 등록" 경로: `{ product_name, platform_fee_rate, ...}` (seller_product_id 생략)

### 5-4. 등록 완료 후

- `onAdded()` 호출 → 부모에서 상품 목록 새로고침
- 모달 닫힘 (별도 채널 추가 유도 UI 없음 — ChannelEditPopover는 테이블에서 직접 접근)

---

## 6. Grouping 로직 변경

### 6-1. `buildTableItems()` 수정

현재:
```ts
if (p.seller_product_id != null) { /* 그룹 키로 사용 */ }
else { standalone.push(p); }
```

변경:
```ts
// seller_product_id < 0 = 가상 ID (쿠팡 미연동) → standalone
if (p.seller_product_id > 0) { /* 그룹 키로 사용 */ }
else { standalone.push(p); }
```

### 6-2. `GroupableProduct` 타입

```ts
// 변경 전
seller_product_id: number | null;

// 변경 후
seller_product_id: number; // 음수=가상, 양수=쿠팡 실제 ID
```

TypeScript null 가드 잔재(`?? `, `=== null` 등) 정리는 별도 정리 패스에서 수행.

---

## 7. 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `supabase/migrations/080_seller_product_id_required.sql` | sequence 생성, DEFAULT 설정, 백필, NOT NULL, 인덱스 교체 |
| `src/lib/cost-management/product-grouping.ts` | `seller_product_id > 0` 그룹화, 타입 `number` |
| `src/__tests__/lib/product-grouping.test.ts` | 가상 ID 상품 standalone 테스트 추가 |
| `src/components/orders/AddProductModal.tsx` | 4탭 → 2단계 위자드 완전 재작성 |
| `src/app/api/cost-management/products/route.ts` | DEFAULT 경로 처리 확인 (변경 최소) |

DB 마이그레이션: **080** (적용 필요)  
신규 API 파일: **없음**

---

## 8. 제외 스코프

- `seller_product_id < 0` 상품을 실제 쿠팡에 나중에 연결하는 "ID 업데이트" 기능
- Step 2에서 RG/네이버 채널을 인라인으로 선택하는 UX (ChannelEditPopover로 위임)
- GroupRow 아코디언 접힘/펼침 (기존 동작 유지)
