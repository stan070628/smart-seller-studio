import { getSourcingPool } from '@/lib/sourcing/db';
import { extractKeywordsFromProduct } from '@/lib/sourcing/ai-keyword-extract';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { breakEvenPrice, marginOf } from '@/lib/sourcing/coupang-price';
import { parseDeliPolicy, unitDeliveryFee } from '@/lib/sourcing/deli-policy';
import {
  createRequest,
  completeRequest,
  failRequest,
  saveKeywordResults,
  type KeywordResultInsert,
} from './keyword-db';
import { sendTelegramMessage } from '@/lib/telegram/client';
import type { DomeggookListItem } from '@/types/sourcing';
import type { LogisticsSize, Verdict } from '@/types/shortlist';

/** 목표 역산 기준 최소 판매가 */
const MIN_SELL_PRICE_KRW = 10000;
/** 쿠팡 표본이 이보다 적으면 판정하지 않는다 */
const MIN_COUPANG_SAMPLE_N = 3;
const TOP_N = 5;
const DOMEGGOOK_PAGE_SIZE = 10;
/**
 * 검증 사입 수량 가정치(개). 개당 배송비 환산의 분모다.
 *
 * 발굴 파이프라인은 아직 쇼트리스트에 없는 후보를 다루므로 실제 사입 수량을 모른다.
 * sourcing_shortlist.order_qty의 기본값이 10이라(094_sourcing_shortlist.sql:42)
 * 같은 값을 가정해 적재 전후의 개당 배송비가 어긋나지 않게 한다.
 * 적재 후 사용자가 수량을 바꾸면 재검증(shortlist-verify)이 그 값으로 다시 계산한다.
 */
const ASSUMED_ORDER_QTY = 10;

export interface CandidateInput {
  domePrice: number;
  /** 개당 환산 배송비 */
  unitDeliFee: number;
  coupangP25: number | null;
  coupangSampleN: number;
  logisticsSize: LogisticsSize;
}

export interface CandidateVerdict {
  effectiveCost: number;
  breakEvenPrice: number;
  margin: number | null;
  marginRate: number | null;
  verdict: Verdict;
  failReason: 'under_min_price' | 'below_breakeven' | null;
}

/**
 * 후보 하나를 판정한다.
 *
 * 시세 기준은 쿠팡 p25다. 네이버 최저가는 쿠팡 실판가의 2~3배로 나와
 * 마진율 판정을 뒤집는다(실측: 접이식 쓰레기통 15,160원 vs 5,490원).
 *
 * unknown을 fail로 뭉치지 않는다. 표본이 얇아 모르는 것과 마진이 안 나오는 것은 다르다.
 */
export function evaluateCandidate(input: CandidateInput): CandidateVerdict {
  const effectiveCost = input.domePrice + input.unitDeliFee;
  const be = breakEvenPrice(effectiveCost, input.logisticsSize);

  if (input.coupangP25 === null || input.coupangSampleN < MIN_COUPANG_SAMPLE_N) {
    return {
      effectiveCost,
      breakEvenPrice: be,
      margin: null,
      marginRate: null,
      verdict: 'unknown',
      failReason: null,
    };
  }

  if (input.coupangP25 < MIN_SELL_PRICE_KRW) {
    return {
      effectiveCost,
      breakEvenPrice: be,
      margin: null,
      marginRate: null,
      verdict: 'fail',
      failReason: 'under_min_price',
    };
  }

  const margin = marginOf(input.coupangP25, effectiveCost, input.logisticsSize);
  const marginRate = margin / input.coupangP25;
  const pass = input.coupangP25 >= be;

  return {
    effectiveCost,
    breakEvenPrice: be,
    margin,
    marginRate,
    verdict: pass ? 'pass' : 'fail',
    failReason: pass ? null : 'below_breakeven',
  };
}

/** 웹 실행(chatId 없음)에서는 텔레그램을 부르지 않는다 */
async function notify(chatId: string, message: string): Promise<void> {
  if (!chatId) return;
  await sendTelegramMessage(chatId, message);
}

