'use client';

/**
 * (1-C2b ①) 미연결 주문 대기열. 묶음(채널·상품번호·옵션)마다 SKU를 골라 「리스팅으로 연결」(앞으로도 자동) 또는 「이 주문만 연결」.
 * 아래 「최근 연결」에서 이 화면이 만든 연결을 해제한다. 해제만으로는 이미 뺀 재고를 되돌리지 않는다 — 올바른 SKU로 다시 연결하면 옮겨진다.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { bandStyle, btnStyle, primaryBtnStyle, thStyle } from '@/components/orders/erp-ui';
import type { StockListRow } from '@/lib/erp/stock/queries';
import type { UnattributedGroup } from '@/lib/erp/orders/queue';
import { CHANNEL_LABEL } from '@/lib/erp/orders/types';
import { fetchQueue, postLinkLines, postLinkListing, postUnlink, type QueueData } from './api';
import SkuPicker from './SkuPicker';
import { fmtKst, won } from './stock-view';

const REASON: Record<string, string> = { no_listing: '리스팅 없음', any_of: 'SKU 여럿', option_unmatched: '옵션 불일치', no_sku_link: 'SKU 연결 없음' };
const td: React.CSSProperties = { borderBottom: `1px solid ${E.lineSoft}`, padding: '4px 6px', fontSize: 11.5, verticalAlign: 'top' };

interface Props { onClose: () => void; onChanged: () => void }

export default function UnattributedDialog({ onClose, onChanged }: Props) {
  const [data, setData] = useState<QueueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sku, setSku] = useState<StockListRow | null>(null);
  const [mult, setMult] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchQueue();
    if (!r.ok) setError(r.error);
    else { setError(null); setData(r.data); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 열 때 대기열을 읽는다
  useEffect(() => { void load(); }, [load]);

  const keyOf = (g: UnattributedGroup) => `${g.channel}|${g.productId}|${g.optionKey}`;
  async function done(ok: boolean, msg: string) {
    setBusy(false);
    if (!ok) { toast.error(msg); return; }
    toast.success(msg);
    setOpen(null); setSku(null); setMult(1);
    await load();
    onChanged();
  }
  async function link(g: UnattributedGroup, mode: 'listing' | 'line') {
    if (!sku) return;
    setBusy(true);
    const r = mode === 'listing'
      ? await postLinkListing({ channel: g.channel, productId: g.productId, optionKey: g.optionKey, skuId: sku.skuId, multiplier: mult, label: g.label })
      : await postLinkLines(g.lineIds, sku.skuId);
    await done(r.ok, r.ok ? `연결했습니다 — ${g.lines}줄` : r.error);
  }
  async function unlink(b: { mode: 'listing'; listingId: number } | { mode: 'line'; lineId: number }) {
    setBusy(true);
    const r = await postUnlink(b);
    await done(r.ok, r.ok ? '해제했습니다 — 해당 줄은 다시 미연결로 돌아갑니다(이미 뺀 재고는 그대로)' : r.error);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)' }} />
      <div role="dialog" aria-label="미연결 주문 대기열"
        style={{ position: 'relative', width: 'min(1100px, 96vw)', maxHeight: '88vh', overflow: 'auto', background: E.surface, border: `1px solid ${E.line}`, color: E.ink, fontSize: 12 }}>
        <div style={{ ...bandStyle, justifyContent: 'space-between' }}>
          <span>미연결 주문 {data ? `${data.groups.length}묶음 · ${won(data.groups.reduce((s, g) => s + g.lines, 0))}줄` : ''}</span>
          <button type="button" aria-label="닫기" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }}><X size={13} /></button>
        </div>
        {error && <div role="alert" style={{ padding: 10, color: E.loss }}>{error}</div>}
        {data && data.groups.length === 0 && <div style={{ padding: 10, color: E.inkMute }}>미연결 주문이 없습니다</div>}
        {data && data.groups.length > 0 && (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>{['채널', '상품번호 · 옵션', '상품', '원인', '줄 · 수량', '결제일', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {data.groups.map((g) => (
                <React.Fragment key={keyOf(g)}>
                  <tr>
                    <td style={td}>{CHANNEL_LABEL[g.channel]}</td>
                    <td style={{ ...td, fontFamily: E.mono }}>{g.productId}{g.optionKey ? ` · ${g.optionKey}` : ''}</td>
                    <td style={{ ...td, maxWidth: 320 }}>{g.label}</td>
                    <td style={td}>{g.reasons.map((r) => REASON[r] ?? r).join(', ')}</td>
                    <td style={td}>{won(g.lines)}줄 · {won(g.qty)}개</td>
                    <td style={td}>{g.firstPaidAt ? fmtKst(g.firstPaidAt) : '—'}{g.lastPaidAt && g.lastPaidAt !== g.firstPaidAt ? ` ~ ${fmtKst(g.lastPaidAt)}` : ''}</td>
                    <td style={td}><button type="button" onClick={() => { setOpen(open === keyOf(g) ? null : keyOf(g)); setSku(null); setMult(1); }} style={btnStyle}>연결…</button></td>
                  </tr>
                  {open === keyOf(g) && (
                    <tr><td colSpan={7} style={{ ...td, background: E.ground }}>
                      <SkuPicker value={sku} onChange={setSku} />
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                        <label>배수 <input type="number" min={1} max={100} value={mult} onChange={(e) => setMult(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} style={{ width: 48 }} /></label>
                        <button type="button" disabled={!sku || busy} onClick={() => void link(g, 'listing')} style={primaryBtnStyle}>리스팅으로 연결(앞으로도)</button>
                        <button type="button" disabled={!sku || busy} onClick={() => void link(g, 'line')} style={btnStyle}>이 {g.lines}줄만 연결</button>
                        <span style={{ color: E.inkSub }}>배수 = 주문 1개가 SKU 몇 개인가(묶음 상품). 「이 줄만」은 배수를 쓰지 않는다</span>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
        {data && (data.recent.listings.length > 0 || data.recent.lines.length > 0) && (
          <div style={{ padding: 8 }}>
            <div style={{ fontWeight: 600, margin: '6px 0' }}>최근 연결(이 화면에서 만든 것)</div>
            {data.recent.listings.map((l) => (
              <div key={`l${l.listingId}`} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                <span>{CHANNEL_LABEL[l.channel]} {l.productId}{l.optionKey ? ` · ${l.optionKey}` : ''} → {l.skuLabel}{l.multiplier > 1 ? ` ×${l.multiplier}` : ''}</span>
                <span style={{ color: E.inkSub }}>{fmtKst(l.createdAt)}</span>
                <button type="button" disabled={busy} onClick={() => void unlink({ mode: 'listing', listingId: l.listingId })} style={btnStyle}>해제</button>
              </div>
            ))}
            {data.recent.lines.map((l) => (
              <div key={`o${l.lineId}`} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                <span>{CHANNEL_LABEL[l.channel]} 주문 줄 {l.externalLineId} → {l.skuLabel}</span>
                <button type="button" disabled={busy} onClick={() => void unlink({ mode: 'line', lineId: l.lineId })} style={btnStyle}>해제</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
