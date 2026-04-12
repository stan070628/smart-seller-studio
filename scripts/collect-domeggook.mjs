#!/usr/bin/env node
/**
 * scripts/collect-domeggook.mjs
 *
 * 도매꾹 상품 수집 스탠드얼론 스크립트
 * GitHub Actions에서 직접 실행 — Vercel Function 300초 타임아웃 없음
 *
 * 실행: node scripts/collect-domeggook.mjs
 * 환경변수:
 *   SOURCING_DATABASE_URL  — Render PostgreSQL 연결 문자열 (필수)
 *   DOMEGGOOK_API_KEY      — 도매꾹 API 인증키 (필수)
 *   DOMEGGOOK_API_BASE_URL — 도매꾹 API 베이스 URL (기본: https://domeggook.com/ssl/api/)
 *   DOMEGGOOK_PROXY_URL    — 한국 IP 우회 프록시 URL (선택)
 *   DOMEGGOOK_PROXY_SECRET — 프록시 인증 시크릿 (선택)
 */

import pg from 'pg';

// ─────────────────────────────────────────────────────────────
// 환경변수
// ─────────────────────────────────────────────────────────────

const DB_URL       = process.env.SOURCING_DATABASE_URL;
const API_KEY      = process.env.DOMEGGOOK_API_KEY;
const API_BASE_URL = (process.env.DOMEGGOOK_API_BASE_URL || 'https://domeggook.com/ssl/api/').trim();
const PROXY_URL    = (process.env.DOMEGGOOK_PROXY_URL    || '').trim();
const PROXY_SECRET = (process.env.DOMEGGOOK_PROXY_SECRET || '').trim();

if (!DB_URL)  { console.error('[ERROR] SOURCING_DATABASE_URL 환경변수가 없습니다.'); process.exit(1); }
if (!API_KEY) { console.error('[ERROR] DOMEGGOOK_API_KEY 환경변수가 없습니다.');  process.exit(1); }

// ─────────────────────────────────────────────────────────────
// DB 풀
// ─────────────────────────────────────────────────────────────

const dbUrl = new URL(DB_URL);
const pool = new pg.Pool({
  host:     dbUrl.hostname,
  port:     parseInt(dbUrl.port || '5432', 10),
  database: dbUrl.pathname.slice(1),
  user:     dbUrl.username,
  password: decodeURIComponent(dbUrl.password),
  ssl:      { rejectUnauthorized: false },
  family:   4,
  max:      5,
  idleTimeoutMillis:    30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => console.error('[DB] 풀 오류:', err));

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** KST 기준 오늘 날짜 (YYYY-MM-DD) */
function kstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

// ─────────────────────────────────────────────────────────────
// 도매꾹 API fetch (프록시 경유 지원)
// ─────────────────────────────────────────────────────────────

async function domeFetch(url) {
  if (PROXY_URL && PROXY_SECRET) {
    return fetch(`${PROXY_URL}/proxy`, {
      method:  'GET',
      headers: { 'x-proxy-secret': PROXY_SECRET, 'x-target-url': url },
    });
  }
  return fetch(url);
}

/**
 * getItemList 단일 페이지 호출
 * @returns {{ header, list: item[] }}
 */
async function getItemList(keyword, page = 1) {
  const params = new URLSearchParams({
    ver: '4.1', mode: 'getItemList',
    aid: API_KEY, market: 'dome', om: 'json',
    sz: '200', pg: String(page), so: 'rd',
    kw: keyword,
  });
  const url = `${API_BASE_URL}?${params}`;
  const res = await domeFetch(url);
  if (!res.ok) throw new Error(`[도매꾹] getItemList API 오류: ${res.status} ${res.statusText}`);

  const text = await res.text();
  let raw;
  try { raw = JSON.parse(text); }
  catch (e) { throw new Error(`[도매꾹] JSON 파싱 실패 (길이 ${text.length}): ${e.message}`); }

  const errors = raw.errors ?? raw.domeggook?.errors;
  if (errors) throw new Error(`[도매꾹] 응답 오류: ${JSON.stringify(errors)}`);

  const root   = raw.domeggook ?? raw;
  const header = root.header;
  if (!header) throw new Error(`[도매꾹] header 누락`);

  const items = Array.isArray(root.list?.item)
    ? root.list.item
    : root.list?.item
      ? [root.list.item]
      : Array.isArray(root.list) ? root.list : [];

  return { header, items };
}

/**
 * 키워드 전체 페이지 순회 수집
 * 429 발생 시 60초 대기 후 1회 재시도
 */
async function collectKeyword(keyword) {
  const collected = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    try {
      const { header, items } = await getItemList(keyword, page);
      totalPages = header.numberOfPages ?? 1;

      collected.push(...items);

      if (page === 1) {
        log(`  키워드 "${keyword}" — 총 ${header.numberOfItems}건, ${totalPages}페이지`);
      }

      page++;
      if (page <= totalPages) await sleep(300); // 페이지 간 딜레이
    } catch (err) {
      const msg = err.message ?? String(err);
      if (msg.includes('429')) {
        log(`  [경고] 429 Too Many Requests — 60초 대기 후 재시도 (키워드: "${keyword}", 페이지 ${page})`);
        await sleep(60_000);
        // 재시도 (루프 다시 실행, page 증가 없음)
        try {
          const { header, items } = await getItemList(keyword, page);
          totalPages = header.numberOfPages ?? 1;
          collected.push(...items);
          page++;
          if (page <= totalPages) await sleep(300);
        } catch (retryErr) {
          log(`  [오류] 재시도 실패 — 키워드 "${keyword}" 페이지 ${page} 건너뜀: ${retryErr.message}`);
          break; // 재시도도 실패하면 해당 키워드 중단
        }
      } else {
        log(`  [오류] 키워드 "${keyword}" 페이지 ${page} 실패: ${msg}`);
        break;
      }
    }
  }

  return collected;
}

