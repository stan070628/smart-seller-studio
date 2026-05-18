import pg from 'pg';

export interface KeywordRequest {
  id: number;
  keyword: string;
  chat_id: string | null;
  status: 'pending' | 'done' | 'error';
  error_message: string | null;
  requested_at: string;
  completed_at: string | null;
}

export interface KeywordResult {
  id: number;
  request_id: number;
  rank: number;
  naver_price: number | null;
  naver_url: string | null;
  domeggook_product_name: string | null;
  domeggook_price: number | null;
  domeggook_url: string | null;
  domeggook_image_url: string | null;
  domeggook_margin_rate: number | null;
  china_product_name: string | null;
  china_price_krw: number | null;
  china_url: string | null;
  china_margin_rate: number | null;
  created_at: string;
}

export interface KeywordResultInsert {
  rank: number;
  naver_price: number | null;
  naver_url: string | null;
  domeggook_product_name: string | null;
  domeggook_price: number | null;
  domeggook_url: string | null;
  domeggook_image_url: string | null;
  domeggook_margin_rate: number | null;
  china_product_name: string | null;
  china_price_krw: number | null;
  china_url: string | null;
  china_margin_rate: number | null;
}

/** 소싱 요청 레코드 생성 후 생성된 ID 반환 */
export async function createRequest(
  pool: pg.Pool,
  keyword: string,
  chatId: string | null,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO keyword_sourcing_requests (keyword, chat_id, status)
     VALUES ($1, $2, 'pending') RETURNING id`,
    [keyword, chatId],
  );
  return rows[0].id;
}

/** 소싱 요청을 완료 상태로 업데이트 */
export async function completeRequest(pool: pg.Pool, requestId: number): Promise<void> {
  await pool.query(
    `UPDATE keyword_sourcing_requests
     SET status = 'done', completed_at = NOW()
     WHERE id = $1`,
    [requestId],
  );
}

/** 소싱 요청을 오류 상태로 업데이트 */
export async function failRequest(
  pool: pg.Pool,
  requestId: number,
  errorMessage: string,
): Promise<void> {
  await pool.query(
    `UPDATE keyword_sourcing_requests
     SET status = 'error', error_message = $2, completed_at = NOW()
     WHERE id = $1`,
    [requestId, errorMessage],
  );
}

/** 소싱 결과 일괄 저장 (트랜잭션) */
export async function saveKeywordResults(
  pool: pg.Pool,
  requestId: number,
  results: KeywordResultInsert[],
): Promise<void> {
  if (results.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of results) {
      await client.query(
        `INSERT INTO keyword_sourcing_results (
           request_id, rank,
           naver_price, naver_url,
           domeggook_product_name, domeggook_price, domeggook_url,
           domeggook_image_url, domeggook_margin_rate,
           china_product_name, china_price_krw, china_url, china_margin_rate
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          requestId, r.rank,
          r.naver_price, r.naver_url,
          r.domeggook_product_name, r.domeggook_price, r.domeggook_url,
          r.domeggook_image_url, r.domeggook_margin_rate,
          r.china_product_name, r.china_price_krw, r.china_url, r.china_margin_rate,
        ],
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

/** 소싱 요청 목록 조회 (페이지네이션, 키워드 필터, 결과 포함) */
export async function getRequests(
  pool: pg.Pool,
  opts: { limit?: number; offset?: number; keyword?: string } = {},
): Promise<(KeywordRequest & { results: KeywordResult[] })[]> {
  const { limit = 50, offset = 0, keyword } = opts;
  const params: unknown[] = [limit, offset];
  let where = '';
  if (keyword) {
    params.push(`%${keyword}%`);
    where = `WHERE keyword ILIKE $${params.length}`;
  }

  const { rows: requests } = await pool.query<KeywordRequest>(
    `SELECT * FROM keyword_sourcing_requests
     ${where}
     ORDER BY requested_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );

  if (requests.length === 0) return [];

  const ids = requests.map((r) => r.id);
  const { rows: results } = await pool.query<KeywordResult>(
    `SELECT * FROM keyword_sourcing_results
     WHERE request_id = ANY($1)
     ORDER BY request_id, rank`,
    [ids],
  );

  const resultsByRequest = new Map<number, KeywordResult[]>();
  for (const row of results) {
    const arr = resultsByRequest.get(row.request_id) ?? [];
    arr.push(row);
    resultsByRequest.set(row.request_id, arr);
  }

  return requests.map((req) => ({
    ...req,
    results: resultsByRequest.get(req.id) ?? [],
  }));
}

/** 전체 통계 조회 (총 건수, 이번 주 건수, 평균 최고 마진율) */
export async function getStats(pool: pg.Pool): Promise<{
  total: number;
  thisWeek: number;
  avgTopMargin: number | null;
}> {
  const { rows } = await pool.query<{ total: string; this_week: string }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE requested_at > NOW() - INTERVAL '7 days') AS this_week
     FROM keyword_sourcing_requests`,
  );

  const { rows: marginRows } = await pool.query<{ avg_top_margin: string | null }>(
    `SELECT AVG(sub.top_margin) AS avg_top_margin
     FROM (
       SELECT MAX(domeggook_margin_rate) AS top_margin
       FROM keyword_sourcing_results ksr
       JOIN keyword_sourcing_requests kr ON kr.id = ksr.request_id
       WHERE kr.status = 'done'
       GROUP BY ksr.request_id
     ) sub`,
  );

  const row = rows[0];
  return {
    total: parseInt(row.total, 10),
    thisWeek: parseInt(row.this_week, 10),
    avgTopMargin: marginRows[0]?.avg_top_margin ? parseFloat(marginRows[0].avg_top_margin) : null,
  };
}
