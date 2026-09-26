'use client';

/**
 * 실사표 불러오기(기초재고). 파일 → 실사 시각 → 미리보기(합계·오류·경고·단가) → 단가 채우기 → 다시 미리보기 → 불러오기.
 * 입력을 고치면 미리보기가 낡은 것으로 보고 불러오기를 막는다 — 본 숫자와 적재되는 숫자가 같아야 한다.
 */
import React, { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { bandStyle, btnStyle, disabledBtnStyle, inputStyle, numTdStyle, primaryBtnStyle, thStyle } from '@/components/orders/erp-ui';
import type { ImportSummary } from '@/lib/erp/ledger/opening-import';
import { postImport } from './api';
import { localInputToIso, toKstLocalInput, won } from './stock-view';

const SOURCE_LABEL: Record<string, string> = { override: '입력', history: '옛 입고', csv: '실사표', none: '없음' };

interface Props {
  onClose: () => void;
  onCommitted: () => void;
}

export default function CsvImportDialog({ onClose, onCommitted }: Props) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [countedAt, setCountedAt] = useState(toKstLocalInput(new Date()));
  const [costInput, setCostInput] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function touch() {
    if (preview) setStale(true);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    setCsv(await f.text());
    setPreview(null);
    setStale(false);
  }

  function overrides(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const [k, v] of Object.entries(costInput)) if (/^\d+$/.test(v.trim())) o[k] = Number(v.trim());
    return o;
  }

  async function run(commit: boolean) {
    if (!csv) return;
    if (commit && preview) {
      const t = preview.totals;
      const ok = await confirmDialog({
        message: `기초재고를 불러옵니다 — 전표 ${t.entries}건\n\n집 ${won(t.self)} · RG입고중 ${won(t.rgInbound)} · RG ${won(t.rg)}개\n평가액 ${won(t.value)}원\n\nRG는 지금 쿠팡 API 값으로 다시 읽어 적재합니다. 원장에 전표가 있는 SKU는 빠집니다.`,
        confirmLabel: '불러오기',
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    const r = await postImport({ csv, fileName, countedAt: localInputToIso(countedAt), unitCostOverrides: overrides(), commit });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setPreview(r.data);
    setStale(false);
    if (commit && r.data.committed > 0) {
      toast.success(`기초재고 ${r.data.committed}건을 불러왔습니다`);
      onCommitted();
    } else if (commit) {
      setError(r.data.errors.length > 0 ? '오류가 있어 불러오지 않았습니다' : '불러올 전표가 없습니다');
    }
  }

  const canCommit = !!preview && !stale && preview.errors.length === 0 && preview.totals.entries > 0 && !busy;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)' }} />
      <div
        role="dialog"
        aria-label="실사표 불러오기"
        style={{ position: 'relative', width: 760, maxWidth: 'calc(100vw - 32px)', maxHeight: '88vh', overflow: 'auto', background: E.surface, border: `1px solid ${E.line}`, color: E.ink, fontSize: 12 }}
      >
        <div style={{ ...bandStyle, justifyContent: 'space-between' }}>
          <span>실사표 불러오기 — 기초재고</span>
          <button type="button" aria-label="닫기" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }}><X size={13} /></button>
        </div>
        <div style={{ padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ ...btnStyle, position: 'relative' }}>
            <Upload size={12} /> {fileName || 'CSV 고르기'}
            <input type="file" accept=".csv,text/csv" aria-label="실사표 CSV" onChange={(e) => void onFile(e.target.files?.[0])} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            실사를 마친 시각
            <input type="datetime-local" aria-label="실사를 마친 시각" value={countedAt} onChange={(e) => { setCountedAt(e.target.value); touch(); }} style={inputStyle} />
          </label>
          <button type="button" disabled={!csv || busy} onClick={() => void run(false)} style={!csv || busy ? disabledBtnStyle : btnStyle}>
            {busy ? '읽는 중…' : '미리보기'}
          </button>
        </div>
        <div style={{ padding: '0 12px 8px', color: E.inkSub, fontSize: 11 }}>
          형식은 1-B 실사표(`docs/erp/opening-count-*.csv`)와 같습니다. self_count가 빈 행은 건너뛰고, 원장에 전표가 있는 SKU는 「조정」으로 고칩니다.
        </div>
        {error && <div role="alert" style={{ margin: '0 12px 8px', padding: 8, border: `1px solid ${E.loss}`, color: E.loss }}>{error}</div>}

        {preview && (
          <div style={{ padding: '0 12px 12px' }}>
            <div style={{ display: 'flex', gap: 14, padding: '6px 0', fontFamily: E.mono }}>
              <span>전표 {preview.totals.entries}건</span>
              <span>집 {won(preview.totals.self)}</span>
              <span>RG입고중 {won(preview.totals.rgInbound)}</span>
              <span>RG {won(preview.totals.rg)}</span>
              <span>평가액 {won(preview.totals.value)}원</span>
              {stale && <span style={{ color: E.warn }}>입력이 바뀌었습니다 — 다시 미리보기</span>}
            </div>
            {preview.errors.length > 0 && (
              <div style={{ border: `1px solid ${E.loss}`, color: E.loss, padding: 8, marginBottom: 8 }}>
                <b>오류 {preview.errors.length}건 — 고쳐야 불러옵니다</b>
                {preview.errors.map((m) => <div key={m}>· {m}</div>)}
              </div>
            )}
            {preview.warnings.length > 0 && (
              <div style={{ border: `1px solid ${E.warn}`, background: E.warnSoft, color: E.warn, padding: 8, marginBottom: 8 }}>
                <b>경고 {preview.warnings.length}건</b>
                {preview.warnings.map((m) => <div key={m}>· {m}</div>)}
              </div>
            )}
            {preview.excluded.length > 0 && (
              <details style={{ marginBottom: 8 }}>
                <summary>불러오지 않는 행 {preview.excluded.length}건</summary>
                {preview.excluded.map((x) => <div key={x.skuKey} style={{ color: E.inkSub }}>· {x.skuKey} — {x.reason}</div>)}
              </details>
            )}
            {preview.costs.length > 0 && (
              <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 8 }}>
                <thead>
                  <tr>{['SKU', '보유', '적재 단가', '출처', '단가 입력'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.costs.map((c) => (
                    <tr key={c.skuId} style={{ background: c.unitCost === null ? E.accentSoft : undefined }}>
                      <td style={{ ...numTdStyle, textAlign: 'left', fontFamily: 'inherit' }}>{c.skuKey}</td>
                      <td style={numTdStyle}>{won(c.onHand)}</td>
                      <td style={numTdStyle}>{c.unitCost === null ? '—' : won(c.unitCost)}</td>
                      <td style={{ ...numTdStyle, fontFamily: 'inherit' }}>{SOURCE_LABEL[c.source] ?? c.source}</td>
                      <td style={numTdStyle}>
                        <input
                          aria-label={`${c.skuKey} 단가`}
                          inputMode="numeric"
                          value={costInput[c.skuKey] ?? ''}
                          placeholder={c.unitCost === null ? '필수' : '바꿀 때만'}
                          onChange={(e) => { setCostInput((m) => ({ ...m, [c.skuKey]: e.target.value })); touch(); }}
                          style={{ ...inputStyle, width: 90, textAlign: 'right', fontFamily: E.mono }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button type="button" onClick={onClose} style={btnStyle}>닫기</button>
              <button type="button" disabled={!canCommit} onClick={() => void run(true)} style={canCommit ? primaryBtnStyle : disabledBtnStyle}>
                불러오기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
