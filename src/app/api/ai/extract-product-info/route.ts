/**
 * POST /api/ai/extract-product-info
 *
 * 두 가지 모드 지원:
 * A) URL 모드: { url: string } → HTML 스크래핑 → 이미지 추출 → Claude Vision
 * B) 이미지 모드: { images: [{ imageBase64, mimeType }] } → 직접 Claude Vision
 *
 * 쿠팡 등 JS 동적 렌더링 사이트는 URL 모드가 실패할 수 있으므로
 * 이미지 모드(스크린샷 붙여넣기)를 폴백으로 제공
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { PRODUCT_EXTRACT_SYSTEM_PROMPT, type ProductExtractResult } from '@/lib/ai/prompts/product-extract';

// ─── Anthropic 싱글톤 ─────────────────────────────────────────
let anthropicClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (!anthropicClient) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
    anthropicClient = new Anthropic({ apiKey: key });
  }
  return anthropicClient;
}

// ─── Claude Vision 분석 공통 함수 ─────────────────────────────
async function analyzeWithVision(
  images: { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }[],
  contextHint: string,
): Promise<ProductExtractResult> {
  const client = getClient();

  const imageContent: Anthropic.Messages.ContentBlockParam[] = images.map((img) => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: img.mediaType,
      data: img.data,
    },
  }));

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: PRODUCT_EXTRACT_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          ...imageContent,
          { type: 'text', text: contextHint },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('AI 응답에서 텍스트를 찾을 수 없습니다');
  }

  const rawText = textBlock.text.trim();
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI 응답에서 JSON을 찾을 수 없습니다');

  return JSON.parse(jsonMatch[0]);
}

// ─── 플랫폼별 HTML 가져오기 ───────────────────────────────────
async function fetchPageHtml(url: string, parsedUrl: URL): Promise<string | null> {
  const isCoupang = parsedUrl.hostname.includes('coupang.com');

  let fetchUrl = url;
  if (isCoupang && !parsedUrl.hostname.startsWith('m.')) {
    fetchUrl = url.replace('://www.coupang.com', '://m.coupang.com');
  }

  const strategies: { url: string; headers: Record<string, string> }[] = isCoupang
    ? [
        {
          url: fetchUrl,
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
          },
        },
        {
          url,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'max-age=0',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
          },
        },
      ]
    : [
        {
          url,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9',
          },
        },
      ];

  for (const strategy of strategies) {
    try {
      const res = await fetch(strategy.url, {
        headers: strategy.headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return await res.text();
      if (res.status === 403) continue;
    } catch {
      continue;
    }
  }
  return null;
}

// ─── 이미지 URL 추출 ─────────────────────────────────────────
function extractDetailImages(html: string, url: string): string[] {
  const images: string[] = [];

  if (url.includes('coupang.com')) {
    let match;

    // 쿠팡 CDN URL 패턴 (가장 확실)
    const cdnRegex = /https?:\/\/[^"'\s]*(?:coupangcdn|image\d*\.coupangcdn)\.com\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/gi;
    while ((match = cdnRegex.exec(html)) !== null) {
      if (match[0]) images.push(match[0]);
    }

    // vendorItemContentDescriptions JSON 내 이미지
    const jsonMatch = html.match(/vendorItemContentDescriptions\s*[=:]\s*(\[[\s\S]*?\])/);
    if (jsonMatch) {
      try {
        const descriptions = JSON.parse(jsonMatch[1]);
        for (const desc of descriptions) {
          const imgUrl = desc.imageUrl || desc.content;
          if (typeof imgUrl === 'string' && /\.(jpg|jpeg|png|webp)/i.test(imgUrl)) {
            images.push(imgUrl.startsWith('//') ? `https:${imgUrl}` : imgUrl);
          }
        }
      } catch { /* ignore */ }
    }

    // img 태그
    const imgRegex = /<img[^>]+(?:src|data-src|data-img-src)=["']([^"']+)["'][^>]*>/gi;
    while ((match = imgRegex.exec(html)) !== null) {
      const src = match[1];
      if (!src) continue;
      const fullSrc = src.startsWith('//') ? `https:${src}` : src;
      if (/\.(jpg|jpeg|png|webp)/i.test(fullSrc) || fullSrc.includes('coupangcdn')) {
        images.push(fullSrc);
      }
    }
  } else if (url.includes('smartstore.naver.com') || url.includes('shopping.naver.com')) {
    const imgRegex = /<img[^>]+src=["'](https?:\/\/[^"']*(?:shop-phinf|phinf)\.pstatic\.net[^"']*)["'][^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      if (match[1]) images.push(match[1]);
    }
  } else if (url.includes('11st.co.kr')) {
    const imgRegex = /<img[^>]+src=["'](https?:\/\/[^"']*(?:11st\.co\.kr|cdn\.011st\.com)[^"']*)["'][^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      if (match[1]) images.push(match[1]);
    }
  } else if (url.includes('domeggook.com') || url.includes('domemegg.com') || url.includes('dommae.com') || url.includes('domae.me')) {
    // 도매꾹/도매매: 상세 설명 영역 이미지
    let match;

    // 상세 설명 영역 탐색
    const detailMatch = html.match(/class="(?:product-detail|item-description|detail_content|goods_desc|detail_info)"[\s\S]*?<\/div>/i) ||
                          html.match(/id="(?:detail|goods_detail|itemDetail)"[\s\S]*?<\/div>/i);
    const searchArea = detailMatch?.[0] || html;

    // img 태그에서 추출
    const imgRegex = /<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi;
    while ((match = imgRegex.exec(searchArea)) !== null) {
      const src = match[1];
      if (!src) continue;
      const fullSrc = src.startsWith('//') ? `https:${src}` : src;
      if (/\.(jpg|jpeg|png|webp|gif)/i.test(fullSrc) && !fullSrc.includes('icon') && !fullSrc.includes('logo')) {
        images.push(fullSrc);
      }
    }

    // 도매꾹 CDN 패턴
    const cdnRegex = /https?:\/\/[^"'\s]*(?:domeggook|domemegg|dommae)[\w.]*\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/gi;
    while ((match = cdnRegex.exec(html)) !== null) {
      if (match[0] && !images.includes(match[0])) {
        images.push(match[0]);
      }
    }
  }

  // 범용 폴백
  if (images.length === 0) {
    const imgRegex = /<img[^>]+(?:src|data-src)=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["'][^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      const src = match[1];
      if (src && !src.includes('icon') && !src.includes('logo') && !src.includes('badge') && !src.includes('sprite')) {
        images.push(src);
      }
    }
  }

  return [...new Set(images)]
    .filter((s) => !s.includes('icon') && !s.includes('logo') && !s.includes('1x1') && !s.includes('pixel'))
    .slice(0, 8);
}

