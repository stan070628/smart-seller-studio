/**
 * POST /api/listing/url-scrape
 *
 * 상품 URL(코스트코 등 범용)을 받아 HTML을 스크랩하고,
 * 이미지 처리 + Claude Vision 분석을 거쳐 한국 이커머스 상세페이지 HTML을 생성합니다.
 *
 * 처리 흐름:
 * 1. URL 검증 및 SSRF 차단
 * 2. 브라우저 헤더로 HTML fetch
 * 3. regex 기반 제목/가격/이미지/텍스트 추출
 * 4. 이미지 다운로드 → Sharp 처리 → Supabase Storage 업로드
 * 5. Claude Vision으로 이미지 분석 → ProductImageAnalysis 생성
 * 6. buildDetailPageUserPrompt → Claude 카피 생성 → parseDetailPageResponse
 * 7. buildDetailPageHtml + buildDetailPageSnippet 반환
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { uploadToStorage } from '@/lib/supabase/server';
import { getAnthropicClient } from '@/lib/ai/claude';
import { withRetry } from '@/lib/ai/resilience';
import {
  processMainImage,
  processDetailImage,
  downloadImage,
  withConcurrencyLimit,
} from '@/lib/listing/image-processor';
import {
  buildDetailPageHtml,
  buildDetailPageSnippet,
} from '@/lib/detail-page/html-builder';
import {
  DETAIL_PAGE_SYSTEM_PROMPT,
  buildDetailPageUserPrompt,
  parseDetailPageResponse,
  type ProductImageAnalysis,
} from '@/lib/ai/prompts/detail-page';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** 스크랩할 이미지 최대 개수 */
const MAX_IMAGES = 5;

/** 이미지 최소 크기 (URL 필터링용) */
const MIN_IMAGE_SIZE_HINT = 100;

/** Claude Vision 이미지 분석 프롬프트 */
const IMAGE_VISION_PROMPT_PREFIX = `당신은 한국 이커머스 상품 분석 전문가입니다.
제공된 상품 이미지들과 웹페이지 추출 정보를 종합 분석하여 아래 JSON만 출력하세요. 코드 블록, 마크다운, 설명 텍스트 금지.

{
  "material": "string (주요 소재 및 질감, 한국어 1문장)",
  "shape": "string (형태 및 구조 설명, 한국어 1문장)",
  "colors": ["string (한국어 색상명)"],
  "keyComponents": ["string (핵심 부품 또는 디자인 포인트, 한국어, 3~5개)"]
}`;

// ─────────────────────────────────────────
// 요청 스키마
// ─────────────────────────────────────────

const RequestSchema = z.object({
  url: z
    .string()
    .url('올바른 URL 형식이어야 합니다.')
    .refine(
      (u) => u.startsWith('http://') || u.startsWith('https://'),
      'http:// 또는 https://로 시작하는 URL이어야 합니다.',
    ),
});

// ─────────────────────────────────────────
// 응답 / 에러 타입
// ─────────────────────────────────────────

interface ScrapeSuccessData {
  thumbnail: { processedUrl: string; storagePath: string };
  title: string;
  extractedPrice: number | null;
  detailHtml: string;
  snippet: string;
  naverSnippet: string;
  imageCount: number;
}

type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_INPUT'
  | 'FETCH_FAILED'
  | 'NO_IMAGES'
  | 'IMAGE_PROCESS_FAILED'
  | 'AI_FAILED'
  | 'SERVER_ERROR';

function errorResponse(code: ErrorCode, message: string, status: number) {
  return NextResponse.json({ success: false, error: message, code }, { status });
}

// ─────────────────────────────────────────
// HTML 파싱 헬퍼
// ─────────────────────────────────────────

/**
 * JSON-LD 스키마 스크립트 블록을 파싱합니다.
 */
function extractJsonLd(html: string): Record<string, unknown> | null {
  const match = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * <meta property/name="..."> content 값을 추출합니다.
 */
function extractMeta(html: string, property: string): string | null {
  const pattern1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const pattern2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i',
  );
  const m = html.match(pattern1) ?? html.match(pattern2);
  return m ? decodeHtmlEntities(m[1]) : null;
}