/**
 * 시세 줄을 뺀 이유: 네이버 쇼핑 검색 API 종료로 p25를 자동으로 구할 수 없어
 * 항상 0원이 찍혔다. 받는 사람에게 "예상 판매가 0원"은 거짓말이라 안내로 바꿨다.
 * 시세는 발굴 탭에서 사용자가 직접 입력한다.
 */
function formatResultMessage(
  keyword: string,
  results: KeywordResultInsert[],
): string {
  if (results.length === 0) {
    return `❌ 분석 실패\n📦 ${keyword}\n손익분기가를 넘는 상품을 찾지 못했습니다.`;
  }

  const lines: string[] = [
    `✅ 소싱 분석 완료`,
    `📦 ${keyword}`,
    `💰 쿠팡 실판가는 발굴 탭에서 직접 확인해 주세요`,
    ``,
    `─────────────────`,
  ];

  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

  for (const r of results) {
    const medal = medals[(r.rank - 1)] ?? `${r.rank}위`;
    const dMargin = r.domeggook_margin_rate?.toFixed(1) ?? '—';
    lines.push(`${medal} ${r.rank}위 | 도매꾹 마진 ${dMargin}%`);
    if (r.domeggook_price) {
      lines.push(`  도매꾹: ${r.domeggook_price.toLocaleString()}원 → ${r.domeggook_url ?? ''}`);
    }
    if (r.china_price_krw && r.china_url) {
      const cMargin = r.china_margin_rate?.toFixed(1) ?? '—';
      lines.push(`  1688:  ${r.china_price_krw.toLocaleString()}원 → ${r.china_url} (마진 ${cMargin}%)`);
    } else {
      lines.push(`  1688:  없음`);
    }
    lines.push(``);
  }

  lines.push(`─────────────────`);
  lines.push(`전체 결과는 소싱에이전트 탭에서 확인`);

  return lines.join('\n');
}

/**
 * @param existingRequestId 이미 만들어 둔 요청 행 ID. 웹 실행은 폴링을 위해
 *   라우트가 먼저 만들어 응답에 담으므로 그 ID를 그대로 이어 쓴다.
 *   없으면(텔레그램 경로) 여기서 만든다.
 */
