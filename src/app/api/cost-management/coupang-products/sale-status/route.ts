import { NextRequest, NextResponse } from 'next/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getCurrentUser } from '@/lib/auth';

/**
 * POST /api/cost-management/coupang-products/sale-status
 * 쿠팡 상품들이 지금 실제로 팔리는 상태인지 판정한다.
 *
 * 왜 목록 API에 합치지 않았나 — 판매중지 여부는 상품 목록에도, 상품 상세에도 없다.
 * 옵션(vendorItem)별 `GET .../vendor-items/{id}/inventories`의 `onSale`만이 답을 준다.
 * 상품 29건이면 상세 29콜 + 옵션 30~60콜이 들어 목록 로딩에 넣으면 창이 20초 넘게 빈다.
 * 그래서 목록은 먼저 그리고, 이 라우트가 뒤따라 판정을 채운다.
 */

interface Verdict {
  seller_product_id: number;
  sellable: boolean;
  reason: string;
}

/** 판정 결과 캐시. 쿠팡 API 호출이 비싸 같은 상품을 반복 조회하지 않는다. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<number, { verdict: Verdict; ts: number }>();

/** 동시 호출 수 — 쿠팡은 429를 잘 뱉는다(client에 백오프가 있지만 애초에 덜 부른다). */
const CONCURRENCY = 4;
const MAX_IDS = 300;

type Client = ReturnType<typeof getCoupangClient>;

async function judge(client: Client, sellerProductId: number): Promise<Verdict> {
  const cached = cache.get(sellerProductId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.verdict;

  let verdict: Verdict;
  try {
    const detail = (await client.getProductDetail(sellerProductId)) as Record<string, unknown>;
    const items = (detail.items ?? []) as Array<Record<string, unknown>>;
    const vendorItemIds = items
      .map((it) => Number(it.vendorItemId))
      .filter((id) => Number.isFinite(id) && id > 0);

    // 로켓그로스 상품은 marketplace 옵션 경로에 vendorItemId가 잡히지 않는다.
    const isRocketGrowth =
      detail.rocketGrowthAdditionalInformation != null ||
      items.some((it) => it.rocketGrowthItemData != null);

    if (vendorItemIds.length === 0) {
      verdict = isRocketGrowth
        // 판정할 경로가 없다 — 모르는 것을 판매불가로 처리하면 멀쩡한 상품이 조용히 사라진다.
        ? { seller_product_id: sellerProductId, sellable: true, reason: '로켓그로스 — 판정 생략' }
        // 승인은 났지만 옵션이 아직 생성되지 않았다.
        : { seller_product_id: sellerProductId, sellable: false, reason: '판매 개시 전' };
    } else {
      let anyOnSale = false;
      let checked = 0;
      for (const vendorItemId of vendorItemIds) {
        try {
          const inv = await client.getVendorItemInventory(vendorItemId);
          checked += 1;
          if (inv.onSale === true) {
            anyOnSale = true;
            break; // 하나라도 팔리면 그 상품은 살아 있다 — 나머지는 물어볼 필요가 없다
          }
        } catch {
          // 옵션 하나 조회 실패는 판정을 뒤집지 않는다. 전부 실패했을 때만 아래에서 걸린다.
        }
      }
      if (anyOnSale) {
        verdict = { seller_product_id: sellerProductId, sellable: true, reason: '판매중' };
      } else if (checked === 0) {
        verdict = { seller_product_id: sellerProductId, sellable: true, reason: '판정 실패 — 확인 못 함' };
      } else {
        verdict = { seller_product_id: sellerProductId, sellable: false, reason: '판매중지' };
      }
    }
  } catch {
    // 상세 조회가 막히면 숨기지 않는다. 못 본 것을 없는 것으로 처리하면 상품이 조용히 사라진다.
    verdict = { seller_product_id: sellerProductId, sellable: true, reason: '판정 실패 — 확인 못 함' };
  }

  cache.set(sellerProductId, { verdict, ts: Date.now() });
  return verdict;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const raw = body?.seller_product_ids;
    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json({ success: false, error: '조회할 상품이 없습니다.' }, { status: 400 });
    }

    const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_IDS);
    const client = getCoupangClient();

    // 고정 크기 워커가 큐를 나눠 먹는다 — Promise.all로 한 번에 던지면 429가 난다.
    const results: Verdict[] = [];
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
        while (cursor < ids.length) {
          const id = ids[cursor++];
          results.push(await judge(client, id));
        }
      }),
    );

    return NextResponse.json({ success: true, data: results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
