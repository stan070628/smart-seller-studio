import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { parseSourceUrl } from '@/lib/auto-register/url-parser';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { fetchCostcoProduct } from '@/lib/sourcing/costco-client';
import { expandKeywords } from '@/lib/naver-ad';
import type { KeywordStat } from '@/lib/naver-ad';
import type { NormalizedProduct, NormalizedProductOption, NormalizedProductOptionValue } from '@/lib/auto-register/types';

// 요청 바디 검증
const RequestSchema = z.object({
  url: z.string().url('유효한 URL 형식이 아닙니다.'),
});

type RequestBody = z.infer<typeof RequestSchema>;

// ─────────────────────────────────────────────────────────────
// 도매꾹 상품 페이지 스크래핑 헬퍼
// ─────────────────────────────────────────────────────────────

interface DomeggookPageInfo {
  manufacturer?: string;
  certification?: string;
}

/**
 * 라벨(예: "제조사") 뒤에 오는 첫 번째 유의미한 텍스트를 HTML에서 추출.
 * 라벨 이후 300자를 태그 제거 후 첫 번째 비공백 값을 반환.
 */
function extractLabelValue(html: string, label: string): string | undefined {
  const idx = html.indexOf(label);
  if (idx === -1) return undefined;
  const snippet = html.slice(idx + label.length, idx + label.length + 300);
  // 태그 제거 + HTML 엔티티 단순화
  const text = snippet.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').trim();
  // 콜론/공백 건너뛰고 첫 번째 값 추출
  const m = /^[\s:：\-]*(\S[^\n\r\t]{0,39})/.exec(text);
  if (!m) return undefined;
  const value = m[1].trim().split(/\s{2,}/)[0].trim();
  return value.length >= 2 && value.length <= 40 ? value : undefined;
}

/**
 * 도매꾹 상품 URL을 직접 fetch하여 제조사 · KC 인증번호를 추출.
 * 실패 시 빈 객체 반환 (API 값으로 폴백).
 */
async function scrapeDomeggookPage(url: string): Promise<DomeggookPageInfo> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return {};
    const html = await res.text();

    const manufacturer = extractLabelValue(html, '제조사');

    let certification: string | undefined;
    const kcMatch = /KC[\s\-]?([A-Z0-9][\w\-]{4,30})/i.exec(html);
    if (kcMatch) {
      certification = `KC인증 ${kcMatch[0].replace(/\s+/g, ' ').trim()}`;
    }

    return { manufacturer, certification };
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────
// 네이버 연관검색어로 검색태그 제안
// ─────────────────────────────────────────────────────────────

/**
 * 상품 제목의 주요 단어를 씨드로 네이버 검색광고 API expandKeywords를 호출하여
 * 연관 검색어를 검색량 기준으로 정렬 후 상위 10개를 반환.
 * 환경변수 미설정 또는 API 실패 시 빈 배열.
 */
