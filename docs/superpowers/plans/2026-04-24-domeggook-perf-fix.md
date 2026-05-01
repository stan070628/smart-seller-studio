# 도매꾹 탭 응답 속도 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도매꾹 탭 최초 조회와 키워드 검색 시 응답 속도를 개선한다.

**Architecture:** 세 가지 병렬 개선을 적용한다. (1) `sales_analysis_view`를 MATERIALIZED VIEW로 전환해 매 요청마다 CTE 풀스캔 3회를 제거한다. (2) `/api/sourcing/analyze` 라우트에서 COUNT·categories·lastLog 쿼리를 `Promise.all`로 병렬화한다. (3) categories 결과를 서버 메모리에 5분 캐시해 반복 쿼리를 제거한다.

**Tech Stack:** PostgreSQL MATERIALIZED VIEW, Next.js API Route, Node.js module-level cache

---

## File Map

| 파일 | 상태 | 역할 |
|---|---|---|
| `supabase/migrations/035_materialized_sales_view.sql` | 신규 | sales_analysis_view → MATERIALIZED VIEW 전환 |
| `src/app/api/sourcing/analyze/route.ts` | 수정 | 쿼리 병렬화 + categories 캐시 |

---

## Task 1: MATERIALIZED VIEW 마이그레이션

**Files:**
- Create: `supabase/migrations/035_materialized_sales_view.sql`

현재 `sales_analysis_view`는 plain VIEW로 매 요청마다 `inventory_snapshots` 테이블을 CTE 3개로 풀스캔한다. MATERIALIZED VIEW로 전환하면 결과가 디스크에 저장되어 SELECT가 인덱스 스캔으로 대체된다.

refresh 트리거: `triggerCollection` 완료 후 `POST /api/sourcing/snapshot`이 호출되는 시점에 `REFRESH MATERIALIZED VIEW CONCURRENTLY`를 실행한다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/035_materialized_sales_view.sql` 생성:

```sql
-- 035: sales_analysis_view → MATERIALIZED VIEW 전환
-- 이유: 매 요청마다 inventory_snapshots CTE 풀스캔 3회 → 결과 캐시로 교체
-- refresh: POST /api/sourcing/snapshot 완료 시점에 CONCURRENTLY 갱신

BEGIN;

-- 1. 기존 plain VIEW 제거
DROP VIEW IF EXISTS public.sales_analysis_view;

-- 2. MATERIALIZED VIEW 생성 (동일 SQL)
CREATE MATERIALIZED VIEW public.sales_analysis_view AS
WITH latest AS (
  SELECT DISTINCT ON (item_no)
    item_id,
    item_no,
    snapshot_date        AS latest_date,
    inventory            AS latest_inventory,
    price_dome           AS latest_price_dome,
    price_supply         AS latest_price_supply
  FROM public.inventory_snapshots
  ORDER BY item_no, snapshot_date DESC
),
prev_1d AS (
  SELECT DISTINCT ON (s.item_no)
    s.item_no,
    s.snapshot_date      AS prev_1d_date,
    s.inventory          AS prev_inventory_1d
  FROM public.inventory_snapshots s
  INNER JOIN latest l ON l.item_no = s.item_no
  WHERE s.snapshot_date < l.latest_date
  ORDER BY s.item_no, s.snapshot_date DESC
),
prev_7d AS (
  SELECT DISTINCT ON (s.item_no)
    s.item_no,
    s.snapshot_date      AS prev_7d_date,
    s.inventory          AS prev_inventory_7d
  FROM public.inventory_snapshots s
  INNER JOIN latest l ON l.item_no = s.item_no
  WHERE s.snapshot_date <= l.latest_date - INTERVAL '7 days'
  ORDER BY s.item_no, s.snapshot_date DESC
)
SELECT
  si.id,
  si.item_no,
  si.title,
  si.status,
  si.category_name,
  si.seller_nick,
  si.image_url,
  si.dome_url,
  si.is_tracking,
  l.latest_date,
  l.latest_inventory,
  l.latest_price_dome,
  l.latest_price_supply,
  p1.prev_inventory_1d,
  p1.prev_1d_date,
  GREATEST(0, COALESCE(p1.prev_inventory_1d, 0) - l.latest_inventory)  AS sales_1d,
  p7.prev_inventory_7d,
  p7.prev_7d_date,
  GREATEST(0, COALESCE(p7.prev_inventory_7d, 0) - l.latest_inventory)  AS sales_7d,
  ROUND(
    GREATEST(0, COALESCE(p7.prev_inventory_7d, 0) - l.latest_inventory)::numeric
    / GREATEST(1, (l.latest_date - COALESCE(p7.prev_7d_date, l.latest_date - 7))::integer),
    2
  )                                                                      AS avg_daily_sales
