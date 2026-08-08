import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';
import { extractReceipt } from '@/lib/receipt/extract';
import { verifyReceipt } from '@/lib/receipt/verify';
import { attributeDiscounts } from '@/lib/receipt/discount';
import { applyMappings, type ItemMapRow } from '@/lib/receipt/mapping';
import type { AllowedMimeType } from '@/lib/ai/claude-vision';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

/**
 * 판독 1회가 12~14초. 3건이면 최대 42초라 60초 안에 들어간다.
 * 기존 라우트들도 같은 방식으로 선언한다 (예: image/composite = 60)
 */
export const maxDuration = 60;

/** 한 회차에 처리할 상한. maxDuration 60초에서 역산했다 */
const MAX_PER_RUN = 3;
/** 죽은 실행이 묶어둔 초안을 회수하는 기준 */
const STUCK_MINUTES = 10;
/** 흐릿한 사진 하나가 무한히 돈을 태우지 않게 한다 */
const MAX_ATTEMPTS = 3;

function mimeOf(path: string): AllowedMimeType {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * GET /api/cron/parse-receipts
 *
 * pending 초안을 주워 판독한다. 매장에서 찍고 앱을 닫아도 처리되게 하는 장치다.
 *
 * 동시 실행 방어: UPDATE ... FOR UPDATE SKIP LOCKED로 원자적으로 집는다.
 * 두 번째 실행은 이미 잠긴 행을 건너뛰므로 같은 초안을 두 번 판독하지 않는다.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getSourcingPool();
  const results: { id: string; status: string; detail?: string }[] = [];

  for (let i = 0; i < MAX_PER_RUN; i++) {
    // 원자적 claim — pending이거나, parsing인데 오래 묶여 있는 것을 집는다
    const { rows: claimed } = await pool.query(
      `UPDATE receipt_drafts SET
         ocr_status = 'parsing',
         parse_attempts = parse_attempts + 1,
         parse_started_at = now(),
         updated_at = now()
       WHERE id = (
         SELECT id FROM receipt_drafts
         WHERE (
           ocr_status = 'pending'
           OR (ocr_status = 'parsing' AND parse_started_at < now() - ($1 || ' minutes')::interval)
         )
         AND parse_attempts < $2
         AND status = 'draft'
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, user_id, image_paths, parse_attempts`,
      [String(STUCK_MINUTES), MAX_ATTEMPTS],
    );

    if (claimed.length === 0) break;
    const draft = claimed[0];

    try {
      const imagePaths = (draft.image_paths ?? []) as string[];
      if (imagePaths.length === 0) throw new Error('이미지가 없습니다.');

      const supabase = getSupabaseServerClient();
      const images: { data: Buffer; mimeType: AllowedMimeType }[] = [];
      for (const path of imagePaths) {
        const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
        if (error || !data) throw new Error(`이미지를 읽지 못했습니다: ${path}`);
        images.push({ data: Buffer.from(await data.arrayBuffer()), mimeType: mimeOf(path) });
      }

      const extracted = await extractReceipt({ images });
      const verify = verifyReceipt(extracted);
      const attributed = attributeDiscounts(extracted.lines);

      const codes = attributed.map((l) => l.item_code).filter((c): c is string => c != null);
      const { rows: maps } = codes.length
        ? await pool.query(
            `SELECT item_code, product_cost_id, default_decision, default_entry_type,
                    items_per_box, subdivision_unit
             FROM costco_item_map WHERE user_id = $1 AND item_code = ANY($2)`,
            [draft.user_id, codes],
          )
        : { rows: [] };
      const draftLines = applyMappings(attributed, maps as ItemMapRow[]);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // 회수된 초안일 수 있으므로 기존 줄을 지우고 다시 넣는다
        await client.query(`DELETE FROM receipt_draft_lines WHERE draft_id = $1`, [draft.id]);
        await client.query(
          `UPDATE receipt_drafts SET
             purchased_at=$2, purchased_time=$3, register_no=$4, store_name=$5,
             receipt_total=$6, total_item_count=$7,
             tax_exempt_total=$8, taxable_total=$9, vat=$10,
             verify_status=$11, verify_detail=$12, ocr_status='parsed', raw_ocr=$13, updated_at=now()
           WHERE id=$1`,
          [draft.id, extracted.purchased_at, extracted.purchased_time, extracted.register_no,
           extracted.store_name, extracted.receipt_total, extracted.total_item_count,
           extracted.tax_exempt_total, extracted.taxable_total, extracted.vat,
           verify.status, JSON.stringify(verify), JSON.stringify(extracted)],
        );
        const idByLineNo = new Map<number, string>();
        for (const row of draftLines) {
          const { rows } = await client.query(
            `INSERT INTO receipt_draft_lines
               (draft_id,line_no,item_code,item_label,quantity,unit_price,amount,
                is_discount,tax_type,decision,product_cost_id,entry_type,items_per_box,subdivision_unit)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
            [draft.id, row.line_no, row.item_code, row.item_label, row.quantity, row.unit_price,
             row.amount, row.is_discount, row.tax_type, row.decision, row.product_cost_id,
             row.entry_type, row.items_per_box, row.subdivision_unit],
          );
          idByLineNo.set(row.line_no, rows[0].id);
        }
        for (const row of draftLines) {
          if (row.applies_to_line_no == null) continue;
          const targetId = idByLineNo.get(row.applies_to_line_no);
          if (!targetId) continue;
          await client.query(
            `UPDATE receipt_draft_lines SET applies_to_line_id=$1 WHERE draft_id=$2 AND line_no=$3`,
            [targetId, draft.id, row.line_no],
          );
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      results.push({ id: draft.id, status: verify.status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '판독 실패';
      // 시도 상한에 닿으면 failed로 못 박는다. 아니면 pending으로 되돌려 다음 회차를 노린다
      const next = draft.parse_attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      await pool.query(
        `UPDATE receipt_drafts SET ocr_status = $2, updated_at = now() WHERE id = $1`,
        [draft.id, next],
      );
      results.push({ id: draft.id, status: next, detail: msg });
    }
  }

  return NextResponse.json({ success: true, data: { processed: results.length, results } });
}