/**
 * <title> 태그 내용을 추출합니다.
 */
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decodeHtmlEntities(m[1].trim()) : '';
}

/**
 * HTML 엔티티를 디코딩합니다.
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * 상품 가격을 추출합니다 (메타태그, JSON-LD, 텍스트 패턴 순).
 */
function extractPrice(html: string, jsonLd: Record<string, unknown> | null): number | null {
  // JSON-LD offers.price
  if (jsonLd) {
    const offers = jsonLd['offers'] as Record<string, unknown> | undefined;
    if (offers) {
      const price = offers['price'];
      if (price !== undefined) {
        const parsed = parseInt(String(price).replace(/[^0-9]/g, ''), 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    }
  }

  // og:price:amount
  const ogPrice = extractMeta(html, 'og:price:amount') ?? extractMeta(html, 'product:price:amount');
  if (ogPrice) {
    const parsed = parseInt(ogPrice.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // 텍스트에서 가격 패턴 (₩12,000 / 12,000원)
  const priceMatch = html.match(/[₩￦][\s]*([0-9,]+)|([0-9,]+)[\s]*원/);
  if (priceMatch) {
    const raw = (priceMatch[1] ?? priceMatch[2] ?? '').replace(/,/g, '');
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  return null;
}

/**
 * HTML에서 이미지 URL을 추출하고 절대 URL로 변환합니다.
 * JSON-LD → og:image → 큰 이미지 src 순으로 수집합니다.
 */
function extractImageUrls(html: string, baseUrl: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  const base = new URL(baseUrl);

  function toAbsolute(src: string): string | null {
    if (!src || src.startsWith('data:')) return null;
    try {
      return new URL(src, base.origin).href;
    } catch {
      return null;
    }
  }

  function addUrl(src: string) {
    const abs = toAbsolute(src);
    if (!abs) return;
    // 작은 아이콘이나 픽셀 추적기 제외 (크기 힌트가 URL에 있을 경우)
    if (/[_\-x]([1-9][0-9]|[1-9])px?[_\-.]/i.test(abs)) return;
    if (!seen.has(abs)) {
      seen.add(abs);
      urls.push(abs);
    }
  }

  // 1순위: JSON-LD image
  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    const img = jsonLd['image'];
    if (typeof img === 'string') addUrl(img);
    else if (Array.isArray(img)) img.slice(0, 3).forEach((i) => typeof i === 'string' && addUrl(i));
  }

  // 2순위: og:image
  const ogImage = extractMeta(html, 'og:image');
  if (ogImage) addUrl(ogImage);

  // 3순위: <img> 태그에서 큰 이미지
  const imgTagPattern = /<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgTagPattern.exec(html)) !== null) {
    const src = m[1];
    // 최소 크기 힌트: width/height 속성이 명시된 경우 필터링
    const widthMatch = m[0].match(/width=["']?(\d+)/i);
    const heightMatch = m[0].match(/height=["']?(\d+)/i);
    if (widthMatch && parseInt(widthMatch[1], 10) < MIN_IMAGE_SIZE_HINT) continue;
    if (heightMatch && parseInt(heightMatch[1], 10) < MIN_IMAGE_SIZE_HINT) continue;
    addUrl(src);
    if (urls.length >= MAX_IMAGES * 3) break; // 후보 초과 수집 방지
  }

  return urls.slice(0, MAX_IMAGES);
}

/**
 * HTML에서 상품 스펙 테이블을 추출합니다.
 * tr/th/td → dt/dd → li 콜론 패턴 순으로 시도합니다.
 */
function extractProductSpecs(html: string): Array<{ label: string; value: string }> {
  const specs: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();

  // HTML 태그 제거 헬퍼
  function stripTags(s: string): string {
    return decodeHtmlEntities(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }

  // 패턴 1: <tr><th>...</th><td>...</td></tr>
  const trPattern = /<tr[^>]*>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trPattern.exec(html)) !== null) {
    const label = stripTags(m[1]);
    const value = stripTags(m[2]);
    if (label && value && label.length < 40 && value.length < 200 && !seen.has(label)) {
      seen.add(label);
      specs.push({ label, value });
    }
  }

  // 패턴 2: <dt>...</dt><dd>...</dd>
  const dlPattern = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  while ((m = dlPattern.exec(html)) !== null) {
    const label = stripTags(m[1]);
    const value = stripTags(m[2]);
    if (label && value && label.length < 40 && value.length < 200 && !seen.has(label)) {
      seen.add(label);
      specs.push({ label, value });
    }
  }

  // 패턴 3: "label: value" 형태의 <li> 또는 <p> (한국어 콜론 패턴)
  const liPattern = /<(?:li|p)[^>]*>([^<:]{2,20})\s*[:：]\s*([^<]{2,100})<\/(?:li|p)>/gi;
  while ((m = liPattern.exec(html)) !== null) {
    const label = stripTags(m[1]);
    const value = stripTags(m[2]);
    if (label && value && !seen.has(label)) {
      seen.add(label);
      specs.push({ label, value });
    }
  }

  return specs.slice(0, 12);
}

/**
 * HTML에서 텍스트만 추출합니다 (script/style 제거, 최대 3000자).
 */
function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000);
}

// ─────────────────────────────────────────
// Storage 경로 헬퍼
// ─────────────────────────────────────────

function thumbStoragePath(userId: string, ts: number): string {
  return `listings/${userId}/url-scraped/${ts}/thumb.jpg`;
}

function detailStoragePath(userId: string, ts: number, idx: number): string {
  const padded = String(idx).padStart(3, '0');
  return `listings/${userId}/url-scraped/${ts}/detail_${padded}.jpg`;
}

// ─────────────────────────────────────────
// Claude Vision 이미지 분석
// ─────────────────────────────────────────

/**
 * base64 이미지 목록과 웹페이지 추출 텍스트를 Claude Vision으로 분석합니다.
 */
async function analyzeImagesWithContext(
  imageBase64List: string[],
  extractedTitle: string,
  extractedText: string,
): Promise<ProductImageAnalysis> {
  const client = getAnthropicClient();

  // 웹페이지 컨텍스트를 프롬프트에 포함
  const contextText = [
    '[웹페이지 추출 정보]',
    `제품명: ${extractedTitle || '(알 수 없음)'}`,
    `설명: ${extractedText.slice(0, 1000)}`,
    '',
    '위 정보와 이미지를 함께 분석하여 JSON을 생성하세요.',
  ].join('\n');

  const prompt = `${IMAGE_VISION_PROMPT_PREFIX}\n\n${contextText}`;

  const response = await withRetry(
    () =>
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              ...imageBase64List.map((data) => ({
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/jpeg' as const,
                  data,
                },
              })),
              { type: 'text' as const, text: prompt },
            ],
          },
        ],
      }),
    { label: 'Claude analyzeImages(url-scrape)' },
  );

  const rawText = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('이미지 분석 응답에서 JSON을 찾을 수 없습니다.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('이미지 분석 응답 JSON 파싱에 실패했습니다.');
  }

  const data = parsed as Record<string, unknown>;

  if (typeof data.material !== 'string' || typeof data.shape !== 'string') {
    throw new Error('이미지 분석 결과가 예상 형식과 다릅니다.');
  }

  return {
    material: data.material,
    shape: data.shape,
    colors: Array.isArray(data.colors)
      ? (data.colors as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
    keyComponents: Array.isArray(data.keyComponents)
      ? (data.keyComponents as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
  };
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. 인증
  const auth = await requireAuth(request);
  if (auth instanceof Response) {
    return errorResponse('AUTH_REQUIRED', '로그인이 필요합니다.', 401);
  }
  const { userId } = auth;

  // 2. 입력 검증
  let url: string;
  try {
    const raw = await request.json();
    const parsed = RequestSchema.parse(raw);
    url = parsed.url;
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues[0]?.message ?? '요청 데이터가 올바르지 않습니다.'
        : '요청 데이터가 올바르지 않습니다.';
    return errorResponse('INVALID_INPUT', message, 400);
  }

  // 3. SSRF 방지: 내부 네트워크 주소 차단
  try {
    const hostname = new URL(url).hostname;
    if (
      /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)
    ) {
      return errorResponse('INVALID_INPUT', '내부 네트워크 주소는 사용할 수 없습니다.', 400);
    }
  } catch {
    return errorResponse('INVALID_INPUT', 'URL 파싱에 실패했습니다.', 400);
  }

  // 4. HTML 스크랩
  let html: string;
  try {
    const fetchResponse = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!fetchResponse.ok) {
      console.warn(`[url-scrape] HTTP ${fetchResponse.status} from ${url}`);
      return errorResponse(
        'FETCH_FAILED',
        `페이지를 불러올 수 없습니다. (HTTP ${fetchResponse.status})`,
        502,
      );
    }

    html = await fetchResponse.text();
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === 'TimeoutError' || err.message.includes('timeout'));
    console.error('[url-scrape] fetch 실패:', err);
    return errorResponse(
      'FETCH_FAILED',
      isTimeout ? '페이지 요청이 시간 초과되었습니다.' : '페이지를 불러오는 중 오류가 발생했습니다.',
      502,
    );
  }

  // 5. HTML에서 정보 추출
  const jsonLd = extractJsonLd(html);
  const extractedTitle =
    extractMeta(html, 'og:title') ??
    (jsonLd?.['name'] as string | undefined) ??
    extractTitle(html);
  const extractedPrice = extractPrice(html, jsonLd);
  const extractedText = extractText(html);
  const imageUrls = extractImageUrls(html, url);

  console.info(
    `[url-scrape] 추출 결과 — 제목: "${extractedTitle}", 가격: ${extractedPrice}, 이미지: ${imageUrls.length}개`,
  );

  if (imageUrls.length === 0) {
    return errorResponse('NO_IMAGES', '페이지에서 처리할 수 있는 이미지를 찾을 수 없습니다.', 422);
  }

  // 6. 이미지 다운로드 + Sharp 처리 + Storage 업로드
  const ts = Date.now();

  interface ProcessedImage {
    index: number;
    buffer: Buffer;
    publicUrl: string;
    storagePath: string;
  }

  const tasks = imageUrls.map((imgUrl, idx) => async (): Promise<ProcessedImage> => {
    // 다운로드
    const rawBuffer = await downloadImage(imgUrl);

    // Sharp 처리
    const processed =
      idx === 0
        ? await processMainImage(rawBuffer, null)
        : await processDetailImage(rawBuffer);

    // Storage 업로드
    const storagePath =
      idx === 0 ? thumbStoragePath(userId, ts) : detailStoragePath(userId, ts, idx);

    const uploadResult = await uploadToStorage(
      storagePath,
      processed.buffer as ArrayBuffer,
      'image/jpeg',
      processed.length,
    );

    return { index: idx, buffer: processed, publicUrl: uploadResult.url, storagePath };
  });

  const results = await withConcurrencyLimit(tasks, 4);

  // 성공한 이미지만 수집 (실패 시 해당 이미지만 skip)
  const processedImages: ProcessedImage[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      processedImages.push(r.value);
    } else {
      console.warn(`[url-scrape] 이미지 처리 실패 [${imageUrls[i]}]:`, r.reason);
    }
  }

  if (processedImages.length === 0) {
    return errorResponse('IMAGE_PROCESS_FAILED', '모든 이미지 처리에 실패했습니다.', 422);
  }

  // 썸네일 (index=0 이미지, 없으면 첫 번째 성공 이미지)
  const thumbImage =
    processedImages.find((img) => img.index === 0) ?? processedImages[0];

  // 7. Claude Vision 이미지 분석
  // base64 변환 (업로드된 이미지 버퍼 재사용)
  const imageBase64List = processedImages
    .sort((a, b) => a.index - b.index)
    .map((img) => img.buffer.toString('base64'));

  let imageAnalysis: ProductImageAnalysis;
  try {
    imageAnalysis = await analyzeImagesWithContext(
      imageBase64List,
      extractedTitle,
      extractedText,
    );
  } catch (err) {
    console.error('[url-scrape] Claude Vision 분석 실패:', err);
    return errorResponse(
      'AI_FAILED',
      err instanceof Error ? `이미지 분석 실패: ${err.message}` : '이미지 분석 중 오류가 발생했습니다.',
      502,
    );
  }

  // 8. DetailPageContent 생성 (카피라이팅)
  const client = getAnthropicClient();
  const rawSpecs = extractProductSpecs(html);

  // A/S 책임자·전화번호·소비자상담 관련 항목은 항상 하드코딩 값으로 교체
  const AS_OVERRIDE_LABELS = /A\/S|애프터서비스|서비스\s*책임자|소비자\s*상담|고객\s*센터|전화\s*번호|연락처/i;
  const filteredSpecs = rawSpecs.filter(({ label }) => !AS_OVERRIDE_LABELS.test(label));
  filteredSpecs.push(
    { label: 'A/S 책임자', value: '청연코퍼레이션' },
    { label: 'A/S 전화번호', value: '010-5169-2357' },
  );
  const extractedSpecs = filteredSpecs;
  const userMessage = buildDetailPageUserPrompt(
    imageAnalysis,
    extractedTitle || undefined,
    extractedSpecs.length > 0 ? extractedSpecs : undefined,
  );

  let rawCopyText: string;
  try {
    const copyResponse = await withRetry(
      () =>
        client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: DETAIL_PAGE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
      { label: 'Claude generateDetailPageContent(url-scrape)' },
    );

    rawCopyText = copyResponse.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
  } catch (err) {
    console.error('[url-scrape] 카피 생성 실패:', err);

    if (err instanceof Error && err.message.includes('overloaded')) {
      return errorResponse(
        'AI_FAILED',
        'AI 서비스가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해 주세요.',
        502,
      );
    }

    return errorResponse(
      'AI_FAILED',
      err instanceof Error ? `카피 생성 실패: ${err.message}` : '카피 생성 중 오류가 발생했습니다.',
      502,
    );
  }

  // 9. 응답 파싱
  let content;
  try {
    content = parseDetailPageResponse(rawCopyText);
  } catch (err) {
    console.error('[url-scrape] 카피 파싱 실패:', err);
    return errorResponse(
      'AI_FAILED',
      err instanceof Error ? `AI 응답 파싱 실패: ${err.message}` : 'AI 응답 파싱 중 오류가 발생했습니다.',
      502,
    );
  }

  // 10. HTML 빌드 (publicUrl 사용, base64 미사용)
  const imageInputs = processedImages
    .sort((a, b) => a.index - b.index)
    .map((img) => ({
      imageBase64: '',          // publicUrl이 있으면 html-builder가 이것을 우선 사용
      mimeType: 'image/jpeg',
      publicUrl: img.publicUrl,
    }));

  let detailHtml: string;
  let snippet: string;
  let naverSnippet: string;
  const specArg = extractedSpecs.length > 0 ? extractedSpecs : undefined;
  try {
    detailHtml = buildDetailPageHtml(content, imageInputs, specArg);
    snippet = buildDetailPageSnippet(content, imageInputs, specArg, 780);      // 쿠팡용
    naverSnippet = buildDetailPageSnippet(content, imageInputs, specArg, 860); // 네이버용
  } catch (err) {
    console.error('[url-scrape] HTML 빌드 실패:', err);
    return errorResponse(
      'SERVER_ERROR',
      err instanceof Error ? `HTML 생성 실패: ${err.message}` : 'HTML 생성 중 오류가 발생했습니다.',
      500,
    );
  }

  // 11. 응답
  const responseData: ScrapeSuccessData = {
    thumbnail: {
      processedUrl: thumbImage.publicUrl,
      storagePath: thumbImage.storagePath,
    },
    title: extractedTitle,
    extractedPrice,
    detailHtml,
    snippet,
    naverSnippet,
    imageCount: processedImages.length,
  };

  return NextResponse.json({ success: true, data: responseData });
}
