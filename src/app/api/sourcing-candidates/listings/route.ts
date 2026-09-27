import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { buildListingView } from '@/lib/sourcing-candidates/view';
import type { ListingRow, OfferRow } from '@/lib/sourcing-candidates/types';

/**
 * GET /api/sourcing-candidates/listings?scan=<id>  — 한 스캔의 전체 상품
 * GET /api/sourcing-candidates/listings?starred=1  — 모든 스캔의 ⭐ 후보 (카드·제출 목록)
 * 판정은 buildListingView가 여기서 계산한다.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const scan = sp.get('scan');
  const starred = sp.get('starred') === '1';
  if (!scan && !starred) {
    return NextResponse.json({ success: false, error: 'scan 또는 starred=1이 필요합니다.' }, { status: 400 });
  }

  try {
    const pool = getSourcingPool();
    const { rows: listings } = await pool.query(
      `SELECT l.*, s.category_path
       FROM sourcing_listings l JOIN sourcing_scans s ON s.id = l.scan_id
       WHERE l.user_id = $1 AND ${scan ? 'l.scan_id = $2' : 'l.starred'}
       -- updated_at으로 정렬하면 블러 저장(메모 등)마다 순서가 바뀐다 — 고정된 키로 정렬한다
       ORDER BY ${scan ? 'l.rank' : 's.created_at DESC, l.rank'}`,
      scan ? [user.userId, scan] : [user.userId],
    );
    if (listings.length === 0) return NextResponse.json({ success: true, data: [] });

    const { rows: offers } = await pool.query(
      `SELECT * FROM sourcing_offers WHERE listing_id = ANY($1) ORDER BY created_at`,
      [listings.map((l) => l.id)],
    );
    const byListing = new Map<string, OfferRow[]>();
    for (const o of offers as OfferRow[]) {
      const cny = o.cny_override === null ? null : Number(o.cny_override); // numeric → string으로 온다
      byListing.set(o.listing_id, [...(byListing.get(o.listing_id) ?? []), { ...o, cny_override: cny }]);
    }

    const data = (listings as ListingRow[]).map((l) =>
      buildListingView({
        ...l,
        rating: l.rating === null ? null : Number(l.rating),
        recent6m_rating: l.recent6m_rating === null ? null : Number(l.recent6m_rating), // numeric → string으로 온다
      }, byListing.get(l.id) ?? []),
    );
    return NextResponse.json({ success: true, data });
  } catch (err) {
    if ((err as { code?: string }).code === '22P02') {
      return NextResponse.json({ success: false, error: '잘못된 id입니다.' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 });
  }
}
