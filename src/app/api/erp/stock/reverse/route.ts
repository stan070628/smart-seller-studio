// POST /api/erp/stock/reverse — 조정·기초 전표 되돌리기(역전표). body { idemKey, note? }
// 영수증·RG 보내기 전표는 옛 원가 기록과 짝이라 여기서 되돌리지 않는다.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { reverse } from '@/lib/erp/ledger/store';
import { isReversibleKey } from '@/lib/erp/ledger/adjust';
import { badRequest, erpError, withTx } from '@/lib/erp/stock/http';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  const idemKey = body?.idemKey;
  if (typeof idemKey !== 'string' || !isReversibleKey(idemKey)) return badRequest('되돌릴 수 있는 것은 조정(adj:)·기초(opening:) 전표뿐이다');
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : '화면에서 되돌림';
  try {
    const r = await withTx((c) => reverse(c, idemKey, { occurredAt: new Date().toISOString(), note }));
    if (!r.posted) return NextResponse.json({ success: false, code: 'already', error: '이미 되돌린 전표다' }, { status: 409 });
    return NextResponse.json({ success: true, data: { ids: r.ids } });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('되돌릴 전표가 없다')) {
      return NextResponse.json({ success: false, code: 'not_found', error: e.message }, { status: 404 });
    }
    return erpError(e);
  }
}