FROM public.sourcing_items si
JOIN latest l ON l.item_id = si.id
LEFT JOIN prev_1d p1 ON p1.item_no = si.item_no
LEFT JOIN prev_7d p7 ON p7.item_no = si.item_no;

-- 3. CONCURRENTLY refresh를 위한 UNIQUE INDEX (item_id 기준)
CREATE UNIQUE INDEX idx_sales_analysis_view_id ON public.sales_analysis_view (id);

-- 4. 검색 성능을 위한 추가 인덱스
CREATE INDEX idx_sales_analysis_view_title   ON public.sales_analysis_view USING gin (title gin_trgm_ops);
CREATE INDEX idx_sales_analysis_view_sales7d ON public.sales_analysis_view (sales_7d DESC);
CREATE INDEX idx_sales_analysis_view_cat     ON public.sales_analysis_view (category_name);

COMMIT;
```

- [ ] **Step 2: snapshot API 라우트에 REFRESH 추가**

`src/app/api/sourcing/snapshot/route.ts`를 읽고, POST 핸들러에서 스냅샷 INSERT 완료 후 다음 코드를 추가한다:

```typescript
// MATERIALIZED VIEW 비동기 갱신 (CONCURRENTLY — 읽기 차단 없음)
pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY public.sales_analysis_view')
  .catch((e) => console.error('[snapshot] matview refresh 실패:', e));
```

이 코드는 `pool.query()`를 `await` 하지 않고 fire-and-forget으로 실행한다. 응답을 차단하지 않는다.

- [ ] **Step 3: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "snapshot" | head -5
```

Expected: 출력 없음

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/035_materialized_sales_view.sql src/app/api/sourcing/snapshot/route.ts
git commit -m "perf: sales_analysis_view MATERIALIZED VIEW 전환 + snapshot 후 자동 refresh"
```

---

## Task 2: analyze 라우트 쿼리 병렬화 + categories 캐시

**Files:**
- Modify: `src/app/api/sourcing/analyze/route.ts`

현재 GET 핸들러는 COUNT → data → lastLog → categories → priceTiers 순으로 직렬 실행한다. COUNT + data는 순서 의존이 있지만, lastLog와 categories는 독립적으로 병렬 실행 가능하다. 또한 categories는 거의 변하지 않으므로 5분 메모리 캐시로 반복 조회를 제거한다.

- [ ] **Step 1: 파일 현황 파악**

```bash
grep -n "pool.query\|await pool\|countResult\|dataResult\|lastLogResult\|catResult\|tiersResult" src/app/api/sourcing/analyze/route.ts | head -20
```

- [ ] **Step 2: 모듈 레벨 categories 캐시 추가**

`src/app/api/sourcing/analyze/route.ts` 파일에서 `const ALLOWED_SORT_COLUMNS` 선언 바로 위에 추가:

```typescript
// categories 결과는 거의 변하지 않으므로 5분 메모리 캐시
interface CategoriesCache {
  value: string[];
  expiresAt: number;
}
let categoriesCache: CategoriesCache | null = null;

