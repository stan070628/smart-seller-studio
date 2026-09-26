'use client';

/**
 * 영수증 줄 하나의 재고 SKU 분배. 확정 때 원장 「집」 입고로 들어갈 옵션과 수량을 정한다.
 * 후보 1개 = 자동(안내만 · 「다른 SKU로 바꾸기」로 아무 활성 SKU나 고를 수 있다) · 후보 여럿 = 옵션별 수량 ·
 * 후보 없음 = SKU를 검색해 고른다. 사람이 나누거나 고른 연결만 확정 때 기억된다(자동 입고는 기억하지 않는다).
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
  const [swapping, setSwapping] = useState(false);
  const exp = options.expectedQty;
  const expText = exp ? `${exp.qty}개${exp.approx ? '(소분 추정 — 이월에 따라 달라질 수 있습니다)' : ''}` : '입고 수량';

  const needle = q.trim().toLowerCase();
  const search = (exclude: number[]) => (needle
    ? allSkus.filter((s) => `${s.name} ${s.option} ${s.key}`.toLowerCase().includes(needle) && !exclude.includes(s.skuId)).slice(0, 8)
    : []);
  const searchInput = (aria: string) => (
    <input
      aria-label={aria}
      value={q}
      onFocus={onNeedSkus}
      onChange={(e) => setQ(e.target.value)}
      placeholder="상품·옵션 검색"
      style={{ width: '100%', height: '34px', borderRadius: '8px', border: '1px solid #d1d5db', padding: '0 8px', fontSize: '13px', boxSizing: 'border-box' }}
    />
  );
  const matchButton = (s: SkuCandidateView, onPick: () => void) => (
    <button
      key={s.skuId}
      type="button"
      onClick={() => { onPick(); setQ(''); }}
      style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: '4px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #e5e7eb', backgroundColor: '#fff', fontSize: '12px' }}
    >
      + {label(s)}
    </button>
  );
  const linkButton = { border: 'none', background: 'none', padding: 0, marginLeft: '8px', color: '#1d4ed8', fontSize: '12px', fontWeight: 700, textDecoration: 'underline' } as const;

  if (options.candidates.length === 1) {
    const only = options.candidates[0];
    if (draft.override) {
      return (
        <div style={box}>
          재고: {label(draft.override)} · {expText} 전부 (바꿈)
          <button type="button" style={linkButton} onClick={() => { onChange({ ...draft, override: null }); setSwapping(false); }}>되돌리기</button>
        </div>
      );
    }
    return (
      <div style={box}>
        재고: {label(only)} · {expText} 자동
        {!swapping && <button type="button" style={linkButton} onClick={() => setSwapping(true)}>다른 SKU로 바꾸기</button>}
        {swapping && (
          <div style={{ marginTop: '6px' }}>
            {searchInput('바꿀 재고 SKU 검색')}
            {search([only.skuId]).map((s) => matchButton(s, () => { onChange({ ...draft, override: s }); setSwapping(false); }))}
          </div>
        )}
      </div>
    );
  }

  const choices = choicesOf(options, draft);
  const matches = search(draft.picked.map((p) => p.skuId));
  const sum = splitSum(choices, draft);

  return (
    <div style={box}>
      {options.candidates.length === 0 && (
        <>
          <div style={{ fontWeight: 700, color: '#b45309', marginBottom: '6px' }}>연결된 재고 SKU가 없습니다 — 골라 주세요(확정 때 기억합니다)</div>
          {searchInput('재고 SKU 검색')}
          {matches.map((s) => matchButton(s, () => onChange({ ...draft, picked: [...draft.picked, s] })))}
          {draft.picked.map((p) => (
            <div key={p.skuId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
              <span>{label(p)}</span>
              <button
                type="button"
                aria-label={`${label(p)} 빼기`}
                onClick={() => onChange({ ...draft, picked: draft.picked.filter((x) => x.skuId !== p.skuId) })}
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