// ─────────────────────────────────────────────────────────────
// 인라인 법적 체크 (Layer 1 KC + Layer 2 금지어)
// ─────────────────────────────────────────────────────────────

const KC_REQUIRED = [
  '유아용','아기용','어린이용','키즈','유아','아동','장난감','젖병','젖꼭지',
  '보행기','카시트','유모차','아기띠','충전기','어댑터','USB충전','전원코드',
  '멀티탭','콘센트','전기장판','전기히터','가습기','제습기','선풍기','전기포트',
  '전기밥솥','전자레인지','헤어드라이기','드라이어','다리미','헬멧','안전모',
  '무릎보호대','보호장비','식품용기','밀폐용기','텀블러','물병','수저','도마',
];
const KC_WARN = ['LED','램프','조명','전구','보조배터리','이어폰','헤드폰','마우스','키보드','스피커','리모컨'];
const ILLEGAL_KW = ['처방전','전문의약품','마약','대마','전자충격기','스턴건','도검','석궁','실탄','정품아님','레플리카','이미테이션','짝퉁','미승인건강기능식품','주민등록','신분증위조','해킹','염산','황산','질산','시안화'];
const EXAG_PATTERNS = [/100%\s*(?:완치|치료|예방)/i,/암\s*(?:치료|예방|완치)/i,/(?:다이어트|살)\s*(?:100%|확실|보장)/i,/FDA\s*승인/i,/(?:세계\s*최초|국내\s*유일|업계\s*1위)/,/(?:기적|만능|만병통치|특효)/,/주름\s*(?:제거|완치|100%)/,/(?:미백|화이트닝)\s*(?:100%|완벽|확실)/,/(?:평생|영구)\s*(?:보증|보장|무료)/,/(?:절대|100%)\s*(?:안전|무해|무독)/];
const BRAND_PATTERNS = [/(?:다이슨|dyson)\s*(?:정품|순정)/i,/(?:애플|apple)\s*(?:정품|순정)/i,/(?:삼성|samsung)\s*(?:정품|순정)/i,/(?:LG)\s*(?:정품|순정)/i,/(?:나이키|nike)\s*(?:정품|순정)/i,/(?:아디다스|adidas)\s*(?:정품|순정)/i,/(?:구찌|gucci|샤넬|chanel|루이비통|louis\s*vuitton)/i];

