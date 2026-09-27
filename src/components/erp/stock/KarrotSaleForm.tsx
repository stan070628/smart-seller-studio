// src/components/erp/stock/KarrotSaleForm.tsx
'use client';

/**
 * (1-C2b ③) 당근 판매 입력 — 휴대폰(/m/stock 「당근 판매」 탭)·PC(재고현황 「당근 판매」 창) 공용.
 * 상품 → 수량(−/+) → 받은 돈 → 날짜(기본 오늘) → 저장. 집 재고보다 많으면 서버가 409로 막는다(먼저 재고를 고친다) — 그 문구를 그대로 보인다.
 * 되돌리기는 두 번 눌러야 한다(window.confirm을 쓰지 않는다).
 * 다크 테마 전역 스타일(body color: 밝은 회색)이 새어 들어오므로 배경·글자색을 모든 칸에 명시한다(MobileStock과 같은 이유).
 */
import { useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { StockListRow } from '@/lib/erp/stock/queries';
import type { KarrotSaleRow } from '@/lib/erp/orders/karrot';
import { kstDate } from '@/lib/erp/stock/count-queue';
import { fetchKarrot, postKarrot, postKarrotCancel } from './api';
import SkuPicker from './SkuPicker';
import { fmtKst, parseWon, won } from './stock-view';

interface Props { variant: 'mobile' | 'pc'; onSaved?: () => void }

export default function KarrotSaleForm({ variant, onSaved }: Props) {
  const today = kstDate(new Date());
  const [sku, setSku] = useState<StockListRow | null>(null);
  const [qty, setQty] = useState(1);
  const [amountRaw, setAmountRaw] = useState('');
  const [soldOn, setSoldOn] = useState(today);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [recent, setRecent] = useState<KarrotSaleRow[]>([]);
  const [arm, setArm] = useState<number | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);

  const load = useCallback(async () => { const r = await fetchKarrot(); if (r.ok) setRecent(r.data); }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 열 때 최근 판매를 읽는다
  useEffect(() => { void load(); }, [load]);

  const amount = parseWon(amountRaw);
  const amountBad = amountRaw.trim() !== '' && amount === null;
  const canSave = !!sku && qty >= 1 && amount !== null && soldOn !== '' && !saving;

  async function save() {
    if (!sku || amount === null || saving) return;
    setSaving(true);
    setMsg(null);
    const r = await postKarrot({ skuId: sku.skuId, qty, amount, soldOn, requestId: uuidv4() });
    setSaving(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({
      ok: true,
      text: r.data.outcome === 'duplicate' ? '이미 기록된 판매입니다' : `${sku.name} ${qty}개 · ${won(amount)}원 기록했습니다`,
    });
    setSku(null); setQty(1); setAmountRaw(''); setSoldOn(today); setPickerKey((k) => k + 1);
    await load();
    onSaved?.();
  }
  async function cancel(lineId: number) {
    if (canceling) return;
    if (arm !== lineId) { setArm(lineId); return; }
    setArm(null);
    setCanceling(true);
    const r = await postKarrotCancel(lineId);
    setCanceling(false);
    setMsg(r.ok ? { ok: true, text: '되돌렸습니다' } : { ok: false, text: r.error });
    await load();
    onSaved?.();
  }

  const mobile = variant === 'mobile';
  const box = { backgroundColor: '#fff', borderRadius: mobile ? 12 : 0, padding: 12, border: '1px solid #e5e7eb', marginBottom: 8, color: '#111827' } as const;
  const field = { width: '100%', height: mobile ? 40 : 28, borderRadius: mobile ? 8 : 2, border: '1px solid #d1d5db', padding: '0 10px', fontSize: mobile ? 14 : 12, boxSizing: 'border-box', backgroundColor: '#fff', color: '#111827' } as const;
  const round = { width: 44, height: 44, borderRadius: 22, border: '1px solid #d1d5db', backgroundColor: '#fff', color: '#111827', fontSize: 22 } as const;
  const label = { fontWeight: 700, margin: '12px 0 6px', color: '#111827' } as const;

  return (
    <div style={{ color: '#111827' }}>
      <style>{`.karrot-input::placeholder { color: #9ca3af; }`}</style>
      {msg && <div role={msg.ok ? 'status' : 'alert'} style={{ ...box, backgroundColor: msg.ok ? '#e7f6ec' : '#fdecec', color: msg.ok ? '#1a7f37' : '#b91c1c', fontWeight: 700 }}>{msg.text}</div>}
      <div style={box}>
        <div style={{ ...label, marginTop: 0 }}>상품</div>
        <SkuPicker key={pickerKey} value={sku} onChange={setSku} variant={variant} />
        {sku && (
          <>
            <div style={label}>수량</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button type="button" aria-label="하나 빼기" onClick={() => setQty((q) => Math.max(1, q - 1))} style={round}>−</button>
              <span style={{ fontSize: 22, fontWeight: 700, minWidth: 32, textAlign: 'center', color: '#111827' }}>{qty}</span>
              <button type="button" aria-label="하나 더하기" onClick={() => setQty((q) => q + 1)} style={round}>+</button>
              <span style={{ color: '#6b7280', fontSize: 12 }}>집 재고 {won(sku.self)}</span>
            </div>
            <div style={label}>받은 돈(원, 합계)</div>
            <input className="karrot-input" aria-label="받은 돈" inputMode="numeric" value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} placeholder="예: 20000" style={field} />
            {amountBad && <div role="alert" style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}>숫자만 적는다(예: 20000)</div>}
            <div style={label}>판매일</div>
            <input className="karrot-input" aria-label="판매일" type="date" value={soldOn} max={today} onChange={(e) => setSoldOn(e.target.value)} style={field} />
          </>
        )}
      </div>
      <button type="button" disabled={!canSave} onClick={() => void save()}
        style={{ width: '100%', height: mobile ? 52 : 32, borderRadius: mobile ? 12 : 2, border: 'none', backgroundColor: canSave ? '#ff6f0f' : '#d1d5db', color: '#fff', fontSize: mobile ? 16 : 13, fontWeight: 700 }}>
        {saving ? '저장 중…' : '당근 판매 저장'}
      </button>
      {recent.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#111827' }}>최근 당근 판매</div>
          {recent.map((s) => (
            <div key={s.lineId} style={{ ...box, fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ flex: 1, color: s.status === 'canceled' ? '#6b7280' : '#111827' }}>
                <b>{s.label}</b> · {s.qty}개 · {won(s.amount)}원 · {fmtKst(s.soldAt)}{s.status === 'canceled' ? ' · 되돌림' : ''}
              </span>
              {s.status !== 'canceled' && (
                <button type="button" disabled={canceling} onClick={() => void cancel(s.lineId)}
                  style={{ border: '1px solid #d1d5db', backgroundColor: '#fff', borderRadius: 6, padding: '4px 8px', color: arm === s.lineId ? '#b91c1c' : '#374151' }}>
                  {arm === s.lineId ? '한 번 더 누르면 되돌림' : '되돌리기'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
