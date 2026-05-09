// src/app/api/cost-management/shipping-groups/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { distributeShippingFee } from '@/lib/cost-management/calculations';

// ─────────────────────────────────────────
// POST /api/cost-management/shipping-groups
// 배송비 그룹을 생성하고 지정된 입고 건들에 배송비를 수량 비례로 배분한다.
// 그룹 생성 + 다수 entries 업데이트가 하나의 트랜잭션으로 처리된다.
// ─────────────────────────────────────────
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { name, total_shipping_fee, entry_ids } = body ?? {};

  // total_shipping_fee: 0 이상의 정수 필수
  if (typeof total_shipping_fee !== 'number' || !Number.isInteger(total_shipping_fee) || total_shipping_fee < 0) {
    return NextResponse.json(
      { success: false, error: 'total_shipping_fee must be a non-negative integer' },
      { status: 400 },
    );
  }
  // entry_ids: 비어있지 않은 배열 필수
  if (!Array.isArray(entry_ids) || entry_ids.length === 0) {
    return NextResponse.json(
      { success: false, error: 'entry_ids must be a non-empty array' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  // 트랜잭션: 그룹 INSERT + 다수 entries UPDATE를 원자적으로 처리
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 배송비 그룹 생성
    const { rows: groupRows } = await client.query(
      `INSERT INTO shipping_groups (user_id, name, total_shipping_fee) VALUES ($1, $2, $3) RETURNING id`,
      [user.userId, name ?? null, total_shipping_fee],
    );
    const groupId: string = groupRows[0].id;

    // 현재 유저 소유의 유효한 입고 건만 조회 (타 유저 항목 필터링)
    const { rows: entries } = await client.query(
      `SELECT id, quantity FROM cost_entries WHERE id = ANY($1::uuid[]) AND user_id = $2`,
      [entry_ids, user.userId],
    );

    if (entries.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'No valid entries found' }, { status: 400 });
    }

    // 수량 비례로 배송비 배분 계산 (반올림 오차는 첫 항목 흡수)
    const distribution = distributeShippingFee(
      entries.map((e) => ({ id: e.id, quantity: Number(e.quantity) })),
      total_shipping_fee,
    );

    // 각 입고 건에 배분된 배송비와 그룹 ID를 반영
    for (const [entryId, fee] of distribution) {
      await client.query(
        `UPDATE cost_entries SET unit_shipping_fee = $1, shipping_group_id = $2 WHERE id = $3`,
        [fee, groupId, entryId],
      );
    }

    await client.query('COMMIT');

    return NextResponse.json(
      { success: true, data: { group_id: groupId, distributed: Object.fromEntries(distribution) } },
      { status: 201 },
    );
  } catch (err) {
    await client.query('ROLLBACK');
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    // 트랜잭션 성공/실패 여부와 관계없이 반드시 커넥션 반환
    client.release();
  }
}
