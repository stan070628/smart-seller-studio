import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { parseSourceUrl } from '@/lib/auto-register/url-parser';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { fetchCostcoProduct } from '@/lib/sourcing/costco-client';
import { expandKeywords } from '@/lib/naver-ad';
import { appendPrivacyFooter } from '@/lib/detail-page-privacy';
import type { KeywordStat } from '@/lib/naver-ad';
import type { NormalizedProduct, NormalizedProductOption, NormalizedProductOptionValue } from '@/lib/auto-register/types';

// 요청 바디 검증
const RequestSchema = z.object({
  url: z.string().url('유효한 URL 형식이 아닙니다.'),
});

type RequestBody = z.infer<typeof RequestSchema>;

// ─────────────────────────────────────────────────────────────
// KC 인증번호 추출 헬퍼 (도매꾹·코스트코 공통)
// ─────────────────────────────────────────────────────────────

function extractKcCert(plainText: string): string | undefined {
  // 패턴별로 모든 매치를 수집하여 중복 없이 합친다 (쉼표 구분)
  const patterns: RegExp[] = [
    /인증번호[\s:：]+([A-Z0-9][A-Z0-9\-]{4,40})/gi,
    /\b(R-R-[A-Za-z0-9가-힣\-]{3,40})/g,
    /\b(MSIP-REI-[A-Za-z0-9가-힣\-]{3,40})/g,
    /\b(SU\d{5}-\d{4,6}[A-Z]?)/gi,
    /KC[\s\-]?인증[\s\-]?번호[\s:：]*([A-Z0-9][A-Z0-9\-]{4,30})/gi,
    /전기용품안전인증번호[\s:：]*([A-Z0-9][A-Z0-9\-]{4,40})/gi,
    /\b(XU\d{6}-\d{5})/gi, // 전기용품안전인증 형식 (XU100557-25047)
  ];
  const found = new Set<string>();
  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(plainText)) !== null) {
      const val = (m[1] ?? m[0]).trim();
      if (val) found.add(val);
    }
  }
  return found.size > 0 ? [...found].join(', ') : undefined;
}

// ─────────────────────────────────────────────────────────────
// 도매꾹 상품 페이지 스크래핑 헬퍼
// ─────────────────────────────────────────────────────────────

interface DomeggookPageInfo {
  manufacturer?: string;
  certification?: string;
  countryOfOrigin?: string;
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
    const countryOfOrigin = extractLabelValue(html, '원산지') || extractLabelValue(html, '제조국');
    const plain = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const certification = extractKcCert(plain);

