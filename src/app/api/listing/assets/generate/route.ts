/**
 * POST /api/listing/assets/generate
 *
 * URL(도매꾹·코스트코) 또는 업로드 이미지를 받아
 * 썸네일 목록과 상세 HTML을 반환한다.
 *
 * 요청 body (discriminatedUnion):
 *   - mode: 'url'    → { url: string }
 *   - mode: 'upload' → { images: string[], text?: string }
 *
 * 응답:
 *   { success: true, data: { thumbnails: string[], detailHtml: string, detailImage: null } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { parseSourceUrl } from '@/lib/auto-register/url-parser';
import { fetchCostcoProduct } from '@/lib/sourcing/costco-client';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';

// ─────────────────────────────────────────────────────────────────────────────
// 요청 스키마
// ─────────────────────────────────────────────────────────────────────────────

const RequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('url'),
    url: z.string().url({ message: '유효한 URL 형식이어야 합니다.' }),
  }),
  z.object({
    mode: z.literal('upload'),
    images: z.array(z.string()).min(1, { message: '이미지가 최소 1개 이상 필요합니다.' }),
    text: z.string().optional(),
  }),
]);

// ─────────────────────────────────────────────────────────────────────────────
// POST 핸들러
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 인증 검증
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  // 요청 body 파싱 및 검증
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '요청 body를 파싱할 수 없습니다.' },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.message },
      { status: 400 },
    );
  }

  try {
    // ── URL 모드 ──────────────────────────────────────────────────────────────
    if (parsed.data.mode === 'url') {
      const { url } = parsed.data;

      // parseSourceUrl은 { source, itemId } 만 반환 (null이면 지원 불가 URL)
      const sourceResult = parseSourceUrl(url);
      if (!sourceResult) {
        return NextResponse.json(
          { success: false, error: '지원하지 않는 URL입니다. (도매꾹·코스트코만 지원)' },
          { status: 422 },
        );
      }

      let thumbnails: string[] = [];
      let detailHtml = '';

      if (sourceResult.source === 'costco') {
        // ── 코스트코 상품 조회 ─────────────────────────────────────────────
        const product = await fetchCostcoProduct(sourceResult.itemId);
        if (!product) {
          return NextResponse.json(
            { success: false, error: '코스트코 상품을 찾을 수 없습니다.' },
            { status: 404 },
          );
        }

        // imageUrl과 galleryImages 모두 optional이므로 방어적으로 처리
        thumbnails = [
          product.imageUrl,
          ...(product.galleryImages ?? []),
        ].filter((u): u is string => Boolean(u));

        detailHtml = product.description ?? '';
      } else if (sourceResult.source === 'domeggook') {
        // ── 도매꾹 상품 조회 ───────────────────────────────────────────────
        const itemNo = parseInt(sourceResult.itemId, 10);
        if (Number.isNaN(itemNo)) {
          return NextResponse.json(
            { success: false, error: '유효하지 않은 도매꾹 상품 번호입니다.' },
            { status: 422 },
          );
        }

        const client = getDomeggookClient();
        const itemDetail = await client.getItemView(itemNo);

        // getItemView는 basis 없으면 내부에서 throw하지만, 방어적으로 체크
        if (!itemDetail?.basis) {
          return NextResponse.json(
            { success: false, error: '도매꾹 상품을 찾을 수 없습니다.' },
            { status: 404 },
          );
        }

        // 대표 이미지: original → large → small 순서로 우선 선택
        const coverUrl =
          itemDetail.thumb?.original ??
          itemDetail.thumb?.large ??
          itemDetail.thumb?.small;

        if (coverUrl) thumbnails = [coverUrl];

        detailHtml = itemDetail.desc?.contents?.item ?? '';
      } else {
        // ParsedUrl.source가 향후 확장될 경우를 대비한 exhaustive guard
        return NextResponse.json(
          { success: false, error: '지원하지 않는 소스 타입입니다.' },
          { status: 422 },
        );
      }

      return NextResponse.json({
        success: true,
        data: { thumbnails, detailHtml, detailImage: null },
      });
    }

    // ── 업로드 모드 ───────────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      data: {
        thumbnails: parsed.data.images,
        detailHtml: parsed.data.text ? `<div>${parsed.data.text}</div>` : '',
        detailImage: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