async function getCachedCategories(pool: ReturnType<typeof getSourcingPool>): Promise<string[]> {
  const now = Date.now();
  if (categoriesCache && categoriesCache.expiresAt > now) {
    return categoriesCache.value;
  }
  const catResult = await pool.query<{ category_name: string }>(
    `SELECT DISTINCT category_name FROM sourcing_items
     WHERE category_name IS NOT NULL
     ORDER BY category_name`,
  );
  const categories = [...new Set(
    catResult.rows.map((r) => toParentCategory(r.category_name)),
  )].sort();
  categoriesCache = { value: categories, expiresAt: now + 5 * 60 * 1000 };
  return categories;
}
```

주의: `getSourcingPool`과 `toParentCategory`는 이미 파일 상단에 import되어 있으므로 추가 import 불필요.

- [ ] **Step 3: GET 핸들러 내 직렬 쿼리를 병렬화**

현재 GET 핸들러에서 다음 패턴을 찾는다:

```typescript
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM sales_analysis_view v
       JOIN sourcing_items si ON si.id = v.id
       ${finalWhereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    // 데이터 조회 — ...
    const limitParam = paramIdx++;
    const offsetParam = paramIdx++;
    const dataResult = await pool.query<Record<string, unknown>>(
```

그리고 그 아래에 순서대로 있는:
```typescript
    const lastLogResult = await pool.query<{ started_at: string }>(...)
    const catResult = await pool.query<{ category_name: string }>(...)
```

이를 다음과 같이 교체한다:

```typescript
    // COUNT + data + lastLog + categories 병렬 실행
    const limitParam = paramIdx++;
    const offsetParam = paramIdx++;

    const [countResult, dataResult, lastLogResult, categories] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT COUNT(*) AS total
         FROM sales_analysis_view v
         JOIN sourcing_items si ON si.id = v.id
         ${finalWhereClause}`,
        params,
      ),
      pool.query<Record<string, unknown>>(
        `SELECT
           v.*,
           si.moq,
           si.unit_qty,
           si.deli_who,
           si.deli_fee,
           si.price_resale_recommend,
           si.legal_status,
           si.legal_issues,
           si.legal_checked_at,
           si.ip_risk_level,
           si.ip_checked_at,
           si.market_lowest_price,
           si.market_price_source,
           si.market_price_updated_at,
           si.score_total,
           si.score_legal_ip,
           si.score_price_comp,
           si.score_cs_safety,
           si.score_margin,
           si.score_demand,
           si.score_supply,
           si.score_moq_fit,
           si.score_calculated_at,
           si.cs_risk_level,
           si.cs_risk_reason,
           si.dropship_moq_strategy,
           si.dropship_bundle_price,
           si.dropship_price_gap_rate,
           CASE
             WHEN si.price_resale_recommend > 0
               THEN ROUND(
                 (si.price_resale_recommend
                   - COALESCE(si.price_dome, v.latest_price_dome, 0)
                   - CASE WHEN si.deli_who != 'P'
                       THEN COALESCE(si.deli_fee, 0)::numeric / GREATEST(COALESCE(si.moq, 1), 1)
                       ELSE 0
                     END
                 )::numeric
                 / si.price_resale_recommend * 100,
                 1
               )
             ELSE NULL
           END AS margin_rate
         FROM sales_analysis_view v
         JOIN sourcing_items si ON si.id = v.id
         ${finalWhereClause}
         ORDER BY ${sortColumn} ${orderDir} NULLS LAST
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        [...params, limit, offset],
      ),
      pool.query<{ started_at: string }>(
        `SELECT started_at FROM collection_logs
         WHERE status = 'success'
         ORDER BY started_at DESC
         LIMIT 1`,
      ),
      getCachedCategories(pool),
    ]);

    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);
    const lastCollectedAt = lastLogResult.rows[0]?.started_at ?? null;
```

- [ ] **Step 4: 기존 개별 쿼리 코드 및 중복 변수 제거**

교체 후 아래 코드들이 중복으로 남아있으면 삭제한다:
- 기존 `const countResult = await pool.query(...)` (이미 Promise.all로 이동)
- 기존 `const total = parseInt(...)` (이미 위로 이동)
- 기존 `const dataResult = await pool.query(...)` (이미 Promise.all로 이동)
- 기존 `const lastLogResult = await pool.query(...)` (이미 Promise.all로 이동)
- 기존 `const catResult = await pool.query(...)` (getCachedCategories로 교체됨)
- 기존 categories 계산 블록 (`const categories = [...new Set(...)]`)
- 기존 `const lastCollectedAt = lastLogResult.rows[0]?.started_at ?? null;` (위로 이동)

- [ ] **Step 5: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "analyze" | head -5
```

Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/sourcing/analyze/route.ts
git commit -m "perf: analyze 쿼리 Promise.all 병렬화 + categories 5분 메모리 캐시"
```
