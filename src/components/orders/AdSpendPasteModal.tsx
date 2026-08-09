'use client';

/**
 * 쿠팡 광고비 붙여넣기 모달
 *
 * 쿠팡 광고관리 화면(모든 캠페인 > 광고)의 표를 드래그 복사해 붙여넣으면
 * 상품별 집행 광고비를 읽어 그날 광고비로 저장한다.
 *
 * 광고 표에는 날짜 열이 없어 앱이 기간을 알 수 없다. 그래서 **하루치를 조회한
 * 화면**을 붙여넣는 것을 전제로 하고, 날짜는 사용자가 위에서 고른다.
 *
 * 캠페인이 여러 개거나 표가 여러 페이지면 계속 붙여넣어 누적한다. 붙여넣을
 * 때마다 목록에 합산되고, 저장은 마지막에 한 번만 일어난다. 같은 상품이 로켓
 * 그로스·윙 두 채널로 광고돼도 서버가 한 상품으로 합쳐 저장한다.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { X, ClipboardPaste, Trash2, AlertTriangle } from 'lucide-react';
import { parseCoupangAdTable, type ParsedAdRow } from '@/lib/cost-management/parse-coupang-ad';
import { toast } from '@/components/ui/toast';

interface MatchedRow {
  external_id: string;
  product_id: string;
  product_name: string;
  ad_spend: number;
}
interface ResolveResult {
  matched: MatchedRow[];
  unmatched: { external_id: string; ad_spend: number }[];
  matched_total: number;
  unmatched_total: number;
}

interface ProductOption {
  id: string;
  product_name: string;
}

interface Props {
  onClose: () => void;
  /** 저장이 끝나면 부모가 목록을 다시 읽는다 */
  onSaved: () => void;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');
const fmtOpt = (n: number | null) => (n === null ? '—' : n.toLocaleString('ko-KR'));

/** 파싱 결과를 API 페이로드로 옮긴다 */
function toItem(r: ParsedAdRow) {
  return {
    external_id: r.externalId,
    ad_spend: r.adSpend,
    impressions: r.impressions,
    clicks: r.clicks,
    ad_orders: r.adOrders,
    ad_revenue: r.adRevenue,
  };
}

/** 클릭률·전환율·ROAS는 저장하지 않고 화면에서 계산한다 — 원본 지표에서 늘 유도된다 */
function rate(part: number | null, whole: number | null): string {
  if (part === null || whole === null || whole === 0) return '—';
  return `${((part / whole) * 100).toFixed(2)}%`;
}
function roas(revenue: number | null, spend: number): string {
  if (revenue === null || spend === 0) return '—';
  return `${Math.round((revenue / spend) * 100).toLocaleString('ko-KR')}%`;
}

