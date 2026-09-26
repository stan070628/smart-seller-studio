'use client';

import React, { useState, useEffect } from 'react';
import { X, Package } from 'lucide-react';
import { distributeRgFee } from '@/lib/cost-management/rg-shipment';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { useDraftPersist, loadDraft } from '@/hooks/useDraftPersist';
import { RG_SHIPMENT_DRAFT_KEY } from './draft-keys';
import { buildSkuItems, skusForProduct, type SkuOption } from './rg-sku-split';

interface RgShipmentDraft {
  shippedAt: string;
  totalFee: string;
  quantities: Record<string, string>;
  wingInboundId: string;
  skuQty: Record<string, string>;
}

interface ProductForRg {
  id: string;
  product_name: string;
  current_stock: number;
}

interface Props {
  products: ProductForRg[];
  onClose: () => void;
  onCreated: () => void;
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

export default function RocketGrowthShipmentModal({ products, onClose, onCreated }: Props) {
  const [shippedAt, setShippedAt] = useState(new Date().toISOString().slice(0, 10));
  const [totalFee, setTotalFee] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // 1-C1: 원장 SKU(집 재고 포함). 불러오지 못해도 옛 흐름(원가 배분)은 그대로 쓸 수 있다
  const [skus, setSkus] = useState<SkuOption[]>([]);
  // 로딩 중엔 제출을 막고(원장 SKU를 안 보고 보내면 나뉠 옵션을 놓칠 수 있다), 실패하면 옛 흐름으로 계속 진행하게 한다
  const [skuLoadState, setSkuLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [skuQty, setSkuQty] = useState<Record<number, string>>({});
  const [wingInboundId, setWingInboundId] = useState('');

  useEffect(() => {
    fetch('/api/erp/stock')
      .then((r) => r.json())
      .then((j) => {
        if (j.success) { setSkus(j.data as SkuOption[]); setSkuLoadState('ready'); } else setSkuLoadState('error');
      })
      .catch(() => setSkuLoadState('error'));
  }, []);

  // ── 초안 저장/복원 ── 전역 액션 모달 하나뿐이라 고정 키를 쓴다(ShippingGroupModal과 동일).
  useEffect(() => {
    const saved = loadDraft<RgShipmentDraft>(RG_SHIPMENT_DRAFT_KEY);
    const hasMeaningfulQty = saved.quantities && Object.values(saved.quantities).some((v) => v && v !== '0');
    const hasMeaningfulSkuQty = saved.skuQty && Object.values(saved.skuQty).some((v) => v && v !== '0');
    if (saved.totalFee || hasMeaningfulQty || saved.wingInboundId || hasMeaningfulSkuQty) {
      if (saved.shippedAt) setShippedAt(saved.shippedAt);
      if (saved.totalFee) setTotalFee(saved.totalFee);
      if (saved.quantities) setQuantities(saved.quantities);
      if (saved.wingInboundId) setWingInboundId(saved.wingInboundId);
      if (saved.skuQty) setSkuQty(saved.skuQty as unknown as Record<number, string>);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasMeaningfulQty = Object.values(quantities).some((v) => v && v !== '0');
  const hasMeaningfulSkuQty = Object.values(skuQty).some((v) => v && v !== '0');
  const { clearNow: clearRgDraftNow } = useDraftPersist(
    RG_SHIPMENT_DRAFT_KEY,
    { shippedAt, totalFee, quantities, wingInboundId, skuQty },
    totalFee !== '' || hasMeaningfulQty || wingInboundId !== '' || hasMeaningfulSkuQty,
  );

  const feeNum = Number(totalFee.replace(/,/g, '')) || 0;

  function setQty(productId: string, value: string) {
    setQuantities((prev) => ({ ...prev, [productId]: value }));
  }

  const activeItems = products
    .map((p) => ({ ...p, qty: parseInt(quantities[p.id] ?? '0') || 0 }))
    .filter((p) => p.qty > 0);

  const totalQty = activeItems.reduce((s, i) => s + i.qty, 0);

  const unitFees = distributeRgFee(activeItems, feeNum);
  // SKU 목록이 로딩 중이면 제출을 막는다 — 실패(error)는 옛 흐름(원가 배분)만으로도 등록할 수 있어 막지 않는다
  const canSubmit = activeItems.length > 0 && feeNum > 0 && !!shippedAt && skuLoadState !== 'loading';

  async function submit() {
    if (!canSubmit) return;

    const skipped = products.filter((p) => (parseInt(quantities[p.id] ?? '0') || 0) === 0);
    if (skipped.length > 0) {
      const names = skipped.map((p) => p.product_name).join('\n- ');
      const ok = await confirmDialog({
        message: `다음 ${skipped.length}개 상품은 수량이 입력되지 않아 이번 입고에 포함되지 않습니다:\n\n- ${names}\n\n계속 진행할까요?`,
      });
      if (!ok) return;
    }

    const split = buildSkuItems(activeItems.map((i) => ({ id: i.id, qty: i.qty })), skus, skuQty);
    if (split.mismatched.length > 0) {
      const lines = split.mismatched
        .map((m) => {
          const name = products.find((p) => p.id === m.productId)?.product_name ?? m.productId;
          return m.skuSum === 0
            ? `- ${name}: 옵션별 수량을 비워 원장 기록 없이 보냅니다`
            : `- ${name}: 보낼 ${m.productQty}개 · SKU 합 ${m.skuSum}개 — 원장에는 옵션별 수량대로 기록됩니다`;
        })
        .join('\n');
      const ok = await confirmDialog({ message: `옵션별 수량 합이 보낼 수량과 다릅니다:\n\n${lines}\n\n계속할까요?` });
      if (!ok) return;
    }

    setSaving(true);
    try {
      const items = activeItems.map((item) => ({
        product_cost_id: item.id,
        quantity: item.qty,
        unit_rg_fee: unitFees.get(item.id) ?? 0,
      }));

      const res = await fetch('/api/cost-management/rg-shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipped_at: shippedAt, total_shipping_fee: feeNum, items,
          sku_items: split.items, wing_inbound_id: wingInboundId,
        }),
      });
      const json = await res.json();
      if (json.success) {
        clearRgDraftNow();
        toast.success('로켓그로스 입고를 등록했습니다');
        const skipped = (json.data?.ledger?.skipped ?? []) as { skuId: number }[];
        if (skipped.length > 0) {
          const labels = skipped.map((s) => {
            const sku = skus.find((k) => k.skuId === s.skuId);
            return sku ? sku.option || sku.name : `SKU ${s.skuId}`;
          });
          const shown = labels.slice(0, 3).join(', ');
          const more = labels.length > 3 ? ` 외 ${labels.length - 3}개` : '';
          toast.warning(`${shown}${more}: 원장 집 재고가 없어 이동 기록을 건너뜀(재고현황에서 먼저 세기)`);
        }
        onCreated();
        onClose();
      } else {
        toast.error(json.error ?? '등록에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', width: '520px', maxHeight: '85vh', background: '#fff', color: '#111111', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* 헤더 */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(3,105,161,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Package size={15} color="#0369a1" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#18181b' }}>로켓그로스 입고 등록</div>
            <div style={{ fontSize: '11px', color: '#71717a' }}>배송비를 수량 비례로 자동 배분합니다</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={16} color="#71717a" /></button>
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {/* 입고일 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>입고일</div>
            <input
              type="date"
              value={shippedAt}
              onChange={(e) => setShippedAt(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', color: '#18181b' }}
            />
          </div>

          {/* 총 배송비 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>총 배송비 (원)</div>
            <input
              type="number"
              value={totalFee}
              onChange={(e) => setTotalFee(e.target.value)}
              placeholder="예: 22750"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '13px', fontWeight: 600, boxSizing: 'border-box' }}
            />
          </div>

          {/* Wing 입고 ID — 원장 이동 전표의 메모로 남긴다 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>Wing 입고 ID (선택)</div>
            <input
              value={wingInboundId}
              onChange={(e) => setWingInboundId(e.target.value)}
              placeholder="예: 12345678"
              aria-label="Wing 입고 ID"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', boxSizing: 'border-box' }}
            />
          </div>

          {skuLoadState === 'error' && (
            <div style={{ marginBottom: '16px', padding: '8px 12px', borderRadius: '8px', background: '#fef3c7', border: '1px solid #fde68a', fontSize: '11px', color: '#92400e' }}>
              재고 SKU를 불러오지 못해 원장에는 기록되지 않습니다
            </div>
          )}

          {/* 상품 목록 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '8px' }}>보낼 수량 입력</div>
            <div style={{ background: '#f9f9f9', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e5e5' }}>
              {/* 헤더 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px 70px', gap: '8px', padding: '8px 12px', fontSize: '10px', color: '#999', fontWeight: 600, borderBottom: '1px solid #e5e5e5', background: '#f5f5f7' }}>
                <span>상품명</span>
                <span style={{ textAlign: 'right' }}>재고</span>
                <span style={{ textAlign: 'right' }}>이번 수량</span>
                <span style={{ textAlign: 'right' }}>unit배송비</span>
              </div>
              {products.map((p) => {
                const qtyStr = quantities[p.id] ?? '';
                const qty = parseInt(qtyStr) || 0;
                const unitFee = qty > 0 ? (unitFees.get(p.id) ?? 0) : null;
                const overStock = qty > p.current_stock;
                const linked = skusForProduct(p.id, skus);
                return (
                  <React.Fragment key={p.id}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px 70px', gap: '8px', padding: '8px 12px', alignItems: 'center', borderBottom: '1px solid #f0f0f0', background: qty === 0 ? '#f5f5f7' : '#fff' }}>
                    <span style={{ fontSize: '11px', color: '#18181b', fontWeight: 500 }}>{p.product_name}</span>
                    <span style={{ fontSize: '11px', textAlign: 'right', color: '#71717a' }}>{fmt(p.current_stock)}개</span>
                    <div style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min={0}
                        max={p.current_stock}
                        value={qtyStr}
                        onChange={(e) => setQty(p.id, e.target.value)}
                        placeholder="0"
                        style={{
                          width: '60px', padding: '4px 6px', borderRadius: '6px', textAlign: 'right',
                          border: `1px solid ${overStock ? '#ef4444' : '#e5e5e5'}`,
                          fontSize: '12px', fontWeight: 600, color: overStock ? '#ef4444' : '#18181b',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: '11px', textAlign: 'right', color: '#0369a1', fontWeight: unitFee ? 600 : 400 }}>
                      {unitFee !== null ? `${fmt(unitFee)}원` : '—'}
                    </span>
                  </div>
                  {qty > 0 && (
                    <div style={{ padding: '4px 12px 8px 24px', borderBottom: '1px solid #f0f0f0', background: '#fff', fontSize: '10.5px', color: '#555' }}>
                      {linked.length === 0 && <span style={{ color: '#999' }}>연결된 재고 SKU 없음 — 원장 기록 없이 보냅니다</span>}
                      {linked.length === 1 && (
                        linked[0].hasSelfLedger
                          ? <span>재고 SKU {linked[0].option || linked[0].name} · {fmt(qty)}개 자동 (집 원장 {fmt(linked[0].self)}개)</span>
                          : <span style={{ color: '#b45309' }}>재고 SKU {linked[0].option || linked[0].name} — 원장 없음 — 기록 건너뜀</span>
                      )}
                      {linked.length > 1 && linked.map((s) => (
                        <label key={s.skuId} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                          <span style={{ flex: 1 }}>
                            {s.option || s.name} <span style={{ color: '#999' }}>(집 {fmt(s.self)})</span>
                            {!s.hasSelfLedger && <span style={{ color: '#b45309' }}> · 원장 없음 — 기록 건너뜀</span>}
                          </span>
                          <input
                            type="number"
                            min={0}
                            aria-label={`${s.option || s.name} 보낼 수량`}
                            value={skuQty[s.skuId] ?? ''}
                            onChange={(e) => setSkuQty((prev) => ({ ...prev, [s.skuId]: e.target.value }))}
                            placeholder="0"
                            style={{ width: '56px', padding: '2px 6px', borderRadius: '6px', border: '1px solid #e5e5e5', fontSize: '11px', textAlign: 'right' }}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* 미리보기 합계 */}
          {activeItems.length > 0 && feeNum > 0 && (
            <div style={{ background: '#f0f9ff', borderRadius: '8px', padding: '12px', border: '1px solid #bae6fd' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#0369a1', marginBottom: '6px' }}>배분 미리보기</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#0369a1' }}>
                <span>합계 수량</span>
                <span style={{ fontWeight: 600 }}>{fmt(totalQty)}개</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#0369a1', marginTop: '4px' }}>
                <span>총 배송비</span>
                <span style={{ fontWeight: 600 }}>{fmt(feeNum)}원</span>
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e5e5' }}>
          <button
            onClick={submit}
            disabled={saving || !canSubmit}
            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: canSubmit ? '#0369a1' : '#e5e5e5', color: canSubmit ? '#fff' : '#999', fontSize: '13px', fontWeight: 600, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            {saving ? '등록 중...' : skuLoadState === 'loading' ? '재고 확인 중...' : '로켓그로스 입고 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
