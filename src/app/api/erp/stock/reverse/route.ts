// POST /api/erp/stock/reverse — 조정·기초 전표 되돌리기(역전표). body { idemKey, note? }
// 영수증·RG 보내기 전표는 옛 원가 기록과 짝이라 여기서 되돌리지 않는다.
// 기초(opening:) 전표를 되돌려도 ledger_cutover 커서는 그대로 둔다(판매 소급의 시작점은 한 번 정하면 당기지 않는다).
// 되돌린 뒤 그 위치에는 전표(원+역)가 남아 「빈 위치」가 아니므로, 다시 적으면 기초가 아니라 조정(adj:)이 된다.
// 역전표는 원 전표의 ref_type·ref_id를 그대로 물려받는다 — 이력 화면은 둘을 한 요청으로 묶어 보여준다.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { reverse } from '@/lib/erp/ledger/store';
import { isReversibleKey } from '@/lib/erp/ledger/adjust';
import { badRequest, erpError, withTx } from '@/lib/erp/stock/http';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  // 대소문자만 다른 재전송도 같은 전표를 가리켜야 한다 — validateAdjustInput이 requestId를 소문자로 맞추는 것과 같은 이유
  const rawIdemKey: unknown = body?.idemKey;
  const idemKey = typeof rawIdemKey === 'string' ? rawIdemKey.toLowerCase() : rawIdemKey;
  if (typeof idemKey !== 'string' || !isReversibleKey(idemKey)) return badRequest('되돌릴 수 있는 것은 조정(adj:)·기초(opening:) 전표뿐이다');
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : '화면에서 되돌림';
  try {
    const r = await withTx((c) => reverse(c, idemKey, { occurredAt: new Date().toISOString(), note }));
    // posted:false = rev: 키가 이미 있다(이미 되돌렸다). 성공으로 답하지 않는다
    if (!r.posted) return NextResponse.json({ success: false, code: 'already', error: '이미 되돌린 전표다' }, { status: 409 });
    return NextResponse.json({ success: true, data: { ids: r.ids } });
  } catch (e) {
    return erpError(e); // 되돌릴 전표가 없다 → 404
  }
}
