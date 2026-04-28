import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { detectRoasLow } from '@/lib/alerts/triggers';
import { buildDigestHtml, type AlertRow } from '@/lib/alerts/digest-email';

const CRON_SECRET = process.env.CRON_SECRET ?? '';
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const ALERT_EMAIL = process.env.ALERT_EMAIL ?? 'stan@aibox.it.kr';

async function sendEmail(subject: string, html: string, text: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'SmartSellerStudio <alerts@smart-seller-studio.app>',
      to: [ALERT_EMAIL],
      subject,
      html,
      text,
    }),
  });
  return res.ok;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getSourcingPool();

  // 1. ROAS 데이터 수집 (sourcing_items + ad reports placeholder)
  const { rows: roasRows } = await pool.query(
    `SELECT item_no::text AS sku_code, title, COALESCE(roas_pct, 0) AS roas_pct
     FROM sourcing_items WHERE is_tracking = true LIMIT 50`,
  ).catch(() => ({ rows: [] }));

  let created = 0;
  for (const row of roasRows) {
    const alert = detectRoasLow({
      skuCode: row.sku_code,
      productName: row.title,
      roasPct: Number(row.roas_pct),
    });
    if (alert) {
      await pool.query(
        `INSERT INTO alerts (type, severity, sku_code, message, detail) VALUES ($1, $2, $3, $4, $5)`,
        [alert.type, alert.severity, alert.skuCode, alert.message, JSON.stringify(alert.detail ?? {})],
      ).catch(() => {});
      created++;
    }
  }

  // 2. 미발송 알림 다이제스트
  const { rows: pending } = await pool.query<AlertRow>(
    `SELECT id, type, severity, sku_code AS "skuCode", message, detail, created_at AS "createdAt"
     FROM alerts WHERE emailed_at IS NULL AND created_at > now() - INTERVAL '24 hours'
     ORDER BY severity DESC, created_at DESC LIMIT 50`,
  ).catch(() => ({ rows: [] as AlertRow[] }));

  let emailed = false;
  if (pending.length > 0) {
    const digest = buildDigestHtml(pending);
    emailed = await sendEmail(digest.subject, digest.html, digest.text);
    if (emailed) {
      await pool.query(
        `UPDATE alerts SET emailed_at = now() WHERE id = ANY($1::bigint[])`,
        [pending.map((p) => p.id)],
      );
    }
  }

  return NextResponse.json({
    success: true,
    created,
    pending: pending.length,
    emailed,
  });
}
