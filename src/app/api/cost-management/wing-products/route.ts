import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const client = getCoupangClient();
    const items: Array<{ sellerProductId: number; sellerProductName: string }> = [];
    let nextToken = '';

    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await client.getSellerProducts('APPROVED', PAGE_SIZE, nextToken);
      for (const p of result.items) {
        items.push({ sellerProductId: p.sellerProductId, sellerProductName: p.sellerProductName });
      }
      if (!result.nextToken) break;
      nextToken = result.nextToken;
    }

    return NextResponse.json({ success: true, data: items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
