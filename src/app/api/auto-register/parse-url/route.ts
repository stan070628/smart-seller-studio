import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseSourceUrl } from '@/lib/auto-register/url-parser';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { fetchCostcoProduct } from '@/lib/sourcing/costco-client';
import type { NormalizedProduct } from '@/lib/auto-register/types';

// 요청 바디 검증
const RequestSchema = z.object({
  url: z.string().url('유효한 URL 형식이 아닙니다.'),
});

type RequestBody = z.infer<typeof RequestSchema>;

/**
 * POST /api/auto-register/parse-url
 * 도매꾹/코스트코 상품 URL을 파싱하고 정규화된 상품 데이터를 반환한다.
 *
 * Request:
 *   { "url": "https://domeggook.com/product/detail/123456" }
 *
 * Response (200):
 *   { "product": NormalizedProduct }
 *
 * Response (400/422/404/500):
 *   { "error": "메시지" }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // JSON 파싱
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: '유효한 JSON 형식이 아닙니다.' },
      { status: 400 },
    );
  }

  // Zod 검증
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    const errorMessage = parsed.error.issues[0]?.message || '유효하지 않은 입력입니다.';
    return NextResponse.json(
      { error: errorMessage },
      { status: 400 },
    );
  }

  const { url } = parsed.data as RequestBody;

  // URL 파싱
  const parsedUrl = parseSourceUrl(url);
  if (!parsedUrl) {
    return NextResponse.json(
      {
        error: '지원하지 않는 URL 형식입니다. 도매꾹 또는 코스트코 코리아 상품 URL을 입력해주세요.',
      },
      { status: 422 },
    );
  }

  try {
    let product: NormalizedProduct;

    if (parsedUrl.source === 'domeggook') {
      // 도매꾹 API 호출
      const client = getDomeggookClient();
      const itemNo = parseInt(parsedUrl.itemId, 10);

      if (Number.isNaN(itemNo)) {
        return NextResponse.json(
          { error: '유효하지 않은 도매꾹 상품 번호입니다.' },
          { status: 422 },
        );
      }

      const itemDetail = await client.getItemView(itemNo);

      if (!itemDetail || !itemDetail.basis) {
        return NextResponse.json(
          { error: '도매꾹 상품을 찾을 수 없습니다.' },
          { status: 404 },
        );
      }

      // 이미지 URL 추출
      const imageUrls: string[] = [];
      if (itemDetail.thumb?.original) {
        imageUrls.push(itemDetail.thumb.original);
      } else if (itemDetail.thumb?.large) {
        imageUrls.push(itemDetail.thumb.large);
      } else if (itemDetail.image?.url) {
        imageUrls.push(itemDetail.image.url);
      }

      // 설명 추출 (HTML에서 텍스트만 추출)
      let description = itemDetail.basis.title || '';
      if (itemDetail.desc?.contents?.item) {
        // 간단히 HTML 태그 제거 (실제 환경에서는 cheerio 등 사용 권장)
        description = itemDetail.desc.contents.item
          .replace(/<[^>]*>/g, '')
          .slice(0, 500)
          .trim();
      }

      product = {
        source: 'domeggook',
        itemId: parsedUrl.itemId,
        title: itemDetail.basis.title || '',
        price: itemDetail.price?.dome ?? 0,
        originalPrice: itemDetail.price?.resale?.Recommand,
        imageUrls,
        description,
        brand: itemDetail.seller?.nick,
        categoryHint: itemDetail.category?.current?.name,
      };
    } else {
      // 코스트코 API 호출
      const item = await fetchCostcoProduct(parsedUrl.itemId);

      if (!item) {
        return NextResponse.json(
          { error: '코스트코 상품을 찾을 수 없습니다.' },
          { status: 404 },
        );
      }

      product = {
        source: 'costco',
        itemId: parsedUrl.itemId,
        title: item.title,
        price: item.price,
        originalPrice: item.originalPrice,
        imageUrls: item.imageUrl ? [item.imageUrl] : [],
        description: item.title,
        brand: item.brand,
        categoryHint: item.categoryName,
      };
    }

    return NextResponse.json({ product }, { status: 200 });
  } catch (err) {
    const errorMessage =
      err instanceof Error
        ? err.message
        : '상품 정보를 가져오는 중 알 수 없는 오류가 발생했습니다.';

    console.error('[parse-url] Error:', {
      source: parsedUrl.source,
      itemId: parsedUrl.itemId,
      error: errorMessage,
    });

    return NextResponse.json(
      { error: '상품 정보를 가져오는 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