// ─── 이미지 다운로드 ──────────────────────────────────────────
async function fetchImageAsBase64(
  imageUrl: string,
): Promise<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' } | null> {
  try {
    let referer = '';
    try { referer = new URL(imageUrl).origin; } catch { /* ignore */ }

    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'image/*,*/*;q=0.8',
        'Referer': referer,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? '';
    let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg';
    if (contentType.includes('png')) mediaType = 'image/png';
    else if (contentType.includes('webp')) mediaType = 'image/webp';

    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 5000 || bytes.length > 10_000_000) return null;

    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return { data: btoa(binary), mediaType };
  } catch {
    return null;
  }
}

// ─── 메인 핸들러 ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, images: clientImages } = body as {
      url?: string;
      images?: { imageBase64: string; mimeType: string }[];
    };

    // ═══════════════════════════════════════════════════════════
    // 모드 B: 클라이언트에서 직접 이미지 전송 (스크린샷 붙여넣기)
    // ═══════════════════════════════════════════════════════════
    if (clientImages && Array.isArray(clientImages) && clientImages.length > 0) {
      const validImages = clientImages
        .filter((img) => img.imageBase64 && img.mimeType)
        .slice(0, 5)
        .map((img) => {
          // data:image/png;base64,... 에서 순수 base64만 추출
          const base64 = img.imageBase64.includes(',')
            ? img.imageBase64.split(',')[1]
            : img.imageBase64;

          let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg';
          if (img.mimeType.includes('png')) mediaType = 'image/png';
          else if (img.mimeType.includes('webp')) mediaType = 'image/webp';

          return { data: base64, mediaType };
        });

      if (validImages.length === 0) {
        return NextResponse.json(
          { success: false, error: '유효한 이미지가 없습니다' },
          { status: 400 },
        );
      }

      const result = await analyzeWithVision(
        validImages,
        '위 이미지는 온라인 쇼핑몰 상품 상세페이지의 스크린샷입니다. 이미지에서 볼 수 있는 모든 상품 정보를 구조화된 JSON으로 추출해주세요.',
      );

      return NextResponse.json({
        success: true,
        data: { ...result, sourceUrl: null, imageCount: validImages.length },
      });
    }

    // ═══════════════════════════════════════════════════════════
    // 모드 A: URL 스크래핑
    // ═══════════════════════════════════════════════════════════
    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { success: false, error: 'URL 또는 이미지가 필요합니다' },
        { status: 400 },
      );
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ success: false, error: '유효하지 않은 URL입니다' }, { status: 400 });
    }

    const allowedHosts = [
      'coupang.com', 'www.coupang.com', 'm.coupang.com',
      'smartstore.naver.com', 'shopping.naver.com', 'brand.naver.com',
      'gmarket.co.kr', 'www.gmarket.co.kr',
      '11st.co.kr', 'www.11st.co.kr',
      'shopee.com', 'shopee.co.kr',
      'domeggook.com', 'www.domeggook.com',     // 도매꾹
      'domemegg.com', 'www.domemegg.com',         // 도매매 (구 도메인)
      'dommae.com', 'www.dommae.com',             // 도매매
      'domae.me', 'www.domae.me',                 // 도매매 (대체)
    ];
    const isAllowed = allowedHosts.some((h) => parsedUrl.hostname === h || parsedUrl.hostname.endsWith(`.${h}`));
    if (!isAllowed) {
      return NextResponse.json(
        { success: false, error: '지원되는 플랫폼: 쿠팡, 네이버, G마켓, 11번가, Shopee, 도매꾹, 도매매' },
        { status: 400 },
      );
    }

    const html = await fetchPageHtml(url, parsedUrl);
    if (!html) {
      return NextResponse.json(
        { success: false, error: '페이지를 가져올 수 없습니다. 스크린샷 모드를 이용해주세요.' },
        { status: 502 },
      );
    }

    const imageUrls = extractDetailImages(html, url);

    if (imageUrls.length === 0) {
      return NextResponse.json(
        { success: false, error: '상세페이지 이미지를 찾을 수 없습니다. 스크린샷을 붙여넣어 주세요.' },
        { status: 422 },
      );
    }

    const downloadResults = await Promise.all(
      imageUrls.slice(0, 5).map((imgUrl) => fetchImageAsBase64(imgUrl)),
    );
    const validImages = downloadResults.filter(
      (r): r is { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' } => r !== null,
    );

    if (validImages.length === 0) {
      return NextResponse.json(
        { success: false, error: '이미지 다운로드에 실패했습니다. 스크린샷을 붙여넣어 주세요.' },
        { status: 422 },
      );
    }

    const result = await analyzeWithVision(
      validImages,
      `위 이미지는 "${parsedUrl.hostname}" 상품 상세페이지의 이미지입니다. 이미지에서 볼 수 있는 모든 상품 정보를 구조화된 JSON으로 추출해주세요.`,
    );

    return NextResponse.json({
      success: true,
      data: { ...result, sourceUrl: url, imageCount: validImages.length },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
