'use client';

/**
 * 영수증 줄 하나. 결정·상품·소분 파라미터를 여기서 고친다.
 *
 * 금액은 **서버가 계산한 net_amount**를 그대로 보여준다.
 * 화면에서 다시 계산하면 확정 경로와 값이 갈릴 수 있고,
 * 그 어긋남은 원가에 그대로 들어간다.
 */

import { useState } from 'react';

export interface LineData {
  id: string;
  line_no: number;
  item_code: string | null;
  item_label: string;
  quantity: number;
  amount: number;
  net_amount: number;
  is_discount: boolean;
  applies_to_line_no: number | null;
  decision: 'pending' | 'ingest' | 'skip';
  product_cost_id: string | null;
  entry_type: 'normal' | 'subdivision' | null;
  items_per_box: number | null;
  subdivision_unit: number | null;
  cost_entry_id: string | null;
  /** 이 품번에 저장된 기본값. 없으면 아직 기억한 적이 없다 */
  remembered_decision: 'ingest' | 'skip' | 'ask' | null;
}

export interface ProductOption {
  id: string;
  product_name: string;
  subdivision_unit: number | null;
}

interface Props {
  line: LineData;
  products: ProductOption[];
  onPatch: (lineNo: number, patch: Record<string, unknown>) => Promise<void>;
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export default function ReceiptLineRow({ line, products, onPatch }: Props) {
  const [busy, setBusy] = useState(false);
  const locked = line.cost_entry_id != null;

  async function patch(p: Record<string, unknown>) {
    setBusy(true);
    try { await onPatch(line.line_no, p); } finally { setBusy(false); }
  }

  if (line.is_discount) {
    return (
      <div style={{
        padding: '8px 14px', fontSize: '12px', color: '#b45309',
        backgroundColor: '#fffaf0', borderLeft: '3px solid #f59e0b',
        marginBottom: '8px', borderRadius: '4px',
      }}>
        할인 {won(line.amount)}
        {line.applies_to_line_no != null && ` → ${line.applies_to_line_no}번 줄에 반영됨`}
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: '#fff', borderRadius: '10px', padding: '12px',
      marginBottom: '8px', border: '1px solid #e5e7eb',
      opacity: busy ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#1a1c1c', flex: 1 }}>
          {line.item_label}
        </span>
        <span style={{ fontSize: '14px', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {won(line.net_amount)}
        </span>
      </div>

      <div style={{ marginTop: '3px', fontSize: '11px', color: '#6b7280' }}>
        {line.item_code ?? '품번 없음'} · {line.quantity}개
        {line.net_amount !== line.amount && (
          <span style={{ color: '#b45309', fontWeight: 700 }}> · 할인 전 {won(line.amount)}</span>
        )}
      </div>

      {locked ? (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#1a7f37', fontWeight: 700 }}>
          입고 완료 — 수정할 수 없습니다
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            {(['ingest', 'skip'] as const).map((d) => (
              <button
                key={d}
                disabled={busy}
                onClick={() => void patch({ decision: d })}
                style={{
                  flex: 1, height: '34px', borderRadius: '8px', fontSize: '13px', fontWeight: 700,
                  border: line.decision === d ? 'none' : '1px solid #d1d5db',
                  backgroundColor: line.decision === d ? (d === 'ingest' ? '#1a7f37' : '#6b7280') : '#fff',
                  color: line.decision === d ? '#fff' : '#4b5563',
                }}
              >
                {d === 'ingest' ? '입고' : '제외'}
              </button>
            ))}
          </div>

          {/*
            제외한 품목을 다음 영수증에서도 자동으로 빼주는 장치.
            품번이 없는 줄(봉투값 등)은 기억할 키가 없어 뜨지 않는다.
            다시 누르면 「매번 물어봄」으로 되돌아간다 — 잘못 눌러도 되돌릴 수 있어야 한다.
          */}
          {line.decision === 'skip' && line.item_code && (
            <button
              disabled={busy}
              onClick={() => void patch({
                decision: 'skip',
                remember: line.remembered_decision !== 'skip',
              })}
              style={{
                width: '100%', height: '32px', marginTop: '8px', borderRadius: '8px',
                border: line.remembered_decision === 'skip' ? 'none' : '1px solid #d1d5db',
                backgroundColor: line.remembered_decision === 'skip' ? '#4b5563' : '#fff',
                color: line.remembered_decision === 'skip' ? '#fff' : '#6b7280',
                fontSize: '12px', fontWeight: 700,
              }}
            >
              {line.remembered_decision === 'skip'
                ? '✓ 이 품번은 항상 제외 — 눌러서 해제'
                : '이 품번은 항상 제외'}
            </button>
          )}

          {line.decision === 'ingest' && (
            <>
              <select
                disabled={busy}
                aria-label="입고할 상품"
                value={line.product_cost_id ?? ''}
                onChange={(e) => {
                  const id = e.target.value || null;
                  const prod = products.find((p) => p.id === id);
                  void patch({
                    product_cost_id: id,
                    entry_type: line.entry_type ?? 'normal',
                    subdivision_unit: line.subdivision_unit ?? prod?.subdivision_unit ?? null,
                  });
                }}
                style={{
                  width: '100%', height: '38px', marginTop: '8px', borderRadius: '8px',
                  border: line.product_cost_id ? '1px solid #d1d5db' : '1px solid #f87171',
                  padding: '0 8px', fontSize: '13px', backgroundColor: '#fff',
                }}
              >
                <option value="">상품 선택…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.product_name}</option>
                ))}
              </select>

              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                {(['normal', 'subdivision'] as const).map((t) => (
                  <button
                    key={t}
                    disabled={busy}
                    onClick={() => void patch({ entry_type: t })}
                    style={{
                      flex: 1, height: '30px', borderRadius: '8px', fontSize: '12px', fontWeight: 700,
                      border: line.entry_type === t ? 'none' : '1px solid #d1d5db',
                      backgroundColor: line.entry_type === t ? '#374151' : '#fff',
                      color: line.entry_type === t ? '#fff' : '#4b5563',
                    }}
                  >
                    {t === 'normal' ? '일반' : '소분'}
                  </button>
                ))}
              </div>

              {line.entry_type === 'subdivision' && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                  <label style={{ flex: 1, fontSize: '11px', color: '#6b7280' }}>
                    박스당 개수
                    <input
                      type="number" min={1} inputMode="numeric"
                      defaultValue={line.items_per_box ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        if (v !== line.items_per_box) void patch({ items_per_box: v });
                      }}
                      style={{ width: '100%', height: '34px', borderRadius: '8px',
                               border: '1px solid #d1d5db', padding: '0 8px', fontSize: '13px',
                               boxSizing: 'border-box' }}
                    />
                  </label>
                  <label style={{ flex: 1, fontSize: '11px', color: '#6b7280' }}>
                    소분 단위
                    <input
                      type="number" min={1} inputMode="numeric"
                      defaultValue={line.subdivision_unit ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        if (v !== line.subdivision_unit) void patch({ subdivision_unit: v });
                      }}
                      style={{ width: '100%', height: '34px', borderRadius: '8px',
                               border: '1px solid #d1d5db', padding: '0 8px', fontSize: '13px',
                               boxSizing: 'border-box' }}
                    />
                  </label>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
