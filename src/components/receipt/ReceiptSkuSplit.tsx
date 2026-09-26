'use client';

/**
 * 영수증 줄 하나의 재고 SKU 분배. 확정 때 원장 「집」 입고로 들어갈 옵션과 수량을 정한다.
 * 후보 1개 = 자동(안내만) · 후보 여럿 = 옵션별 수량 · 후보 없음 = SKU를 검색해 고른다(고른 연결은 확정 때 기억된다).
 * 합이 서버가 계산한 판매단위 수량과 다르면 그 줄만 확정이 실패하고 실제 수량이 화면에 뜬다.
 */
import { useState } from 'react';
import { choicesOf, splitSum, type LineSkuOptions, type SkuCandidateView, type SplitDraft } from './sku-split';

interface Props {
  options: LineSkuOptions;
  draft: SplitDraft;
  allSkus: SkuCandidateView[];
  onChange: (d: SplitDraft) => void;
  /** 검색 칸에 처음 들어갈 때 SKU 목록을 불러온다 */
  onNeedSkus: () => void;
}

const label = (c: SkuCandidateView) => (c.option ? `${c.name} · ${c.option}` : c.name);

const box = {
  marginTop: '-4px', marginBottom: '8px', padding: '8px 12px', borderRadius: '0 0 10px 10px',
  border: '1px solid #e5e7eb', borderTop: 'none', backgroundColor: '#f9fafb', fontSize: '12px', color: '#374151',
} as const;

export default function ReceiptSkuSplit({ options, draft, allSkus, onChange, onNeedSkus }: Props) {
  const [q, setQ] = useState('');
  const exp = options.expectedQty;
  const expText = exp ? `${exp.qty}개${exp.approx ? '(소분 추정 — 이월에 따라 달라질 수 있습니다)' : ''}` : '입고 수량';

  if (options.candidates.length === 1) {
    return <div style={box}>재고: {label(options.candidates[0])} · {expText} 자동</div>;
  }

  const choices = choicesOf(options, draft);
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? allSkus.filter((s) => `${s.name} ${s.option} ${s.key}`.toLowerCase().includes(needle) && !draft.picked.some((p) => p.skuId === s.skuId)).slice(0, 8)
    : [];
  const sum = splitSum(choices, draft);

  return (
    <div style={box}>
      {options.candidates.length === 0 && (
        <>
          <div style={{ fontWeight: 700, color: '#b45309', marginBottom: '6px' }}>연결된 재고 SKU가 없습니다 — 골라 주세요(확정 때 기억합니다)</div>
          <input
            aria-label="재고 SKU 검색"
            value={q}
            onFocus={onNeedSkus}
            onChange={(e) => setQ(e.target.value)}
            placeholder="상품·옵션 검색"
            style={{ width: '100%', height: '34px', borderRadius: '8px', border: '1px solid #d1d5db', padding: '0 8px', fontSize: '13px', boxSizing: 'border-box' }}
          />
          {matches.map((s) => (
            <button
              key={s.skuId}
              type="button"
              onClick={() => { onChange({ ...draft, picked: [...draft.picked, s] }); setQ(''); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: '4px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #e5e7eb', backgroundColor: '#fff', fontSize: '12px' }}
            >
              + {label(s)}
            </button>
          ))}
          {draft.picked.map((p) => (
            <div key={p.skuId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
              <span>{label(p)}</span>
              <button
                type="button"
                aria-label={`${label(p)} 빼기`}
                onClick={() => onChange({ picked: draft.picked.filter((x) => x.skuId !== p.skuId), qty: draft.qty })}
                style={{ border: 'none', background: 'none', color: '#b91c1c', fontWeight: 700, fontSize: '14px' }}
              >
                ×
              </button>
            </div>
          ))}
          {draft.picked.length === 1 && <div style={{ marginTop: '6px' }}>{expText} 전부 이 SKU로 입고합니다</div>}
        </>
      )}
      {choices.length >= 2 && (
        <>
          <div style={{ fontWeight: 700, margin: options.candidates.length === 0 ? '8px 0 6px' : '0 0 6px' }}>옵션별 수량 — 합 {expText}</div>
          {choices.map((c) => (
            <label key={c.skuId} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <span style={{ flex: 1 }}>{label(c)}</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                aria-label={`${label(c)} 수량`}
                value={draft.qty[c.skuId] ?? ''}
                onChange={(e) => onChange({ ...draft, qty: { ...draft.qty, [c.skuId]: e.target.value } })}
                style={{ width: '70px', height: '32px', borderRadius: '8px', border: '1px solid #d1d5db', padding: '0 8px', fontSize: '13px', textAlign: 'right' }}
              />
            </label>
          ))}
          <div style={{ marginTop: '6px', fontWeight: 700, color: exp && sum !== exp.qty ? '#b91c1c' : '#1a7f37' }}>
            나눈 합 {sum}개{exp ? ` / ${exp.qty}개` : ''}
          </div>
        </>
      )}
    </div>
  );
}
