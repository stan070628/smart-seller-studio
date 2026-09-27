'use client';

/**
 * 「차감 켜기…」 확인 창(게이트 ②). 켜면 기초재고 시각 이후 결제된 대기 라인을 결제 시각 순으로 원장에서 뺀다 — 끄는 화면은 없다.
 * 서버가 다시 센 소급 라인 수가 이 창이 본 수와 다르면 409 stale → 미리보기를 다시 읽는다.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { bandStyle, btnStyle, disabledBtnStyle, primaryBtnStyle } from '@/components/orders/erp-ui';
import type { BackfillPreview } from '@/lib/erp/orders/deduct';
import { CHANNEL_LABEL, SALE_CHANNELS } from '@/lib/erp/orders/types';
import { fetchDeductPreview, postDeductEnable } from './api';
import { LOC_LABEL, fmtKst, won } from './stock-view';

interface Props {
  onClose: () => void;
  onDone: () => void;
}

export default function DeductEnableDialog({ onClose, onDone }: Props) {
  const [preview, setPreview] = useState<BackfillPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPreview(null);
    const r = await fetchDeductPreview();
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setPreview(r.data);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 창을 열 때 미리보기를 읽는다
  useEffect(() => { void load(); }, [load]);

  async function enable() {
    if (!preview) return;
    setBusy(true);
    const r = await postDeductEnable(preview.lines);
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      if (r.code === 'stale') { setChecked(false); await load(); }
      return;
    }
    const s = r.data.summary;
    toast.success(`판매 차감을 켰습니다 — ${won(s.posted)}줄 차감${s.short > 0 ? ` · 재고 부족 ${won(s.short)}줄(재고를 고치면 다음 수집에서 빠집니다)` : ''}`);
    onDone();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)' }} />
      <div
        role="dialog"
        aria-label="판매 차감 켜기"
        style={{ position: 'relative', width: 'min(720px, 94vw)', maxHeight: '88vh', overflow: 'auto', background: E.surface, border: `1px solid ${E.line}`, color: E.ink, fontSize: 12 }}
      >
        <div style={{ ...bandStyle, justifyContent: 'space-between' }}>
          <span>판매 차감 켜기 — 기초재고 시각부터 소급</span>
          <button type="button" aria-label="닫기" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }}><X size={13} /></button>
        </div>
        {error && <div role="alert" style={{ margin: 12, padding: 8, border: `1px solid ${E.loss}`, color: E.loss }}>{error}</div>}
        {!preview && !error && <div style={{ padding: 12, color: E.inkMute }}>계산하는 중…</div>}
        {preview && (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 14, fontFamily: E.mono, flexWrap: 'wrap' }}>
              <span>소급 {won(preview.lines)}줄</span>
              <span>SKU {won(preview.skus)}개</span>
              <span>집 −{won(preview.self)}개</span>
              <span>RG −{won(preview.rg)}개</span>
            </div>
            <div style={{ color: E.inkSub }}>
              채널: {SALE_CHANNELS.map((c) => `${CHANNEL_LABEL[c]} ${won(preview.byChannel[c] ?? 0)}`).join(' · ')}
              {preview.firstPaidAt && ` · 결제 ${fmtKst(preview.firstPaidAt)} ~ ${fmtKst(preview.lastPaidAt ?? preview.firstPaidAt)}`}
            </div>
            <div style={{ color: E.inkSub }}>
              기초재고 시각 {fmtKst(preview.cutover)} 이전 결제는 빼지 않습니다(기초재고에 이미 반영). 취소·반품 완료 라인은 되돌림 전표가 자동으로 남습니다 —
              그 물건을 재고현황에서 「반품입고」로 다시 올리지 않습니다.
            </div>
            {preview.shortages.length > 0 && (
              <div style={{ border: `1px solid ${E.warn}`, background: E.warnSoft, color: E.warn, padding: 8 }}>
                <b>재고 부족 {preview.shortages.length}건 — 이 SKU의 라인은 「재고 부족」으로 남고, 재고를 고치면 다음 수집에서 빠집니다</b>
                {preview.shortages.map((s) => (
                  <div key={`${s.skuId}:${s.location}`}>
                    · {s.name}{s.option ? ` · ${s.option}` : ''} — {LOC_LABEL[s.location]} 필요 {won(s.need)} / 원장 {won(s.have)}
                  </div>
                ))}
              </div>
            )}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              채널 관리자 화면과 3일 건수를 대조했습니다
            </label>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={btnStyle}>닫기</button>
              <button type="button" disabled={!checked || busy} onClick={() => void enable()} style={!checked || busy ? disabledBtnStyle : primaryBtnStyle}>
                {busy ? '켜는 중…' : '차감 켜기'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
