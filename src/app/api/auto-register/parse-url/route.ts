import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { parseSourceUrl } from '@/lib/auto-register/url-parser';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { fetchCostcoProduct } from '@/lib/sourcing/costco-client';
import type { NormalizedProduct, NormalizedProductOption, NormalizedProductOptionValue } from '@/lib/auto-register/types';

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
  const auth = await requireAuth(req);
  if (auth instanceof Response) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

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

      // 상세 HTML (원본) + 텍스트 설명 (AI 프롬프트용)
      const rawDetailHtml = itemDetail.desc?.contents?.item ?? '';
      let description = itemDetail.basis.title || '';
      if (rawDetailHtml) {
        description = rawDetailHtml
          .replace(/<[^>]*>/g, '')
          .replace(/\s{2,}/g, ' ')
          .slice(0, 500)
          .trim();
      }

      // KC 인증번호 + 제조사 추출 (상세 HTML 텍스트 파싱)
      let certification: string | undefined;
      let manufacturerFromHtml: string | undefined;
      if (rawDetailHtml) {
        const plainText = rawDetailHtml.replace(/<[^>]*>/g, ' ');
        // KC 인증번호 패턴: "KC" 뒤 하이픈/공백 포함 영숫자 (최소 5자)
        const kcMatch = /KC[\s\-]?([A-Z0-9][\w\-]{4,30})/i.exec(plainText);
        if (kcMatch) {
          certification = `KC인증 ${kcMatch[0].replace(/\s+/g, ' ').trim()}`;
        }
        // 제조사 패턴: "제조사" 뒤 콜론/공백 + 회사명 (2~40자)
        const makerMatch = /제조사\s*[:：]?\s*([^\n\r\t<]{2,40})/i.exec(plainText);
        if (makerMatch) {
          manufacturerFromHtml = makerMatch[1].trim();
        }
      }

      // 도매가: API가 string으로 반환하는 경우도 있어 명시적 Number() 변환
      const domePrice = Number(itemDetail.price?.dome) || Number(itemDetail.price?.supply) || 0;

      // 배송비: deli.dome.tbl 형식 "수량+fee|수량+fee" 파싱 (1개 주문 기준 첫 번째 tier)
      const rawDeliFee = itemDetail.deli?.dome?.fee ?? itemDetail.deli?.fee;
      let deliFee: number;
      if (typeof rawDeliFee === 'number') {
        deliFee = rawDeliFee;
      } else if (typeof rawDeliFee === 'string' && rawDeliFee) {
        deliFee = parseFloat(rawDeliFee) || 0;
      } else {
        // tbl 형식: "50+3000|50+3000" → 첫 번째 tier의 fee 추출
        const tbl = itemDetail.deli?.dome?.tbl as string | undefined;
        if (tbl) {
          const firstTier = tbl.split('|')[0];   // "50+3000"
          const feePart = firstTier?.split('+')?.[1]; // "3000"
          deliFee = parseInt(feePart ?? '0', 10) || 0;
        } else {
          deliFee = 0;
        }
      }

      // 제조사: API basis.maker 우선, 없으면 상세 HTML에서 추출한 값 사용
      const manufacturer = (itemDetail.basis?.maker?.trim()) || manufacturerFromHtml || undefined;

      product = {
        source: 'domeggook',
        itemId: parsedUrl.itemId,
        title: itemDetail.basis.title || '',
        price: domePrice,
        originalPrice: itemDetail.price?.resale?.Recommand,
        imageUrls,
        description,
        detailHtml: rawDetailHtml || undefined,
        brand: itemDetail.seller?.nick,
        manufacturer,
        categoryHint: itemDetail.category?.current?.name,
        deliFee,
        moq: parseInt(String(itemDetail.qty?.domeMoq ?? 1), 10) || 1,
        certification,
      };

      // selectOpt 옵션 파싱 (단일/복합 옵션 모두 지원)
      if (itemDetail.selectOpt) {
        try {
          const rawOpt = JSON.parse(itemDetail.selectOpt) as {
            type?: string;
            set?: Array<{ name: string; opts: string[]; changeKey: string[] }>;
            data?: Record<string, { domPrice?: string; qty?: string; hid?: string }>;
          };
          if (rawOpt.set && Array.isArray(rawOpt.set) && rawOpt.set.length > 0) {
            const sets = rawOpt.set;
            const data = rawOpt.data ?? {};
            const isSingleDim = sets.length === 1;

            const parsedOptions: NormalizedProductOption[] = sets
              .map((setItem) => {
                const values: NormalizedProductOptionValue[] = [];
                for (let i = 0; i < setItem.opts.length; i++) {
                  const changeKey = setItem.changeKey?.[i] ?? String(i);
                  const dataKey = changeKey.padStart(2, '0');
                  const entry = data[dataKey];
                  if (entry?.hid === '1') continue;

                  const fullName = setItem.opts[i];
                  const bracketMatch = /\[([^\]]+)\]$/.exec(fullName);
                  const label = bracketMatch ? bracketMatch[1].trim() : fullName.trim();

                  values.push({
                    label,
                    fullName,
                    priceAdjustment: isSingleDim ? (parseInt(entry?.domPrice ?? '0', 10) || 0) : 0,
                    stock: parseInt(entry?.qty ?? '99999', 10) || 0,
                  });
                }
                return { typeName: setItem.name, values };
              })
              .filter((o) => o.values.length > 0);

            if (parsedOptions.length > 0) {
              product.options = parsedOptions;
            }
          }
        } catch {
          // selectOpt JSON 파싱 실패 → 옵션 없음
        }
      }
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
