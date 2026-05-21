import { getSourcingPool } from '@/lib/sourcing/db';
import { searchNaverLowestPrice } from '@/lib/sourcing/naver-shopping';
import { extractKeywordsFromProduct } from '@/lib/sourcing/ai-keyword-extract';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { calcMarginRate } from '@/lib/sourcing/domeggook-pricing';
import {
  createRequest,
  completeRequest,
  failRequest,
  saveKeywordResults,
  type KeywordResultInsert,
} from './keyword-db';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { matchOn1688 } from './china-matcher';
import type { DomeggookListItem } from '@/types/sourcing';

const MIN_MARGIN_RATE = 30;
const TOP_N = 5;
const DOMEGGOOK_PAGE_SIZE = 10;

function formatResultMessage(
  keyword: string,
  naverPrice: number,
  results: KeywordResultInsert[],
): string {
  if (results.length === 0) {
    return `❌ 분석 실패\n📦 ${keyword}\n마진 ${MIN_MARGIN_RATE}% 이상 상품을 찾지 못했습니다.`;
  }

  const lines: string[] = [
    `✅ 소싱 분석 완료`,
    `📦 ${keyword}`,
    `💰 네이버 판매가: ${naverPrice.toLocaleString()}원`,
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
    // 3. 네이버쇼핑 소비자가 조회
    const naverPrice = await searchNaverLowestPrice(keyword);
    if (!naverPrice) {
      await failRequest(pool, requestId, '네이버쇼핑에서 가격을 찾을 수 없습니다.');
      await sendTelegramMessage(chatId, `❌ 분석 실패\n📦 ${keyword}\n네이버쇼핑에서 가격을 찾을 수 없습니다.`);
      return;
    }

    // 4. 키워드 추출 → Domeggook 검색
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

    // 5. 각 후보 처리
    const resultRows: Array<KeywordResultInsert & { _margin: number }> = [];

    for (const item of candidates) {
      const marginRate = calcMarginRate(item.price, naverPrice, null);
      if (marginRate < MIN_MARGIN_RATE) continue;

      let chinaMatch = null;
      try {
        if (item.thumb) {
          chinaMatch = await matchOn1688(item.title, item.thumb, naverPrice);
        }
      } catch (err) {
        console.warn('[keyword-pipeline] 1688 매칭 실패:', item.title, err instanceof Error ? err.message : err);
      }

      resultRows.push({
        rank: 0,
        naver_price: naverPrice,
        naver_url: null,
        domeggook_product_name: item.title,
        domeggook_price: item.price,
        domeggook_url: item.url,
        domeggook_image_url: item.thumb || null,
        domeggook_margin_rate: marginRate,
        china_product_name: chinaMatch?.productName ?? null,
        china_price_krw: chinaMatch?.priceKrw ?? null,
        china_url: chinaMatch?.url ?? null,
        china_margin_rate: chinaMatch ? chinaMatch.marginRate * 100 : null,
        _margin: marginRate,
      });
    }

    // 6. 마진 내림차순 상위 5개, rank 할당
    const top = resultRows
      .sort((a, b) => b._margin - a._margin)
      .slice(0, TOP_N)
      .map(({ _margin: _, ...row }, idx) => ({ ...row, rank: idx + 1 }));

    // 7. DB 저장
    await saveKeywordResults(pool, requestId, top);
    await completeRequest(pool, requestId);

    // 8. 결과 전송
    const message = formatResultMessage(keyword, naverPrice, top);
    await sendTelegramMessage(chatId, message);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[keyword-pipeline] 파이프라인 오류:', msg);
    await failRequest(pool, requestId, msg).catch(() => {});
    await sendTelegramMessage(chatId, `❌ 분석 실패\n📦 ${keyword}\n${msg}`).catch(() => {});
  }
}
