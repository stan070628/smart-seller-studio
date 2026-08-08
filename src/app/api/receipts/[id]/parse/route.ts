import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';
import { extractReceipt } from '@/lib/receipt/extract';
import { verifyReceipt } from '@/lib/receipt/verify';
import { attributeDiscounts } from '@/lib/receipt/discount';
import { applyMappings, type ItemMapRow } from '@/lib/receipt/mapping';
import type { AllowedMimeType } from '@/lib/ai/claude-vision';

function mimeOf(path: string): AllowedMimeType {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * POST /api/receipts/[id]/parse — 업로드된 영수증을 판독한다.
 *
 * 추출 → 검산 4종 → 할인 귀속 → 매핑 자동채움 → 줄 저장.
 * 실패해도 초안과 이미지는 남긴다. 재시도할 수 있어야 하기 때문이다.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  const { rows: drafts } = await pool.query(
    `SELECT id, image_paths, ocr_status FROM receipt_drafts WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (drafts.length === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const draft = drafts[0];

  // 이미 판독된 초안을 다시 판독하면 줄이 중복된다
  if (draft.ocr_status === 'parsed') {
    return NextResponse.json(
      { success: false, error: '이미 판독된 영수증입니다.' },
      { status: 409 },
    );
  }

  // 1) 이미지 내려받기
  const supabase = getSupabaseServerClient();
  const images: { data: Buffer; mimeType: AllowedMimeType }[] = [];
  for (const path of draft.image_paths as string[]) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
    if (error || !data) {
      return NextResponse.json(
        { success: false, error: `이미지를 읽지 못했습니다: ${path}` },
        { status: 500 },
      );
    }
    images.push({ data: Buffer.from(await data.arrayBuffer()), mimeType: mimeOf(path) });
  }

  // 2) 추출 — 실패하면 상태만 failed로 남기고 초안은 보존한다
  let extracted;
  try {
    extracted = await extractReceipt({ images });
  } catch (err) {
    await pool.query(
      `UPDATE receipt_drafts SET ocr_status = 'failed', updated_at = now() WHERE id = $1`,
      [id],
    );
    const msg = err instanceof Error ? err.message : '판독 실패';
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }

  // 3) 검산 → 4) 할인 귀속 → 5) 매핑 자동채움
  const verify = verifyReceipt(extracted);
  const attributed = attributeDiscounts(extracted.lines);

  const codes = attributed.map((l) => l.item_code).filter((c): c is string => c != null);
  const { rows: maps } = codes.length
    ? await pool.query(
        `SELECT item_code, product_cost_id, default_decision, default_entry_type,
                items_per_box, subdivision_unit
         FROM costco_item_map WHERE user_id = $1 AND item_code = ANY($2)`,
        [user.userId, codes],
      )
    : { rows: [] };

  const draftLines = applyMappings(attributed, maps as ItemMapRow[]);

  // 6) 저장 — 헤더와 줄을 한 트랜잭션으로
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE receipt_drafts SET
         purchased_at = $2, purchased_time = $3, register_no = $4, store_name = $5,
         receipt_total = $6, total_item_count = $7,
         tax_exempt_total = $8, taxable_total = $9, vat = $10,
         verify_status = $11, verify_detail = $12,
         ocr_status = 'parsed', raw_ocr = $13, updated_at = now()
       WHERE id = $1`,
      [
        id, extracted.purchased_at, extracted.purchased_time, extracted.register_no,
        extracted.store_name, extracted.receipt_total, extracted.total_item_count,
        extracted.tax_exempt_total, extracted.taxable_total, extracted.vat,
        verify.status, JSON.stringify(verify), JSON.stringify(extracted),
      ],
    );

    // line_no → uuid 매핑을 만들며 순서대로 넣는다
    const idByLineNo = new Map<number, string>();
    for (const row of draftLines) {
      const { rows: inserted } = await client.query(
        `INSERT INTO receipt_draft_lines
           (draft_id, line_no, item_code, item_label, quantity, unit_price, amount,
            is_discount, tax_type, decision, product_cost_id, entry_type,
            items_per_box, subdivision_unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          id, row.line_no, row.item_code, row.item_label, row.quantity, row.unit_price,
          row.amount, row.is_discount, row.tax_type, row.decision, row.product_cost_id,
          row.entry_type, row.items_per_box, row.subdivision_unit,
        ],
      );
      idByLineNo.set(row.line_no, inserted[0].id);
    }

    // 할인 귀속은 uuid가 다 생긴 뒤에 건다 — 자기참조라 순서가 필요하다
    for (const row of draftLines) {
      if (row.applies_to_line_no == null) continue;
      const targetId = idByLineNo.get(row.applies_to_line_no);
      if (!targetId) continue;
      await client.query(
        `UPDATE receipt_draft_lines SET applies_to_line_id = $1 WHERE draft_id = $2 AND line_no = $3`,
        [targetId, id, row.line_no],
      );
    }

    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }

  return NextResponse.json({
    success: true,
    data: { id, verify_status: verify.status, verify, line_count: draftLines.length },
  });
}
