// src/__tests__/config/vercel-crons.test.ts
import { describe, it, expect } from 'vitest';
import vercel from '../../../vercel.json';

// 2026-09-25 ERP 0단계: 소싱을 쓰지 않아(sourcing_shortlist 마지막 기록 08-01) 이 목록만 남긴다.
// 새 cron은 여기가 아니라 Supabase pg_cron으로 건다(Hobby 플랜 일 1회 제한).
const ALLOWED = [
  '/api/sourcing/costco/cron',
  '/api/sourcing/costco/seasonal',
  '/api/sourcing/costco/naver-prices',
  '/api/cron/refresh-dashboard-metrics',
  '/api/cron/parse-receipts',
  '/api/cron/purge-receipt-images',
];

describe('vercel.json crons', () => {
  it('허용 목록 밖의 cron이 없다', () => {
    const paths = vercel.crons.map((c: { path: string }) => c.path).sort();
    expect(paths).toEqual([...ALLOWED].sort());
  });
});