function runSyncLegalCheck(title) {
  const t = title.toLowerCase();
  const issues = [];

  // KC Layer 1
  const kcReq = KC_REQUIRED.find((k) => t.includes(k.toLowerCase()));
  if (kcReq) issues.push({ layer:'kc', severity:'RED', code:'KC_REQUIRED_NO_CERT', message:`KC 인증 필수: ${kcReq}`, detail:{keyword:kcReq} });
  else {
    const kcWrn = KC_WARN.find((k) => t.includes(k.toLowerCase()));
    if (kcWrn) issues.push({ layer:'kc', severity:'YELLOW', code:'KC_RECOMMENDED', message:`KC 인증 권장: ${kcWrn}`, detail:{keyword:kcWrn} });
  }

  // 금지어 Layer 2
  const illKw = ILLEGAL_KW.find((k) => t.includes(k.toLowerCase()));
  if (illKw) issues.push({ layer:'banned', severity:'RED', code:'ILLEGAL_ITEM', message:`판매 금지 품목: ${illKw}`, detail:{matched:illKw} });

  const exag = EXAG_PATTERNS.find((p) => p.test(title));
  if (exag) {
    const m = title.match(exag)?.[0] ?? '';
    issues.push({ layer:'banned', severity:'YELLOW', code:'EXAGGERATION', message:`과장광고 의심: ${m}`, detail:{matched:m} });
  }

  const brand = BRAND_PATTERNS.find((p) => p.test(title));
  if (brand) {
    const m = title.match(brand)?.[0] ?? '';
    issues.push({ layer:'banned', severity:'YELLOW', code:'BRAND_ABUSE', message:`타브랜드 무단 사용 의심: ${m}`, detail:{matched:m} });
  }

  const status = issues.some((i) => i.severity === 'RED')
    ? 'blocked'
    : issues.some((i) => i.severity === 'YELLOW')
      ? 'warning'
      : 'safe';

  return { status, issues };
}

// ─────────────────────────────────────────────────────────────
// DB 저장 (배치 UPSERT)
// ─────────────────────────────────────────────────────────────

/**
 * allItems 배열을 DB에 저장하고 스냅샷까지 처리
 */
async function saveToDb(allItems, snapshotDate) {
  const THRESHOLD_MS = 5000;
  const now = new Date();
  let newItems = 0, updatedItems = 0, snapshotsSaved = 0;
  const failedItems = [];

  for (const item of allItems) {
    try {
      // sourcing_items UPSERT
      const upsertRes = await pool.query(
        `INSERT INTO sourcing_items
           (item_no, title, status, category_name, seller_id, seller_nick, image_url, dome_url, is_tracking)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (item_no) DO UPDATE SET
           title       = EXCLUDED.title,
           seller_id   = EXCLUDED.seller_id,
           seller_nick = EXCLUDED.seller_nick,
           image_url   = EXCLUDED.image_url,
           dome_url    = EXCLUDED.dome_url,
           is_tracking = EXCLUDED.is_tracking,
           updated_at  = now()
         RETURNING id, created_at`,
        [
          item.no, item.title, null, null,
          item.id ?? null, item.nick ?? null,
          item.thumb ?? null, item.url ?? null,
          true,
        ],
      );

      const row = upsertRes.rows[0];
      if (!row) continue;

      const createdAt = new Date(row.created_at);
      if (now.getTime() - createdAt.getTime() < THRESHOLD_MS) newItems++;
      else updatedItems++;

      // 법적 체크
      const { status: legalStatus, issues: legalIssues } = runSyncLegalCheck(item.title);
      await pool.query(
        `UPDATE sourcing_items SET legal_status=$1, legal_issues=$2, legal_checked_at=now() WHERE id=$3`,
        [legalStatus, JSON.stringify(legalIssues), row.id],
      );

      // 재고 스냅샷
      const inventory = item.qty?.inventory;
      if (inventory !== undefined) {
        const snapRes = await pool.query(
          `INSERT INTO inventory_snapshots
             (item_id, item_no, snapshot_date, inventory, price_dome, price_supply)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (item_no, snapshot_date) DO NOTHING`,
          [row.id, item.no, snapshotDate, inventory, item.price ?? null, null],
        );
        if ((snapRes.rowCount ?? 0) > 0) snapshotsSaved++;
      }
    } catch (err) {
      failedItems.push({ itemNo: item.no, error: err.message ?? String(err) });
    }
  }

  return { newItems, updatedItems, snapshotsSaved, failedItems };
}

// ─────────────────────────────────────────────────────────────
// 메인 파이프라인
// ─────────────────────────────────────────────────────────────

const KEYWORDS = [
  '생활용품', '주방용품', '뷰티', '화장품',
  '건강', '디지털', '가전', '유아', '아동',
  '반려동물', '패션잡화', '식품',
  '스포츠', '수영', '레저', '캠핑',
];