export async function runKeywordPipeline(
  keyword: string,
  chatId: string,
  existingRequestId?: number,
): Promise<void> {
  const pool = getSourcingPool();

  // 1. 분석 시작 메시지 전송
  await notify(chatId, `🔍 분석 시작합니다\n📦 ${keyword}\n잠시만 기다려주세요...`);

  // 2. 요청 DB 저장 (웹 실행은 라우트가 이미 만들어 둔 ID를 이어 쓴다)
  const requestId = existingRequestId ?? (await createRequest(pool, keyword, chatId));

  try {
    // 3. 키워드 추출 → Domeggook 검색
    const extracted = await extractKeywordsFromProduct(keyword);
    const searchKeywords: string[] = extracted?.length ? extracted : [keyword];

    const client = getDomeggookClient();
    const candidateMap = new Map<number, DomeggookListItem>();

    for (const kw of searchKeywords) {
      try {
        const res = await client.getItemList({ keyword: kw, pageSize: DOMEGGOOK_PAGE_SIZE, sort: 'rd' });
        for (const item of res.list) {
          if (!candidateMap.has(item.no)) candidateMap.set(item.no, item);
        }
      } catch (err) {
        console.warn('[keyword-pipeline] Domeggook 검색 실패:', kw, err instanceof Error ? err.message : err);
      }
    }

    const candidates = Array.from(candidateMap.values());

    if (candidates.length === 0) {
      await failRequest(pool, requestId, '도매꾹에서 매칭 상품을 찾지 못했습니다.');
      await notify(chatId, `❌ 분석 실패\n📦 ${keyword}\n도매꾹에서 매칭 상품을 찾지 못했습니다.`);
      return;
    }

    // 4. 각 후보 처리 — 쿠팡 시세 추정 후 판정
    const resultRows: Array<KeywordResultInsert & { _sort: number }> = [];

    for (const item of candidates) {
      const deli = parseUnitDeliFee(item);

      // 쿠팡 시세는 더 이상 자동으로 못 구한다 — 네이버 쇼핑 검색 API가
      // 2026-07-31자로 종료됐다(공지 32530, 유예·대체 없음). 부르면 후보 1건당
      // 404 나는 HTTP 요청이 최대 4번 나가고 결과는 항상 null이다.
      // 시세는 발굴 탭에서 사용자가 직접 입력한다.
      const v = evaluateCandidate({
        domePrice: item.price,
        unitDeliFee: deli,
        coupangP25: null,
        coupangSampleN: 0,
        logisticsSize: 'xsmall',
      });

      // unknown은 남긴다 — 표본이 얇아 판정 못 한 것을 탈락으로 버리면 후보를 잃는다.
      if (v.verdict === 'fail') continue;

      resultRows.push({
        rank: 0,
        // 주의: 컬럼명은 naver_price지만 이제 담기는 값은 **쿠팡 p25**다.
        // 시세 기준을 네이버 최저가에서 쿠팡 p25로 바꾸면서 컬럼은 재사용했다
        // (마이그레이션 없이 교체). 컬럼명과 내용이 어긋난 상태이니 이 값을
        // "네이버 가격"으로 읽지 말 것.
        naver_price: null,
        naver_url: null,
        domeggook_product_name: item.title,
        domeggook_price: item.price,
        domeggook_url: item.url,
        domeggook_image_url: item.thumb || null,
        domeggook_margin_rate: v.marginRate !== null ? v.marginRate * 100 : null,
        china_product_name: null,
        china_price_krw: null,
        china_url: null,
        china_margin_rate: null,
        // 시세를 모르니 고단가 우선의 대용으로 도매가를 쓴다.
        // p25가 항상 null이라 그대로 두면 정렬이 no-op가 되어 순서가 임의가 된다.
        _sort: item.price,
      });

      // 자동 적재는 하지 않는다. 네이버 쇼핑 검색 API 종료(2026-07-31)로
      // coupangP25가 영원히 null이라 pass 판정이 나올 수 없기 때문이다.
      // 사용자가 발굴 탭에서 쿠팡 실판가를 확인하고 직접 담는다.
      // 자동 시세가 복구되면 이 자리에 되살린다.
    }

    // 5. 예상 판매가 내림차순 상위 5개 — 고단가 우선
    const top = resultRows
      .sort((a, b) => b._sort - a._sort)
      .slice(0, TOP_N)
      .map(({ _sort: _, ...row }, idx) => ({ ...row, rank: idx + 1 }));

    // 6. DB 저장
    await saveKeywordResults(pool, requestId, top);
    await completeRequest(pool, requestId);

    // 7. 결과 전송
    const message = formatResultMessage(keyword, top);
    await notify(chatId, message);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[keyword-pipeline] 파이프라인 오류:', msg);
    await failRequest(pool, requestId, msg).catch(() => {});
    await notify(chatId, `❌ 분석 실패\n📦 ${keyword}\n${msg}`).catch(() => {});
  }
}

/**
 * 도매꾹 목록 항목에서 개당 배송비를 뽑는다. 알 수 없으면 0.
 *
 * 계산은 shortlist-verify와 동일하게 deli-policy에 위임한다. 직접 구현했던
 * `fee / 10` 근사는 두 가지를 놓쳤다.
 *   - 무료배송(`pay === '무료'` 또는 `who === 'S'`)에도 배송비를 얹어 손익분기를 올렸다.
 *   - "30개당 3,000원" 같은 구간 배송비를 고정 배송비로 취급했다.
 *
 * `item.deli`를 그대로 넘겨도 되는 이유: parseDeliPolicy가 `dome?.fee ?? raw.fee`와
 * `dome?.tbl ?? raw.tbl`을 모두 보므로, getItemView(상세)의 `deli.dome.fee` 형태와
 * getItemList(목록)의 `deli.fee` 형태를 한 함수가 함께 처리한다.
 *
 * 테스트를 위해 export한다. 순수 함수이고, 같은 모듈의 evaluateCandidate와 동일한
 * 관례다. 유일한 호출부인 runKeywordPipeline은 DB·텔레그램·도매꾹·쿠팡을 모두 물어
 * 그 경유로 배송비 환산만 검증하기 어렵다.
 */
export function parseUnitDeliFee(item: DomeggookListItem): number {
  return unitDeliveryFee(parseDeliPolicy(item.deli), ASSUMED_ORDER_QTY);
}