async function suggestTagsFromNaver(title: string): Promise<string[]> {
  try {
    const seeds = title
      .replace(/[\[\]()（）【】《》\/\\,·]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !/^\d+$/.test(w))
      .slice(0, 5);

    if (seeds.length === 0) return [];

    const stats = await Promise.race<KeywordStat[]>([
      expandKeywords(seeds),
      new Promise<KeywordStat[]>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5000),
      ),
    ]);

    return stats
      .filter((k) => (k.searchVolume ?? 0) >= 100)
      .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
      .slice(0, 10)
      .map((k) => k.keyword);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '유효한 JSON 형식이 아닙니다.' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    const errorMessage = parsed.error.issues[0]?.message || '유효하지 않은 입력입니다.';
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }

  const { url } = parsed.data as RequestBody;

  const parsedUrl = parseSourceUrl(url);
  if (!parsedUrl) {
    return NextResponse.json(
      { error: '지원하지 않는 URL 형식입니다. 도매꾹 또는 코스트코 코리아 상품 URL을 입력해주세요.' },
      { status: 422 },
    );
  }

  try {
    let product: NormalizedProduct;

    if (parsedUrl.source === 'domeggook') {
      const client = getDomeggookClient();
      const itemNo = parseInt(parsedUrl.itemId, 10);

      if (Number.isNaN(itemNo)) {
        return NextResponse.json({ error: '유효하지 않은 도매꾹 상품 번호입니다.' }, { status: 422 });
      }

      // API 호출 + 실제 상품 페이지 스크래핑 병렬 실행
      const [apiRes, pageRes] = await Promise.allSettled([
        client.getItemView(itemNo),
        scrapeDomeggookPage(url),
      ]);

      if (apiRes.status !== 'fulfilled' || !apiRes.value?.basis) {
        return NextResponse.json({ error: '도매꾹 상품을 찾을 수 없습니다.' }, { status: 404 });
      }

      const itemDetail = apiRes.value;
      const pageInfo = pageRes.status === 'fulfilled' ? pageRes.value : {};

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

      // KC 인증번호: 페이지 스크래핑 우선, API desc HTML 폴백
      let certification: string | undefined = pageInfo.certification;
      if (!certification && rawDetailHtml) {
        const plainText = rawDetailHtml.replace(/<[^>]*>/g, ' ');
        const kcMatch = /KC[\s\-]?([A-Z0-9][\w\-]{4,30})/i.exec(plainText);
        if (kcMatch) certification = `KC인증 ${kcMatch[0].replace(/\s+/g, ' ').trim()}`;
      }

      // 제조사: 페이지 스크래핑 > API(basis.maker) > desc HTML regex
      let manufacturer: string | undefined =
        pageInfo.manufacturer || itemDetail.basis?.maker?.trim() || undefined;
      if (!manufacturer && rawDetailHtml) {
        const plainText = rawDetailHtml.replace(/<[^>]*>/g, ' ');
        const makerMatch = /제조사\s*[:：]?\s*([^\n\r\t<]{2,40})/i.exec(plainText);
        if (makerMatch) {
          const raw = makerMatch[1].trim().split(/\s{2,}/)[0].trim();
          if (raw.length >= 2) manufacturer = raw;
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
        const tbl = itemDetail.deli?.dome?.tbl as string | undefined;
        if (tbl) {
          const firstTier = tbl.split('|')[0];
          const feePart = firstTier?.split('+')?.[1];
          deliFee = parseInt(feePart ?? '0', 10) || 0;
        } else {
          deliFee = 0;
        }
      }

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

      // 네이버 연관검색어로 검색태그 자동 제안
      const suggestedTags = await suggestTagsFromNaver(product.title);
      if (suggestedTags.length > 0) product.suggestedTags = suggestedTags;

    } else {
      // 코스트코 API + 상품 페이지 병렬 호출
      const [item, cosPageHtml] = await Promise.all([
        fetchCostcoProduct(parsedUrl.itemId),
        fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'ko-KR,ko;q=0.9',
          },
          signal: AbortSignal.timeout(6000),
        }).then((r) => r.ok ? r.text() : '').catch(() => ''),
      ]);

      if (!item) {
        return NextResponse.json({ error: '코스트코 상품을 찾을 수 없습니다.' }, { status: 404 });
      }

      // 페이지 HTML에서 제조사/브랜드 추출 (API가 비어있을 때 보완)
      let costooBrand = item.brand || undefined;
      if (!costooBrand && cosPageHtml) {
        const mfMatch = /제조사[:\s：]*([^\s/\n<][^/\n<]{0,20})/.exec(cosPageHtml);
        if (mfMatch) {
          costooBrand = mfMatch[1].replace(/<[^>]*>/g, '').trim();
        }
      }

      // KC 인증번호 추출
      let cosCertification: string | undefined;
      if (cosPageHtml) {
        const kcMatch = /KC[\s\-]?([A-Z0-9][\w\-]{4,30})/i.exec(cosPageHtml);
        if (kcMatch) cosCertification = `KC인증 ${kcMatch[0].replace(/\s+/g, ' ').trim()}`;
      }

      product = {
        source: 'costco',
        itemId: parsedUrl.itemId,
        title: item.title,
        price: item.price,
        originalPrice: item.originalPrice,
        imageUrls: item.imageUrl ? [item.imageUrl] : [],
        description: item.title,
        brand: costooBrand,
        manufacturer: costooBrand,
        categoryHint: item.categoryName,
        certification: cosCertification,
      };

      // 코스트코도 네이버 연관검색어 태그 제안
      const suggestedTags = await suggestTagsFromNaver(product.title);
      if (suggestedTags.length > 0) product.suggestedTags = suggestedTags;
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
