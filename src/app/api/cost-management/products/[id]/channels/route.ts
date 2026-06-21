import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

const VALID_CHANNEL_TYPES = ['coupang_rg', 'coupang_wing', 'naver'] as const;
type ChannelType = typeof VALID_CHANNEL_TYPES[number];

// GET: 해당 product의 채널 목록 반환
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  const { rows } = await pool.query(
    `SELECT id, channel_type, external_id, unit_multiplier, created_at
     FROM product_cost_channels
     WHERE product_cost_id = $1 AND user_id = $2
     ORDER BY created_at ASC`,
    [id, user.userId],
  );

  return NextResponse.json({ success: true, data: rows });
}

// POST: 새 채널 항목 추가
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { channel_type, external_id, unit_multiplier = 1 } = body ?? {};

  if (!VALID_CHANNEL_TYPES.includes(channel_type as ChannelType)) {
    return NextResponse.json(
      { success: false, error: `channel_type must be one of: ${VALID_CHANNEL_TYPES.join(', ')}` },
      { status: 400 },
    );
  }
  if (!Number.isInteger(external_id) || external_id <= 0) {
    return NextResponse.json(
      { success: false, error: 'external_id must be a positive integer' },
      { status: 400 },
    );
  }
  if (!Number.isInteger(unit_multiplier) || unit_multiplier < 1) {
    return NextResponse.json(
      { success: false, error: 'unit_multiplier must be a positive integer >= 1' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  try {
    // product가 해당 user 소유인지 확인
    const { rows: owned } = await pool.query(
      `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (owned.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const { rows } = await pool.query(
      `INSERT INTO product_cost_channels (user_id, product_cost_id, channel_type, external_id, unit_multiplier)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, channel_type, external_id) DO UPDATE
         SET product_cost_id = EXCLUDED.product_cost_id,
             unit_multiplier = EXCLUDED.unit_multiplier
       RETURNING id, channel_type, external_id, unit_multiplier, created_at`,
      [user.userId, id, channel_type, external_id, unit_multiplier],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
