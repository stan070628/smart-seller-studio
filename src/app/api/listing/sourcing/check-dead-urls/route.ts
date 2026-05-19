import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { checkUrl } from '@/lib/listing/url-health-check';

interface SourcingRow {
  platform: string;
  product_id: string;
  product_name: string | null;
  sourcing_value: string;
}

async function sendDeadUrlEmail(deadRows: Array<{ row: SourcingRow; httpStatus: number }>) {
  // 호출 시점에 환경변수를 읽어 테스트에서 vi.stubEnv가 적용되도록 함
  const resendApiKey = process.env.RESEND_API_KEY ?? '';
  const alertEmail = process.env.ALERT_EMAIL ?? 'stan@aibox.it.kr';
  if (!resendApiKey) return false;
  const date = new Date().toISOString().slice(0, 10);
  const items = deadRows
    .map((d) => {
      const name = d.row.product_name ?? d.row.sourcing_value;
      return `<li style="margin:6px 0"><b>${name}</b> (${d.row.platform}) — HTTP ${d.httpStatus}<br>
        <a href="${d.row.sourcing_value}" style="color:#6b7280;font-size:12px">${d.row.sourcing_value}</a></li>`;
    })
    .join('');
  const html = `
    <html><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="border-bottom:2px solid #DC2626;padding-bottom:8px">소싱 URL ${deadRows.length}건 접근 불가 — ${date}</h2>
      <p style="color:#6B7280">아래 상품의 소싱 출처 URL이 삭제되었거나 접근 불가 상태입니다.<br>온라인몰에서 해당 상품을 내리는 것을 검토하세요.</p>
      <ul style="padding-left:20px">${items}</ul>
      <p style="margin-top:30px;color:#9CA3AF;font-size:12px">SmartSellerStudio 자동 알림</p>
    </body></html>`;
  const text = deadRows
    .map((d) => `[${d.row.platform}] ${d.row.product_name ?? d.row.sourcing_value} — ${d.row.sourcing_value}`)
    .join('\n');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'SmartSellerStudio <alerts@smart-seller-studio.app>',
      to: [alertEmail],
      subject: `소싱 URL ${deadRows.length}건 접근 불가 — ${date}`,
      html,
      text,
    }),
  });
  return res.ok;
}

async function batchProcess<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.all(batch.map(fn));
    results.push(...settled);
  }
  return results;
}

export async function GET(request: NextRequest) {
  // 호출 시점에 환경변수를 읽어 테스트에서 vi.stubEnv가 적용되도록 함
  const cronSecret = process.env.CRON_SECRET ?? '';

  // CRON_SECRET 미설정 시 서버 설정 오류
  if (!cronSecret) {
    return NextResponse.json({ success: false, error: 'CRON_SECRET 미설정' }, { status: 500 });
  }

  // Bearer 토큰 검증
  const auth = request.headers.get('authorization') ?? '';
  if (auth.replace('Bearer ', '') !== cronSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getSourcingPool();

  // 온라인 소싱 레코드 전체 조회
  const { rows } = await pool.query<SourcingRow>(
    `SELECT platform, product_id, product_name, sourcing_value
     FROM product_sourcing
     WHERE sourcing_type = 'online'`,
  );

  if (rows.length === 0) {
    return NextResponse.json({ success: true, checked: 0, dead: 0, emailed: false });
  }

  const deadRows: Array<{ row: SourcingRow; httpStatus: number }> = [];

  // 동시성 5로 URL 헬스체크 배치 처리
  await batchProcess(rows, 5, async (row) => {
    const result = await checkUrl(row.sourcing_value);

    // alive / skip은 무시
    if (result.status !== 'dead') return;

    // 24시간 내 중복 알림 방지
    const { rows: existing } = await pool.query(
      `SELECT id FROM alerts
       WHERE type = 'sourcing_url_dead' AND sku_code = $1
         AND created_at > now() - INTERVAL '24 hours'
       LIMIT 1`,
      [`${row.platform}:${row.product_id}`],
    );
    if (existing.length > 0) return;

    // 앱 알림 INSERT
    const productLabel = row.product_name ?? row.sourcing_value;
    await pool.query(
      `INSERT INTO alerts (type, severity, sku_code, message, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'sourcing_url_dead',
        'high',
        `${row.platform}:${row.product_id}`,
        `소싱 URL 접근 불가 — ${productLabel} (${row.platform})`,
        JSON.stringify({ url: row.sourcing_value, httpStatus: result.httpStatus, platform: row.platform, productId: row.product_id }),
      ],
    );
    deadRows.push({ row, httpStatus: result.httpStatus });
  });

  // dead URL이 있으면 이메일 발송 시도
  const emailed = deadRows.length > 0 ? await sendDeadUrlEmail(deadRows) : false;

  return NextResponse.json({
    success: true,
    checked: rows.length,
    dead: deadRows.length,
    emailed,
  });
}