    return { manufacturer, countryOfOrigin, certification };
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────
// 코스트코 상품 페이지 스크래핑 헬퍼
// ─────────────────────────────────────────────────────────────

interface CostcoPageDetail {
  description?: string;
}

/**
 * 코스트코 온라인 상품 페이지 HTML에서 상품 설명을 추출합니다.
 * 우선순위: JSON-LD structured data → og:description → meta description
 * jsdom 없이 정규식만 사용합니다.
 */
function scrapeCostcoPageDetail(html: string): CostcoPageDetail {
  if (!html) return {};

  // 1. JSON-LD structured data (가장 신뢰도 높음)
  const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim()) as Record<string, unknown>;
      if (data['@type'] === 'Product' && typeof data.description === 'string' && data.description.length > 20) {
        return { description: data.description.slice(0, 1000).trim() };
      }
    } catch { /* ignore */ }
  }

  // 2. og:description 또는 meta description
  const contentFirst = /<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']{20,500})["'][^>]*>/i.exec(html);
  const contentSecond = /<meta[^>]+content=["']([^"']{20,500})["'][^>]+(?:property=["']og:description["']|name=["']description["'])[^>]*>/i.exec(html);
  const metaDesc = (contentFirst ?? contentSecond)?.[1]?.trim();
  if (metaDesc) return { description: metaDesc };

  return {};
}

// ─────────────────────────────────────────────────────────────
// 네이버 연관검색어로 검색태그 제안
// ─────────────────────────────────────────────────────────────

/**
 * 상품 제목의 주요 단어를 씨드로 네이버 검색광고 API expandKeywords를 호출하여
 * 연관 검색어를 검색량 기준으로 정렬 후 상위 10개를 반환.
 * 환경변수 미설정 또는 API 실패 시 빈 배열.
 */

// 쇼핑몰·유통사명은 씨드로 사용 시 해당 몰의 인기상품 전체를 연관어로 반환하므로 제외
const GENERIC_SEED_STOPWORDS = new Set([
  '코스트코', '이마트', '홈플러스', '쿠팡', '롯데마트', '마켓컬리', '지마켓', '옥션',
  '11번가', '네이버', '카카오', '위메프', '티몬', '쓱', 'ssg', 'kirkland', '커클랜드',
  '정품', '공식', '무료배송', '당일배송', '특가', '할인', '세일', '신상',
]);

async function suggestTagsFromNaver(title: string): Promise<string[]> {
  try {
    const allWords = title
      .replace(/[\[\]()（）【】《》\/\\,·]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !/^\d+$/.test(w));

    const seeds = allWords
      .filter((w) => !GENERIC_SEED_STOPWORDS.has(w.toLowerCase()))
      .slice(0, 5);

    if (seeds.length === 0) return [];

    const stats = await Promise.race<KeywordStat[]>([
      expandKeywords(seeds),
      new Promise<KeywordStat[]>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5000),
      ),
    ]);

    // 씨드 단어를 2자 이상만 남기고 소문자화
    const seedSet = seeds.map((s) => s.toLowerCase()).filter((s) => s.length >= 2);
    // 씨드가 3개 이상이면 최소 2개 씨드가 포함된 키워드만 통과 (단일 씨드 OR 조건은 "골프화" 같은 오탐 유발)
    const minMatchCount = seedSet.length >= 3 ? 2 : 1;
    return stats
      .filter((k) => {
        if ((k.searchVolume ?? 0) < 100) return false;
        const kw = k.keyword.toLowerCase();
        // 키워드가 씨드를 포함해야 함 (역방향 s.includes(kw) 제거 — 오탐 원인)
        const matchCount = seedSet.filter((s) => kw.includes(s)).length;
        return matchCount >= minMatchCount;
      })
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

      // 상세 HTML에서 이미지 URL 추출 (도매꾹 상세페이지 이미지)
      // src, data-src, data-original, data-lazy 등 lazy-load 속성도 모두 추출
      const detailImageUrls: string[] = [];
      if (rawDetailHtml) {
        const imgTagRegex = /<img[^>]*>/gi;
        const urlAttrRegex = /(?:src|data-src|data-original|data-lazy(?:-src)?|data-url)=["']([^"']+)["']/gi;
        let tagMatch: RegExpExecArray | null;
        while ((tagMatch = imgTagRegex.exec(rawDetailHtml)) !== null) {
          const tag = tagMatch[0];
          urlAttrRegex.lastIndex = 0;
          let attrMatch: RegExpExecArray | null;
          while ((attrMatch = urlAttrRegex.exec(tag)) !== null) {
            const src = attrMatch[1];
            if (src && src.startsWith('http') && !detailImageUrls.includes(src)) {
              detailImageUrls.push(src);
            }
          }
        }
        console.log(`[parse-url/domeggook] rawDetailHtml length=${rawDetailHtml.length}, detailImageUrls=${detailImageUrls.length}`);
      } else {
        console.log(`[parse-url/domeggook] rawDetailHtml empty — itemId=${parsedUrl.itemId}`);
      }

      // KC 인증번호: 페이지 스크래핑 우선, API desc HTML 폴백
      let certification: string | undefined = pageInfo.certification;
      if (!certification && rawDetailHtml) {
        const plainText = rawDetailHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        certification = extractKcCert(plainText);
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

      // 상세 HTML 이미지를 imageUrls에도 추가 (API는 썸네일 1장뿐이므로)
      // 중복 제거하여 순서대로: 메인 썸네일 → 상세 HTML 이미지
      const mergedImageUrls = [...imageUrls];
      for (const u of detailImageUrls) {
        if (!mergedImageUrls.includes(u)) mergedImageUrls.push(u);
      }

      product = {
        source: 'domeggook',
        itemId: parsedUrl.itemId,
        title: itemDetail.basis.title || '',
        price: domePrice,
        originalPrice: itemDetail.price?.resale?.Recommand,
        imageUrls: mergedImageUrls,
        detailImageUrls: detailImageUrls.length > 0 ? detailImageUrls : undefined,
        description,
        detailHtml: appendPrivacyFooter(rawDetailHtml) || undefined,
        brand: itemDetail.seller?.nick,
        manufacturer,
        countryOfOrigin: pageInfo.countryOfOrigin,
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

      // 페이지 HTML에서 제조사/브랜드 + 상세 설명 추출
      let costooBrand = item.brand || undefined;
      if (!costooBrand && cosPageHtml) {
        const mfMatch = /제조사[:\s：]*([^\s/\n<][^/\n<]{0,20})/.exec(cosPageHtml);
        if (mfMatch) {
          costooBrand = mfMatch[1].replace(/<[^>]*>/g, '').trim();
        }
      }

      const pageDetail = scrapeCostcoPageDetail(cosPageHtml);

      // KC 인증번호 + 원산지 추출
      // 1순위: 구조화된 features에서 직접 추출
      let cosCertification: string | undefined;
      let cosCountryOfOrigin: string | undefined;
      const allFeatures = (item.classifications ?? []).flatMap((c: { features?: { name?: string; featureValues?: { value?: string }[] }[] }) => c.features ?? []);

      // 고시정보 AI용 추가 필드
      let cosColor: string | undefined;
      let cosSize: string | undefined;
      let cosManufactureDate: string | undefined;
      let cosMaterial: string | undefined;
      let cosManufacturer: string | undefined;
      let cosManufacturerFromFeature: string | undefined;
      let cosColors: string | undefined;
      // 옵션 조합용 개별 색상/사이즈 값 배열
      let cosColorValues: string[] = [];
      let cosSizeValues: string[] = [];

      for (const f of allFeatures) {
        const fname = f.name ?? '';
        const fval = (f.featureValues ?? [])[0]?.value ?? '';
        const fvalAll = (f.featureValues ?? []).map((v: { value?: string }) => v.value ?? '').filter(Boolean).join(', ');
        const fvalList = (f.featureValues ?? []).map((v: { value?: string }) => v.value ?? '').filter(Boolean);

        if (/인증/i.test(fname) && fval) {
          const certMatch = extractKcCert(fval);
          if (certMatch) { cosCertification = certMatch; }
          else if (/^[A-Z0-9][A-Z0-9\-]{4,40}$/.test(fval.trim())) { cosCertification = fval.trim(); }
        }
        if (!cosCountryOfOrigin && /원산지|country.of.origin|제조국|made.in/i.test(fname) && fval) {
          cosCountryOfOrigin = fval.trim();
        }
        if (!cosManufacturer && /제조자|수입자|제조사|브랜드/i.test(fname) && fvalAll) {
          cosManufacturer = fvalAll.trim();
        }
        if (!cosColors && /색상|color/i.test(fname) && fvalAll) {
          cosColors = fvalAll.trim();
        }
        // 고시정보 AI용 추가 필드
        if (!cosColor && /색상|color|컬러/i.test(fname) && fvalAll) {
          cosColor = fvalAll.trim();
        }
        if (!cosSize && /치수|사이즈|size/i.test(fname) && fvalAll) {
          cosSize = fvalAll.trim();
        }
        if (!cosManufactureDate && /제조연월|제조년월|제조일|manufactured/i.test(fname) && fval) {
          cosManufactureDate = fval.trim();
        }
        if (!cosMaterial && /소재|원단|재질|material|composition/i.test(fname) && fvalAll) {
          cosMaterial = fvalAll.trim();
        }
        if (!costooBrand && !cosManufacturerFromFeature && /제조사|제조자|브랜드|manufacturer|brand/i.test(fname) && fval) {
          cosManufacturerFromFeature = fval.trim();
        }
        // 옵션 조합용: 색상/사이즈 개별 값 수집
        if (cosColorValues.length === 0 && /색상|color|컬러/i.test(fname) && fvalList.length > 0) {
          cosColorValues = fvalList;
        }
        if (cosSizeValues.length === 0 && /치수|사이즈|size/i.test(fname) && fvalList.length > 0) {
          cosSizeValues = fvalList;
        }
      }

      // 2순위: 페이지 HTML 텍스트에서 추출
      const cosPlainText = cosPageHtml ? cosPageHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') : '';
      if (!cosCertification && cosPlainText) {
        cosCertification = extractKcCert(cosPlainText);
      }
      if (!cosCountryOfOrigin && cosPlainText) {
        const originMatch = /원산지\s*[:：]?\s*([^\s,<]{2,20})/.exec(cosPlainText)
          || /country\s+of\s+origin\s*[:：]?\s*([^\s,<]{2,20})/i.exec(cosPlainText)
          || /Made\s+in\s+([A-Za-z가-힣]{2,20})/i.exec(cosPlainText);
        if (originMatch) cosCountryOfOrigin = originMatch[1].trim();
      }

      // 모든 이미지 수집: primary + gallery (중복 제거)
      const allImageUrls: string[] = [];
      if (item.imageUrl) allImageUrls.push(item.imageUrl);
      if (item.galleryImages) {
        for (const u of item.galleryImages) {
          if (u !== item.imageUrl) allImageUrls.push(u);
        }
      }

      // 상세 HTML 생성 (제목 + 전체 이미지 + 스펙 테이블 + 설명)
      const safeTitle = item.title
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      const imagesHtml = allImageUrls
        .map(u => `<div style="width:100%;margin-bottom:8px;"><img src="${u}" alt="${safeTitle}" style="width:100%;max-width:780px;display:block;margin:0 auto;" /></div>`)
        .join('\n');

      // description HTML 내 상대경로 이미지 → 절대 URL 변환 후 추가 수집
      const cosDetailImageUrls: string[] = [...allImageUrls];
      const rawDescHtml = item.description || '';
      const fixedDescHtml = rawDescHtml
        ? rawDescHtml.replace(/src=["'](\/mediapermalink\/[^"']+)["']/gi,
            (_m, p1: string) => `src="https://www.costco.co.kr${p1}"`)
        : '';

      // description HTML의 절대 URL 이미지 수집
      if (fixedDescHtml && /<img/i.test(fixedDescHtml)) {
        const imgTagRegex2 = /<img[^>]*>/gi;
        const urlAttrRegex2 = /(?:src|data-src|data-original|data-lazy(?:-src)?|data-url)=["']([^"']+)["']/gi;
        let tagMatch2: RegExpExecArray | null;
        while ((tagMatch2 = imgTagRegex2.exec(fixedDescHtml)) !== null) {
          const tag2 = tagMatch2[0];
          urlAttrRegex2.lastIndex = 0;
          let attrMatch2: RegExpExecArray | null;
          while ((attrMatch2 = urlAttrRegex2.exec(tag2)) !== null) {
            const src = attrMatch2[1];
            if (src && src.startsWith('http') && !cosDetailImageUrls.includes(src)) {
              cosDetailImageUrls.push(src);
            }
          }
        }
      }

      // classifications.features → 스펙 테이블 HTML
      let specsHtml = '';
      const features = (item.classifications ?? []).flatMap(c => c.features ?? []);
      if (features.length > 0) {
        const rows = features
          .filter(f => f.name && f.featureValues?.length > 0)
          .map(f => {
            const valStr = f.featureValues
              .map(v => (v.value ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
              .join(', ')
              .replace(/\n/g, '<br/>');
            const safeName = f.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<tr style="border-bottom:1px solid #f0f0f0;">` +
              `<td style="padding:10px 12px;font-weight:600;color:#555;word-break:keep-all;width:160px;min-width:120px;max-width:180px;vertical-align:top;background:#fafafa;">${safeName}</td>` +
              `<td style="padding:10px 12px;color:#333;line-height:1.6;word-break:break-word;">${valStr}</td>` +
              `</tr>`;
          })
          .join('\n');

        if (rows) {
          specsHtml = `\n<div style="padding:16px;">\n` +
            `<h2 style="font-size:16px;font-weight:700;margin:0 0 12px;color:#222;">상품 정보</h2>\n` +
            `<table style="width:100%;border-collapse:collapse;border:1px solid #e8e8e8;font-size:14px;">\n` +
            rows + `\n</table>\n</div>`;
        }
      }

      // description 텍스트(og:description 등) 폴백
      const descFallback = pageDetail.description;
      let descHtml = '';
      if (descFallback && features.length === 0) {
        descHtml = `\n<div style="padding:16px;line-height:1.7;color:#333;font-size:15px;">${
          descFallback.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
        }</div>`;
      }

      // description HTML 이미지 블록 (내용이 실질적인 경우에만)
      const descImgHtml = fixedDescHtml && /<img/i.test(fixedDescHtml)
        ? `\n<div style="padding:8px 0;">${fixedDescHtml}</div>`
        : '';

      const cosDetailHtml =
        `<div style="max-width:780px;margin:0 auto;font-family:sans-serif;background:#fff;padding:20px 16px;">\n` +
        `<h1 style="font-size:22px;font-weight:700;text-align:center;margin:0 0 16px;line-height:1.4;">${safeTitle}</h1>\n` +
        imagesHtml +
        descImgHtml +
        specsHtml +
        descHtml +
        `\n</div>` +
        appendPrivacyFooter('');

      // 구조화된 스펙 텍스트 (고시정보 AI용) — detailHtml과 별개
      const cosSpecParts: string[] = [];
      if (costooBrand) cosSpecParts.push(`브랜드/제조사: ${costooBrand}`);
      if (cosCountryOfOrigin) cosSpecParts.push(`원산지/제조국: ${cosCountryOfOrigin}`);
      if (cosColor) cosSpecParts.push(`색상: ${cosColor}`);
      if (cosSize) cosSpecParts.push(`치수/사이즈: ${cosSize}`);
      if (cosMaterial) cosSpecParts.push(`소재: ${cosMaterial}`);
      if (cosManufactureDate) cosSpecParts.push(`제조연월: ${cosManufactureDate}`);
      // API features에서 추가로 수집 (이미 위에서 추출한 필드는 skip)
      for (const f of features) {
        if (!f.name || !f.featureValues?.length) continue;
        const n = f.name;
        if (/색상|color|컬러|치수|사이즈|size|소재|원단|재질|material|원산지|제조국|제조연월|인증|브랜드/i.test(n)) continue;
        const v = f.featureValues.map((fv: { value?: string }) => fv.value ?? '').filter(Boolean).join(', ');
        if (v) cosSpecParts.push(`${n}: ${v}`);
      }
      const cosSpecText = cosSpecParts.length > 0 ? cosSpecParts.join('\n') : undefined;

      console.log(`[parse-url/costco] imageUrls=${allImageUrls.length}, detailImageUrls=${cosDetailImageUrls.length}, galleryImages=${item.galleryImages?.length ?? 0}, specFeatures=${features.length}`);

      product = {
        source: 'costco',
        itemId: parsedUrl.itemId,
        title: item.title,
        price: item.price,
        originalPrice: item.originalPrice,
        imageUrls: allImageUrls,
        detailImageUrls: cosDetailImageUrls.length > 0 ? cosDetailImageUrls : undefined,
        description: cosSpecText || (features.length > 0
          ? features.filter((f: { featureValues?: { value?: string }[] }) => f.featureValues?.length ?? 0 > 0)
              .map((f: { name: string; featureValues: { value?: string }[] }) => `${f.name}: ${f.featureValues.map((v: { value?: string }) => v.value).join(', ')}`)
              .join('\n')
          : (item.description?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || pageDetail.description || item.title)),
        specText: cosSpecText,
        detailHtml: cosDetailHtml,
        brand: costooBrand,
        manufacturer: costooBrand || cosManufacturer || cosManufacturerFromFeature || undefined,
        countryOfOrigin: cosCountryOfOrigin,
        categoryHint: item.categoryName,
        certification: cosCertification,
        specs: features.length > 0
          ? features
              .filter((f: { name?: string; featureValues?: { value?: string }[] }) =>
                f.name && f.featureValues?.length && f.featureValues[0]?.value)
              .map((f: { name: string; featureValues: { value?: string }[] }) => ({
                label: f.name,
                value: f.featureValues.map((v: { value?: string }) => v.value ?? '').join(', '),
              }))
          : undefined,
      };

      // 코스트코 색상/사이즈 옵션 매핑 (featureValues 2개 이상인 경우만 옵션으로 처리)
      const cosOptions: NormalizedProductOption[] = [];
      if (cosColorValues.length >= 2) {
        cosOptions.push({
          typeName: '색상',
          values: cosColorValues.map((v) => ({ label: v, fullName: v, priceAdjustment: 0, stock: 0 })),
        });
      }
      if (cosSizeValues.length >= 2) {
        cosOptions.push({
          typeName: '사이즈',
          values: cosSizeValues.map((v) => ({ label: v, fullName: v, priceAdjustment: 0, stock: 0 })),
        });
      }
      if (cosOptions.length > 0) product.options = cosOptions;

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
