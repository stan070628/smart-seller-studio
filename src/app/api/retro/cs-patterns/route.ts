import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { extractTopPatterns } from '@/lib/retro/cs-pattern-extractor';

export async function GET() {
  const pool = getSourcingPool();
  const { rows } = await pool.query<{ questionText: string }>(
    `SELECT question_text AS "questionText" FROM cs_inquiries
     WHERE created_at > now() - INTERVAL '28 days'`,
  ).catch(() => ({ rows: [] as Array<{ questionText: string }> }));

  const patterns = extractTopPatterns(rows);
  return NextResponse.json({ success: true, total: rows.length, patterns });
}