/** KST 기준 어제 — 광고 리포트는 보통 전날 것을 보고 넣는다 */
function yesterdayKst(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000 - 24 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

export default function AdSpendPasteModal({ onClose, onSaved }: Props) {
  const [adDate, setAdDate] = useState(yesterdayKst());
  const [rows, setRows] = useState<ParsedAdRow[]>([]);
  const [pasteLog, setPasteLog] = useState<string[]>([]);
  const [manualText, setManualText] = useState('');
  const [resolve, setResolve] = useState<ResolveResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 미매칭 행을 상품에 연결할 때 쓰는 선택지 */
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [linking, setLinking] = useState<string | null>(null);
  /** 연결 직후 매칭을 다시 물어보게 하는 신호 */
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/cost-management/products/options');
        const json = await res.json();
        if (json.success) setOptions(json.data);
      } catch {
        // 연결 기능만 못 쓸 뿐 저장에는 지장이 없다
      }
    })();
  }, []);

  /** 붙여넣은 표를 누적 목록에 합친다 */
  const ingest = useCallback((text: string) => {
    const { rows: parsed, headerDetected, warnings } = parseCoupangAdTable(text);
    if (parsed.length === 0) {
      toast.error(warnings[0] ?? '표를 읽지 못했습니다.');
      return;
    }
    let added = 0;
    let merged = 0;
    setRows((prev) => {
      const map = new Map(prev.map((r) => [r.externalId, { ...r }]));
      for (const p of parsed) {
        const cur = map.get(p.externalId);
        if (cur) {
          cur.adSpend += p.adSpend;
          if (!cur.productName) cur.productName = p.productName;
          merged++;
        } else {
          map.set(p.externalId, { ...p });
          added++;
        }
      }
      return Array.from(map.values());
    });
    setPasteLog((prev) => [
      ...prev,
      `${prev.length + 1}번째 붙여넣기 — ${added}개 추가${merged > 0 ? `, ${merged}개 기존 상품에 합산` : ''}${headerDetected ? '' : ' (헤더 없음 · 기본 열 순서 가정)'}`,
    ]);
    for (const w of warnings) toast.error(w);
  }, []);

  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    e.preventDefault();
    ingest(text);
    setManualText('');
  };

  // 누적 목록이 바뀌면 서버에 매칭만 물어본다 (dry_run — 저장하지 않는다)
  useEffect(() => {
    if (rows.length === 0) { setResolve(null); return; }
    let alive = true;
    setResolving(true);
    (async () => {
      try {
        const res = await fetch('/api/cost-management/ad-spend/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ad_date: adDate,
            dry_run: true,
            items: rows.map(toItem),
          }),
        });
        const json = await res.json();
        if (alive) setResolve(json.success ? json.data : null);
        if (!json.success) toast.error(json.error ?? '상품 매칭에 실패했습니다.');
      } finally {
        if (alive) setResolving(false);
      }
    })();
    return () => { alive = false; };
  }, [rows, adDate, refreshKey]);

  /**
   * 미매칭 광고 ID를 상품에 연결한다. 한 번 연결해두면 다음 붙여넣기부터는
   * 자동으로 잡힌다 — 채널설정 탭까지 가지 않아도 되게 여기서 처리한다.
   */
  async function linkProduct(row: ParsedAdRow, productId: string, channelType: string) {
    setLinking(row.externalId);
    try {
      const res = await fetch(`/api/cost-management/products/${productId}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_type: channelType, external_id: Number(row.externalId) }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('상품에 연결했습니다. 다음부터는 자동으로 잡힙니다.');
        setRefreshKey((k) => k + 1);
      } else {
        toast.error(json.error ?? '연결에 실패했습니다.');
      }
    } finally {
      setLinking(null);
    }
  }

  const matchedById = new Map((resolve?.matched ?? []).map((m) => [m.external_id, m]));
  const matchedCount = resolve?.matched.length ?? 0;
  const unmatchedCount = resolve?.unmatched.length ?? 0;

  /**
   * 광고비와 전환 매출이 똑같은 행 — 열을 잘못 집었다는 뜻이다. ROAS가 정확히
   * 100%인 상품이 여럿 나오는 일은 실무에서 없다. 두 번 당한 사고라 저장을 막는다.
   */
  const suspectRows = rows.filter((r) => r.adSpend > 0 && r.adRevenue !== null && r.adSpend === r.adRevenue);
  const columnMisread = suspectRows.length > 0;
  const canSave = matchedCount > 0 && !saving && !resolving && !columnMisread;

  async function save() {
    if (matchedCount === 0) { toast.error('저장할 상품이 없습니다.'); return; }
    if (columnMisread) {
      toast.error('광고비와 전환매출이 같은 행이 있습니다. 열을 잘못 읽은 것이라 저장하지 않습니다.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/cost-management/ad-spend/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ad_date: adDate,
          items: rows.map(toItem),
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(
          `${adDate} 광고비 ${json.data.saved_products}개 상품 저장 (합계 ${fmt(json.data.matched_total)}원)`
            + (json.data.unmatched.length > 0 ? ` · 미매칭 ${json.data.unmatched.length}건 제외` : ''),
        );
        onSaved();
      } else {
        toast.error(json.error ?? '저장에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  const th: React.CSSProperties = { padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#27272a', fontSize: 11, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '6px 10px', textAlign: 'right', fontSize: 12, color: '#3f3f46', fontVariantNumeric: 'tabular-nums' };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 1020, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid #eee' }}>
          <ClipboardPaste size={18} color="#7c3aed" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#18181b' }}>쿠팡 광고비 붙여넣기</div>
            <div style={{ fontSize: 11, color: '#71717a' }}>광고관리 표를 드래그 복사해 붙여넣으면 상품별로 자동 입력됩니다</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={18} color="#71717a" />
          </button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {/* 날짜 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#3f3f46' }}>광고 집행일</label>
            <input
              type="date"
              value={adDate}
              onChange={(e) => setAdDate(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #e4e4e7', fontSize: 12, color: '#18181b' }}
            />
            <span style={{ fontSize: 11, color: '#a1a1aa' }}>
              쿠팡 광고에서 <b>이 날짜 하루만</b> 조회한 화면을 붙여넣어 주세요
            </span>
          </div>

          {/* 붙여넣기 영역 */}
          <textarea
            onPaste={onPaste}
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="여기를 클릭하고 Ctrl+V (⌘V) — 캠페인이 여러 개면 계속 붙여넣으세요"
            style={{ width: '100%', height: 72, padding: 10, borderRadius: 8, border: '1px dashed #c4b5fd', background: '#faf5ff', fontSize: 12, color: '#3f3f46', resize: 'vertical', fontFamily: 'inherit' }}
          />
          {manualText.trim().length > 0 && (
            <button
              onClick={() => { ingest(manualText); setManualText(''); }}
              style={{ marginTop: 6, padding: '5px 12px', borderRadius: 6, border: '1px solid #ddd6fe', background: '#fff', color: '#7c3aed', fontSize: 11, cursor: 'pointer' }}
            >
              위 내용 분석하기
            </button>
          )}

          {/* 붙여넣기 이력 */}
          {pasteLog.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#71717a', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {pasteLog.map((l, i) => <div key={i}>· {l}</div>)}
            </div>
          )}

          {/* 미리보기 */}
          {rows.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#18181b' }}>
                  미리보기 {resolving && <span style={{ fontWeight: 400, color: '#a1a1aa' }}>· 상품 확인 중…</span>}
                </span>
                <button
                  onClick={() => { setRows([]); setPasteLog([]); }}
                  style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 6, border: '1px solid #e4e4e7', background: '#fff', fontSize: 11, cursor: 'pointer', color: '#71717a' }}
                >
                  전체 지우기
                </button>
              </div>

              {columnMisread && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                  <AlertTriangle size={14} color="#b91c1c" style={{ marginTop: 1, flexShrink: 0 }} />
                  <div style={{ fontSize: 11, color: '#7f1d1d', lineHeight: 1.6 }}>
                    <b>광고비 열을 잘못 읽었습니다 ({suspectRows.length}개 행).</b> 광고비와 전환매출이 같은 값입니다.
                    <br />
                    쿠팡 표를 <b>헤더 줄까지 포함해</b> 다시 드래그해 복사한 뒤, 전체 지우기 후 다시 붙여넣어 주세요. 저장은 막아뒀습니다.
                  </div>
                </div>
              )}

              <div style={{ border: '1px solid #e5e5e5', borderRadius: 8, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
                      <th style={{ ...th, textAlign: 'left' }}>상품</th>
                      <th style={th}>노출</th>
                      <th style={th}>클릭</th>
                      <th style={th}>클릭률</th>
                      <th style={th}>전환</th>
                      <th style={th}>전환매출</th>
                      <th style={th}>광고비</th>
                      <th style={th}>ROAS</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const m = matchedById.get(r.externalId);
                      const unknown = !resolving && resolve !== null && !m;
                      return (
                        <tr key={r.externalId} style={{ borderBottom: '1px solid #f4f4f5', background: unknown ? '#fff7ed' : undefined }}>
                          <td style={{ ...td, textAlign: 'left', maxWidth: 300, minWidth: 220 }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {unknown && <AlertTriangle size={11} color="#c2410c" style={{ verticalAlign: -1, marginRight: 4 }} />}
                              {m?.product_name || r.productName || '(이름 없음)'}
                            </div>
                            {unknown && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                                <span style={{ fontSize: 10, color: '#c2410c', whiteSpace: 'nowrap' }}>연결 안 됨 →</span>
                                <select
                                  defaultValue=""
                                  disabled={linking === r.externalId}
                                  onChange={(e) => {
                                    if (!e.target.value) return;
                                    linkProduct(r, e.target.value, r.channelType ?? 'coupang_rg');
                                  }}
                                  style={{ maxWidth: 280, padding: '3px 5px', borderRadius: 5, border: '1px solid #fed7aa', background: '#fff', fontSize: 11, color: '#3f3f46' }}
                                >
                                  <option value="">
                                    {linking === r.externalId ? '연결 중…' : '원가관리 상품에 연결…'}
                                  </option>
                                  {options.map((o) => (
                                    <option key={o.id} value={o.id}>{o.product_name}</option>
                                  ))}
                                </select>
                                <span style={{ fontSize: 10, color: '#a1a1aa', whiteSpace: 'nowrap' }}>
                                  {r.channelType === 'coupang_wing' ? '윙' : r.channelType === 'coupang_rg' ? 'RG' : 'RG(추정)'}
                                </span>
                              </div>
                            )}
                          </td>
                          <td style={{ ...td, color: '#71717a', fontSize: 11 }}>{fmtOpt(r.impressions)}</td>
                          <td style={{ ...td, color: '#71717a', fontSize: 11 }}>{fmtOpt(r.clicks)}</td>
                          <td style={{ ...td, color: '#71717a', fontSize: 11 }}>{rate(r.clicks, r.impressions)}</td>
                          <td style={{ ...td, color: '#71717a', fontSize: 11 }}>{fmtOpt(r.adOrders)}</td>
                          <td style={{ ...td, color: r.adRevenue ? '#16a34a' : '#a1a1aa', fontSize: 11 }}>{fmtOpt(r.adRevenue)}</td>
                          <td style={{ ...td, fontWeight: 600, color: r.adSpend > 0 ? '#7c3aed' : '#a1a1aa' }}>{fmt(r.adSpend)}원</td>
                          <td style={{ ...td, fontSize: 11, color: '#3f3f46' }}>{roas(r.adRevenue, r.adSpend)}</td>
                          <td style={{ ...td, width: 32 }}>
                            <button
                              onClick={() => setRows((prev) => prev.filter((x) => x.externalId !== r.externalId))}
                              title="이 행 빼기"
                              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2 }}
                            >
                              <Trash2 size={12} color="#ef4444" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 8, fontSize: 12, color: '#3f3f46', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>저장 대상 <b>{matchedCount}개</b> · 합계 <b style={{ color: '#7c3aed' }}>{fmt(resolve?.matched_total ?? 0)}원</b></span>
                {unmatchedCount > 0 && (
                  <span style={{ color: '#c2410c' }}>
                    미매칭 {unmatchedCount}개 ({fmt(resolve?.unmatched_total ?? 0)}원) — 위에서 상품을 골라 연결하면 이번 저장부터 포함됩니다
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderTop: '1px solid #eee', background: '#fafafa' }}>
          <span style={{ fontSize: 11, color: '#71717a' }}>
            저장하면 <b>{adDate}</b> 광고비를 덮어씁니다. 0원도 그대로 기록됩니다.
          </span>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: 8, border: '1px solid #e4e4e7', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#3f3f46' }}
          >
            취소
          </button>
          <button
            onClick={save}
            disabled={saving || resolving || matchedCount === 0 || columnMisread}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600,
              background: canSave ? '#7c3aed' : '#d4d4d8',
              color: canSave ? '#fff' : '#71717a',
              cursor: canSave ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? '저장 중…' : columnMisread ? '열 오독 — 저장 불가' : `${matchedCount}개 상품 저장`}
          </button>
        </div>
      </div>
    </div>
  );
}
