import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';
import { draftBadge, draftProgress, type ProgressLine } from '@/lib/receipt/view';
import { netAmountOf, type AttributedLine } from '@/lib/receipt/discount';

/**
 * 저장 경로를 공개 URL로 바꾼다.
 *
 * `uploadToStorage`가 업로드 직후 쓰는 것과 같은 SDK 호출이다.
 * 조회 시점에는 업로드가 없으므로 URL 변환만 따로 한다.
 */
function publicUrls(paths: string[]): string[] {
  const supabase = getSupabaseServerClient();
  return paths.map(
    (p) => supabase.storage.from(STORAGE_BUCKET).getPublicUrl(p).data.publicUrl,
  );
}

/**
 * GET /api/receipts/[id] — 초안 상세
 *
 * 각 줄에 **할인 반영 금액**(`net_amount`)을 얹어 내려보낸다.
 * 화면에서 다시 계산하면 확정 경로와 값이 갈릴 수 있다 — 원가가
 * 어느 경로로 계산됐는지에 따라 달라지는 것이 이 기능의 최대 위험이다.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    const pool = getSourcingPool();

    const { rows: drafts } = await pool.query(
      `SELECT id, image_paths, purchased_at, purchased_time, store_name, register_no,
              receipt_total, total_item_count, tax_exempt_total, taxable_total, vat,
              verify_status, verify_detail, ocr_status, status, parse_attempts, created_at,
              images_purged_at
       FROM receipt_drafts WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (drafts.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    const draft = drafts[0];

    // `remembered_decision`은 이 품번에 저장된 기본값이다.
    // 화면이 「항상 제외」 토글의 현재 상태를 그리려면 필요하다.
    const { rows } = await pool.query(
      `SELECT l.id, l.line_no, l.item_code, l.item_label, l.quantity, l.unit_price, l.amount,
              l.is_discount, l.applies_to_line_id, l.tax_type, l.decision, l.product_cost_id,
              l.entry_type, l.items_per_box, l.subdivision_unit, l.cost_entry_id,
              m.default_decision AS remembered_decision
       FROM receipt_draft_lines l
       LEFT JOIN costco_item_map m
         ON m.item_code = l.item_code AND m.user_id = $2
       WHERE l.draft_id = $1 ORDER BY l.line_no`,
      [id, user.userId],
    );

    // 할인 귀속을 line_no로 되돌린다 — netAmountOf가 그 형태를 쓴다
    const lineNoById = new Map<string, number>(rows.map((l) => [l.id, l.line_no]));
    const attributed: AttributedLine[] = rows.map((l) => ({
      line_no: l.line_no,
      item_code: l.item_code,
      item_label: l.item_label,
      quantity: Number(l.quantity),
      unit_price: l.unit_price,
      amount: l.amount,
      is_discount: l.is_discount,
      tax_type: l.tax_type,
      applies_to_line_no: l.applies_to_line_id ? (lineNoById.get(l.applies_to_line_id) ?? null) : null,
    }));

    const lines = rows.map((l) => ({
      ...l,
      quantity: Number(l.quantity),
      applies_to_line_no: l.applies_to_line_id ? (lineNoById.get(l.applies_to_line_id) ?? null) : null,
      net_amount: l.is_discount ? l.amount : netAmountOf(attributed, l.line_no),
    }));

    return NextResponse.json({
      success: true,
      data: {
        ...draft,
        image_urls: publicUrls(draft.image_paths ?? []),
        image_paths: undefined,
        badge: draftBadge(draft),
        progress: draftProgress(rows as ProgressLine[]),
        lines,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/receipts/[id] — 초안 폐기
 *
 * 행을 지우지 않고 `status='discarded'`로 둔다. 이미 확정된 줄이 있으면
 * 그 `cost_entries`가 근거를 잃기 때문이다.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    const pool = getSourcingPool();
    const { rowCount } = await pool.query(
      `UPDATE receipt_drafts SET status = 'discarded', updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'draft'`,
      [id, user.userId],
    );
    if (rowCount === 0) {
      return NextResponse.json(
        { success: false, error: '폐기할 수 있는 초안이 아닙니다.' }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
