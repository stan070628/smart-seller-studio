import { getSourcingPool } from '@/lib/sourcing/db';
import { extractKeywordsFromProduct } from '@/lib/sourcing/ai-keyword-extract';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { estimateCoupangPrice, breakEvenPrice, marginOf } from '@/lib/sourcing/coupang-price';
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

function formatResultMessage(
  keyword: string,
  estimatedPrice: number,
  results: KeywordResultInsert[],
): string {
  if (results.length === 0) {
    return `❌ 분석 실패\n📦 ${keyword}\n손익분기가를 넘는 상품을 찾지 못했습니다.`;
  }

  const lines: string[] = [
    `✅ 소싱 분석 완료`,
    `📦 ${keyword}`,
    `💰 쿠팡 예상 판매가(p25): ${estimatedPrice.toLocaleString()}원`,
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

export async function runKeywordPipeline(keyword: string, chatId: string): Promise<void> {
  const pool = getSourcingPool();

  // 1. 분석 시작 메시지 전송
  await sendTelegramMessage(chatId, `🔍 분석 시작합니다\n📦 ${keyword}\n잠시만 기다려주세요...`);

  // 2. 요청 DB 저장
  const requestId = await createRequest(pool, keyword, chatId);

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
      await sendTelegramMessage(chatId, `❌ 분석 실패\n📦 ${keyword}\n도매꾹에서 매칭 상품을 찾지 못했습니다.`);
      return;
    }

    // 4. 각 후보 처리 — 쿠팡 시세 추정 후 판정
    const resultRows: Array<KeywordResultInsert & { _sort: number }> = [];

    for (const item of candidates) {
      const est = await estimateCoupangPrice(item.title);
      const deli = parseUnitDeliFee(item);

      // estimateCoupangPrice는 표본이 MIN_SAMPLE(3) 미만이면 **null을 반환한다**.
      // evaluateCandidate가 p25=null을 이미 unknown으로 처리하도록 설계돼 있으므로
      // 여기서 분기하지 말고 그대로 흘려보낸다. est.p25로 직접 접근하면 터진다.
      const v = evaluateCandidate({
        domePrice: item.price,
        unitDeliFee: deli,
        coupangP25: est?.p25 ?? null,
        coupangSampleN: est?.sampleN ?? 0,
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
        naver_price: est?.p25 ?? null,
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
        _sort: est?.p25 ?? 0,
      });

      // pass 판정의 쇼트리스트 적재는 Task 8에서 붙인다.
      // 여기서 미리 호출하면 아직 없는 함수를 참조해 컴파일이 깨진다.
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
    const message = formatResultMessage(keyword, top[0]?.naver_price ?? 0, top);
    await sendTelegramMessage(chatId, message);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[keyword-pipeline] 파이프라인 오류:', msg);
    await failRequest(pool, requestId, msg).catch(() => {});
    await sendTelegramMessage(chatId, `❌ 분석 실패\n📦 ${keyword}\n${msg}`).catch(() => {});
  }
}

/**
 * 도매꾹 목록 항목에서 개당 배송비를 뽑는다. 알 수 없으면 0.
 *
 * `deli.dome.fee`는 getItemView(상세) 응답 형태고, getItemList(목록) 응답은
 * `deli.fee`로 내려온다. 저장소 관례(deli-policy.ts:54)대로 둘 다 본다.
 */
function parseUnitDeliFee(item: DomeggookListItem): number {
  const deli = item.deli as { dome?: { fee?: string | number }; fee?: string | number } | undefined;
  const raw = deli?.dome?.fee ?? deli?.fee;
  const fee = raw != null ? Number(raw) : 0;
  if (!Number.isFinite(fee) || fee <= 0) return 0;
  return Math.round(fee / 10); // 10개 사입 기준 개당 환산
}
