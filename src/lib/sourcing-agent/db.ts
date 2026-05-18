import pg from 'pg';

export interface AgentCategory {
  id: number;
  name: string;
  coupang_category_url: string;
  last_crawled_at: string | null;
  is_active: boolean;
}

export interface AgentResultInsert {
  category_id: number;
  coupang_product_id: string;
  coupang_product_name: string;
  coupang_rank: number;
  coupang_price: number;
  coupang_image_url: string;
  coupang_url: string;
  domeggook_product_name: string | null;
  domeggook_price: number | null;
  domeggook_url: string | null;
  domeggook_image_url: string | null;
  domeggook_similarity: number | null;
  china_product_name: string | null;
  china_price_krw: number | null;
  china_url: string | null;
  china_image_url: string | null;
  domeggook_margin_rate: number | null;
  china_margin_rate: number | null;
}

export interface AgentResult extends AgentResultInsert {
  id: number;
  crawled_at: string;
  category_name: string;
}

/** last_crawled_at 가장 오래된(또는 null) 활성 카테고리 1개 반환 */
export async function getNextCategory(pool: pg.Pool): Promise<AgentCategory | null> {
  const { rows } = await pool.query<AgentCategory>(
    `SELECT * FROM sourcing_agent_categories
     WHERE is_active = true
     ORDER BY last_crawled_at ASC NULLS FIRST
     LIMIT 1`
  );
  return rows[0] ?? null;
}

/** ID로 특정 카테고리 조회 */
export async function getCategoryById(pool: pg.Pool, id: number): Promise<AgentCategory | null> {
  const { rows } = await pool.query<AgentCategory>(
    'SELECT * FROM sourcing_agent_categories WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

/** 모든 활성 카테고리 목록 */
export async function getAllCategories(pool: pg.Pool): Promise<AgentCategory[]> {
  const { rows } = await pool.query<AgentCategory>(
    'SELECT * FROM sourcing_agent_categories WHERE is_active = true ORDER BY name'
  );
  return rows;
}

/** 동일 쿠팡 상품 ID가 최근 30일 내에 저장됐는지 확인 */
export async function isDuplicateProduct(pool: pg.Pool, coupangProductId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM sourcing_agent_results
     WHERE coupang_product_id = $1
       AND crawled_at > NOW() - INTERVAL '30 days'
     LIMIT 1`,
    [coupangProductId]
  );
  return rows.length > 0;
}

/** 결과 일괄 저장 */
export async function saveAgentResults(pool: pg.Pool, results: AgentResultInsert[]): Promise<void> {
  if (results.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of results) {
      await client.query(
        `INSERT INTO sourcing_agent_results (
           category_id, coupang_product_id, coupang_product_name,
           coupang_rank, coupang_price, coupang_image_url, coupang_url,
           domeggook_product_name, domeggook_price, domeggook_url,
           domeggook_image_url, domeggook_similarity,
           china_product_name, china_price_krw, china_url, china_image_url,
           domeggook_margin_rate, china_margin_rate
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
         )`,
        [
          r.category_id, r.coupang_product_id, r.coupang_product_name,
          r.coupang_rank, r.coupang_price, r.coupang_image_url, r.coupang_url,
          r.domeggook_product_name, r.domeggook_price, r.domeggook_url,
          r.domeggook_image_url, r.domeggook_similarity,
          r.china_product_name, r.china_price_krw, r.china_url, r.china_image_url,
          r.domeggook_margin_rate, r.china_margin_rate,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** 카테고리 last_crawled_at 업데이트 */
export async function updateCategoryLastCrawled(pool: pg.Pool, categoryId: number): Promise<void> {
  await pool.query(
    'UPDATE sourcing_agent_categories SET last_crawled_at = NOW() WHERE id = $1',
    [categoryId]
  );
}

/** 결과 목록 조회 (페이지네이션, 카테고리 필터) */
export async function getAgentResults(
  pool: pg.Pool,
  opts: { limit?: number; offset?: number; categoryId?: number } = {}
): Promise<AgentResult[]> {
  const { limit = 50, offset = 0, categoryId } = opts;
  const params: unknown[] = [limit, offset];
  const conditions: string[] = [];
  if (categoryId) {
    params.push(categoryId);
    conditions.push(`r.category_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query<AgentResult>(
    `SELECT r.*, c.name AS category_name
     FROM sourcing_agent_results r
     JOIN sourcing_agent_categories c ON c.id = r.category_id
     WHERE 1=1 ${where}
     ORDER BY r.crawled_at DESC, r.domeggook_margin_rate DESC NULLS LAST
     LIMIT $1 OFFSET $2`,
    params
  );
  return rows;
}