async function main() {
  const snapshotDate = kstToday();
  log(`===== 도매꾹 수집 시작 (스냅샷 날짜: ${snapshotDate}) =====`);

  // collection_logs 시작 기록
  let logId;
  try {
    const logRes = await pool.query(
      `INSERT INTO collection_logs (status, items_fetched, snapshots_saved, trigger_type)
       VALUES ('running', 0, 0, 'cron') RETURNING id`,
    );
    logId = logRes.rows[0]?.id;
    log(`수집 로그 생성: ${logId}`);
  } catch (err) {
    console.error('[ERROR] collection_logs 생성 실패:', err.message);
    await pool.end();
    process.exit(1);
  }

  // 키워드별 수집 (중복 제거)
  const allItems = [];
  const seenNos  = new Set();
  let   keywordErrors = 0;

  for (const kw of KEYWORDS) {
    log(`\n▶ 키워드: "${kw}"`);
    try {
      const items = await collectKeyword(kw);
      let added = 0;
      for (const item of items) {
        if (!seenNos.has(item.no)) { seenNos.add(item.no); allItems.push(item); added++; }
      }
      log(`  완료 — 이번 키워드 ${items.length}건 수집, 신규 ${added}건 추가 (누적 ${allItems.length}건)`);
    } catch (err) {
      log(`  [오류] "${kw}" 수집 실패: ${err.message}`);
      keywordErrors++;
    }
    // 키워드 간 딜레이 — 429 방지
    if (KEYWORDS.indexOf(kw) < KEYWORDS.length - 1) await sleep(2000);
  }

  log(`\n===== 수집 완료 — 총 ${allItems.length}건 DB 저장 시작 =====`);

  // DB 저장
  let dbResult = { newItems: 0, updatedItems: 0, snapshotsSaved: 0, failedItems: [] };
  if (allItems.length > 0) {
    dbResult = await saveToDb(allItems, snapshotDate);
    log(`  신규: ${dbResult.newItems}, 업데이트: ${dbResult.updatedItems}, 스냅샷: ${dbResult.snapshotsSaved}, 실패: ${dbResult.failedItems.length}`);
  }

  // 상태 결정
  const finalStatus = dbResult.failedItems.length > 0 || keywordErrors > 0 ? 'partial' : 'success';

  // collection_logs 완료 업데이트
  const allErrors = [
    ...dbResult.failedItems,
    // 키워드 오류는 로그에만 남기고 errors 필드는 아이템 실패만 기록
  ];
  await pool.query(
    `UPDATE collection_logs
     SET status=$1, finished_at=now(), items_fetched=$2, snapshots_saved=$3, errors=$4
     WHERE id=$5`,
    [
      finalStatus,
      allItems.length,
      dbResult.snapshotsSaved,
      allErrors.length > 0 ? JSON.stringify(allErrors) : null,
      logId,
    ],
  );

  // 30일 이전 데이터 정리
  try {
    const cleanups = await Promise.allSettled([
      pool.query(`DELETE FROM inventory_snapshots WHERE snapshot_date < CURRENT_DATE - INTERVAL '30 days'`),
      pool.query(`DELETE FROM collection_logs WHERE started_at < NOW() - INTERVAL '30 days'`),
      pool.query(`DELETE FROM niche_score_history WHERE snapshot_date < CURRENT_DATE - INTERVAL '30 days'`),
      pool.query(`DELETE FROM niche_analyses WHERE created_at < NOW() - INTERVAL '30 days'`),
      pool.query(`DELETE FROM niche_cron_logs WHERE created_at < NOW() - INTERVAL '30 days'`),
    ]);
    const cleaned = cleanups
      .filter((r) => r.status === 'fulfilled')
      .reduce((s, r) => s + (r.value.rowCount ?? 0), 0);
    if (cleaned > 0) log(`30일 이전 데이터 ${cleaned}건 삭제`);
  } catch (err) {
    log(`[경고] 데이터 정리 실패 (무시): ${err.message}`);
  }

  log(`\n===== 완료 — status: ${finalStatus} =====`);
  log(`  총 수집: ${allItems.length}건 | 스냅샷: ${dbResult.snapshotsSaved}건 | 아이템 실패: ${dbResult.failedItems.length}건 | 키워드 오류: ${keywordErrors}건`);

  await pool.end();
  process.exit(finalStatus === 'success' || finalStatus === 'partial' ? 0 : 1);
}

main().catch(async (err) => {
  console.error('[FATAL]', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
