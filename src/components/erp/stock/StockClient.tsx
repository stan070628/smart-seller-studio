'use client';

/**
 * 재고현황(PC). 원장 재고를 보고 고친다 — 칸 편집(바로 저장) · 실사 모드(여러 칸 담아 한 번에) ·
 * RG 실재고 대조(보기 → 행 반영/일괄 반영) · 실사표 불러오기(기초재고) · 엑셀↓ · 우측 입출 이력.
 * C11 축소판이다. ERP 틀·TanStack은 2단계.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ClipboardCheck, Download, RefreshCw, Search, Upload } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import {
  Kpi, btnStyle, disabledBtnStyle, dividerStyle, inputStyle, primaryBtnStyle,
  qFieldStyle, qLabelStyle, qTitleStyle, qValStyle, queryPanelStyle, statNumStyle, statusBarStyle,
} from '@/components/orders/erp-ui';
import StockTable from './StockTable';
import HistoryPanel from './HistoryPanel';
import CsvImportDialog from './CsvImportDialog';
import CountQueuePanel from './CountQueuePanel';
import { fetchRecon, fetchStock, postAdjust, postRgApply, postRgArrive } from './api';
import {
  computeKpis, defaultCost, filterGroups, filterRows, filtersActive, groupRows, parseRecon, rgArriveQty, rgDiff, stageKey, summarizeStaged,
  toAdjustItems, toExportCsv, won,
  type EditLocation, type Filters, type RgRecon, type StagedEdit, type StockRow,
} from './stock-view';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${won(Math.abs(n))}`;

export default function StockClient() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ q: '', onlyStocked: false, onlyRgMismatch: false });
  const [recon, setRecon] = useState<RgRecon | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ skuId: number; location: EditLocation } | null>(null);
  const [countMode, setCountMode] = useState(false);
  const [staged, setStaged] = useState<Map<string, StagedEdit>>(new Map());
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchStock();
    setLoading(false);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setRows(r.data);
    setHistoryKey((k) => k + 1);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 진입 시 원장을 불러온다(불러오는 중 표시가 목적)
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => filterRows(rows, filters, recon), [rows, filters, recon]);
  const groups = useMemo(() => groupRows(rows, recon), [rows, recon]);
  const views = useMemo(() => filterGroups(groups, filters, recon), [groups, filters, recon]);
  const kpi = useMemo(() => computeKpis(rows, recon), [rows, recon]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.skuId, r])), [rows]);
  const mismatches = useMemo(() => (recon ? rows.filter((r) => (rgDiff(r, recon) ?? 0) !== 0) : []), [rows, recon]);
  const selectedRow = selected === null ? null : rowById.get(selected) ?? null;

  /** 한 칸 바로 저장. 성공하면 true */
  async function saveOne(edit: StagedEdit): Promise<boolean> {
    setSaving(true);
    const r = await postAdjust(toAdjustItems([edit], uuidv4));
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      if (r.code === 'stale') await load();
      return false;
    }
    const res = r.data[0];
    toast.success(
      res.outcome === 'noop' ? '차이 없음 — 센 기록만 남겼습니다'
        : res.outcome === 'duplicate' ? '이미 저장된 요청입니다'
          : `${res.kind === 'opening' ? '기초재고' : '조정'} ${res.qty > 0 ? '+' : ''}${res.qty} 기록했습니다`,
    );
    setEditing(null);
    await load();
    return true;
  }

  function stage(edit: StagedEdit) {
    setStaged((m) => {
      const n = new Map(m);
      const k = stageKey(edit.skuId, edit.location);
      // 차이 없는 지금 개수도 담는다 — 저장하면 센 기록이 남는다
      n.set(k, edit);
      return n;
    });
    setEditing(null);
  }

  async function saveStaged() {
    const list = [...staged.values()];
    if (list.length === 0) return;
    const s = summarizeStaged(list, rowById);
    const ok = await confirmDialog({
      message: `실사 ${s.count}건을 저장합니다.\n\n늘림 +${won(s.plus)}개 · 줄임 −${won(s.minus)}개 · 차이 없음 ${s.same}건(센 기록만)\n평가액 영향(추정) ${signed(s.valueDelta)}원\n\n하나라도 실패하면 전부 저장되지 않습니다.`,
      confirmLabel: '저장',
    });
    if (!ok) return;
    setSaving(true);
    const r = await postAdjust(toAdjustItems(list, uuidv4));
    setSaving(false);
    if (!r.ok) {
      const bad = r.index !== undefined ? list[r.index] : undefined;
      toast.error(bad ? `${rowById.get(bad.skuId)?.name ?? bad.skuId}: ${r.error}` : r.error);
      if (r.code === 'stale' && bad) {
        setStaged((m) => { const n = new Map(m); n.delete(stageKey(bad.skuId, bad.location)); return n; });
      }
      await load();
      return;
    }
    toast.success(`${r.data.filter((x) => x.outcome === 'posted').length}건 기록 · ${r.data.filter((x) => x.outcome === 'noop').length}건 차이 없음(센 기록)`);
    setStaged(new Map());
    setCountMode(false);
    await load();
  }

  async function toggleCountMode() {
    if (countMode && staged.size > 0) {
      const ok = await confirmDialog({ message: `담아 둔 ${staged.size}건을 버리고 실사 모드를 끕니다.`, confirmLabel: '버리기', danger: true });
      if (!ok) return;
      setStaged(new Map());
    }
    setEditing(null);
    setCountMode((v) => !v);
  }

  async function loadRecon() {
    setReconLoading(true);
    const r = await fetchRecon();
    setReconLoading(false);
    if (!r.ok) { toast.error(r.error); return; }
    setRecon(parseRecon(r.data));
    const warn = r.data.issues.length + r.data.inactive.length;
    if (warn > 0) toast.error(`RG 매핑 경고 ${warn}건 — 표 위 안내를 확인하세요`);
  }

  async function applyRg(targets: StockRow[]) {
    if (!recon) return;
    const items = targets
      .map((row) => ({ row, actual: recon.actual.get(row.skuId) ?? 0 }))
      .filter((x) => x.actual !== x.row.rg);
    if (items.length === 0) return;
    const plus = items.reduce((s, x) => s + Math.max(x.actual - x.row.rg, 0), 0);
    const minus = items.reduce((s, x) => s + Math.max(x.row.rg - x.actual, 0), 0);
    const valueDelta = items.reduce((s, x) => s + (x.actual - x.row.rg) * (defaultCost(x.row) ?? 0), 0);
    // 입고중이 남은 채 RG를 늘리면 같은 물건을 두 번 센다 — 먼저 「입고 완료 옮기기」를 하라고 알린다
    const pendingArrive = items.filter((x) => rgArriveQty(x.row, recon) > 0).length;
    const ok = await confirmDialog({
      message: `RG 실재고를 원장에 반영합니다 — SKU ${items.length}개\n\n늘림 +${won(plus)}개 · 줄임 −${won(minus)}개\n평가액 영향(추정) ${signed(valueDelta)}원\n\n판매 차감(1-C2) 전이라 RG 판매도 차이로 보입니다. 확인한 것만 반영하세요.${pendingArrive > 0 ? `\n\n⚠ RG입고중이 남은 SKU ${pendingArrive}개 — 보낸 물건이 들어온 것이면 먼저 「입고 완료 옮기기」를 누르세요(반영만 하면 입고중이 남아 두 번 셉니다).` : ''}`,
      confirmLabel: '반영',
    });
    if (!ok) return;
    setSaving(true);
    const r = await postRgApply(items.map((x) => ({
      skuId: x.row.skuId, expected: x.row.rg, actual: x.actual, requestId: uuidv4(), unitCost: defaultCost(x.row),
    })));
    setSaving(false);
    if (!r.ok) { toast.error(r.error); await load(); return; }
    toast.success(`RG ${r.data.filter((x) => x.outcome === 'posted').length}건 반영했습니다`);
    await load();
  }

  /** RG 입고 완료: 입고중 → RG qty개. 이것을 먼저 하고 남은 차이만 「반영」한다(반영만 하면 입고중이 남아 두 번 센다) */
  async function arriveRg(row: StockRow, qty: number) {
    const label = row.option ? `${row.name} · ${row.option}` : row.name;
    const ok = await confirmDialog({
      message: `${label}\n\nRG입고중 ${won(row.rgInbound)}개 중 ${won(qty)}개를 RG로 옮깁니다(입고 완료).\n원장 RG ${won(row.rg)} → ${won(row.rg + qty)}개 · RG입고중 ${won(row.rgInbound)} → ${won(row.rgInbound - qty)}개`,
      confirmLabel: '옮기기',
    });
    if (!ok) return;
    setSaving(true);
    const r = await postRgArrive([{ skuId: row.skuId, qty, requestId: uuidv4() }]);
    setSaving(false);
    if (!r.ok) { toast.error(r.error); await load(); return; }
    toast.success(r.data[0]?.outcome === 'duplicate' ? '이미 옮긴 요청입니다' : `RG 입고 완료 ${won(qty)}개 옮겼습니다`);
    await load();
  }

  function exportCsv() {
    const blob = new Blob([toExportCsv(visible, recon)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `재고현황-${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const reconTime = recon ? new Date(recon.fetchedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }) : null;

  return (
    <div style={{ background: E.ground, minHeight: '100%', padding: 12, color: E.ink, fontSize: 12 }}>
      <div style={queryPanelStyle}>
        <div style={qTitleStyle}>재고현황 — 조회조건</div>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          <div style={qFieldStyle}>
            <div style={qLabelStyle}>검색</div>
            <div style={qValStyle}>
              <Search size={12} color={E.inkMute} />
              <input
                aria-label="상품·옵션·키 검색"
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                placeholder="상품·옵션·키"
                style={{ ...inputStyle, width: 220 }}
              />
            </div>
          </div>
          <div style={qFieldStyle}>
            <div style={qLabelStyle}>보기</div>
            <div style={qValStyle}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={filters.onlyStocked} onChange={(e) => setFilters({ ...filters, onlyStocked: e.target.checked })} />
                재고 있는 것만
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: recon ? 1 : 0.5 }} title={recon ? undefined : 'RG 실재고 대조 후 쓸 수 있습니다'}>
                <input type="checkbox" disabled={!recon} checked={filters.onlyRgMismatch} onChange={(e) => setFilters({ ...filters, onlyRgMismatch: e.target.checked })} />
                RG 불일치만
              </label>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', background: E.surface, border: `1px solid ${E.line}`, marginBottom: 10 }}>
        <Kpi label="총재고" value={won(kpi.total)} unit="개" />
        <Kpi label="집" value={won(kpi.self)} unit="개" />
        <Kpi label="RG입고중" value={won(kpi.rgInbound)} unit="개" />
        <Kpi label="RG(원장)" value={won(kpi.rg)} unit="개" />
        <Kpi label="평가액" value={won(kpi.value)} unit="원" />
        <Kpi
          label="RG 불일치"
          value={kpi.rgMismatch === null ? '—' : String(kpi.rgMismatch)}
          unit={kpi.rgMismatch === null ? undefined : 'SKU'}
          tone={kpi.rgMismatch ? E.loss : undefined}
          sub={reconTime ? `대조 ${reconTime}` : '대조 전'}
          last
        />
      </div>

      <CountQueuePanel rowById={rowById} busy={saving} onSave={saveOne} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={reconLoading} onClick={() => void loadRecon()} style={reconLoading ? disabledBtnStyle : btnStyle}>
          <RefreshCw size={12} /> {reconLoading ? '대조 중…' : 'RG 실재고 대조'}
        </button>
        {recon && mismatches.length > 0 && (
          <button type="button" disabled={saving} onClick={() => void applyRg(mismatches)} style={saving ? disabledBtnStyle : btnStyle}>
            불일치 {mismatches.length}건 일괄 반영
          </button>
        )}
        <div style={dividerStyle} />
        <button type="button" onClick={() => setShowImport(true)} style={btnStyle}><Upload size={12} /> 실사표 불러오기(CSV)</button>
        <button type="button" onClick={exportCsv} style={btnStyle}><Download size={12} /> 엑셀↓</button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          aria-pressed={countMode}
          onClick={() => void toggleCountMode()}
          style={countMode ? { ...btnStyle, borderColor: E.accent, color: E.accent, fontWeight: 600 } : btnStyle}
        >
          <ClipboardCheck size={12} /> 실사 모드{countMode ? ' 켜짐' : ''}
        </button>
        {countMode && (
          <button type="button" disabled={staged.size === 0 || saving} onClick={() => void saveStaged()} style={staged.size === 0 || saving ? disabledBtnStyle : primaryBtnStyle}>
            실사 {staged.size}건 저장
          </button>
        )}
      </div>

      {recon && (recon.issues.length > 0 || recon.inactive.length > 0) && (
        <div style={{ border: `1px solid ${E.warn}`, background: E.warnSoft, color: E.warn, padding: '6px 10px', marginBottom: 8, fontSize: 11.5 }}>
          {recon.issues.map((i) => <div key={`${i.kind}:${i.ref}`}>⚠ {i.kind} {i.ref} — {i.detail}</div>)}
          {recon.inactive.map((o) => <div key={`inactive:${o.skuId}`}>⚠ 보관된 SKU {o.skuId}에 RG 재고 {o.qty}개</div>)}
        </div>
      )}
      {error && <div role="alert" style={{ border: `1px solid ${E.loss}`, color: E.loss, background: E.surface, padding: '6px 10px', marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StockTable
            views={views}
            forceOpen={filtersActive(filters)}
            recon={recon}
            staged={staged}
            countMode={countMode}
            editing={editing}
            selected={selected}
            busy={saving}
            onEdit={(skuId, location) => setEditing({ skuId, location })}
            onCancelEdit={() => setEditing(null)}
            onSubmitEdit={(e) => { if (countMode) stage(e); else void saveOne(e); }}
            onSelect={setSelected}
            onRgApply={(row) => void applyRg([row])}
            onRgArrive={(row, qty) => void arriveRg(row, qty)}
          />
          <div style={statusBarStyle}>
            <span>
              표시 상품 <span style={statNumStyle}>{views.length}</span> · SKU <span style={statNumStyle}>{visible.length}</span> / {rows.length} SKU
            </span>
            {loading && <span>불러오는 중…</span>}
            {countMode && <span style={{ color: E.accent }}>실사 모드 — 칸을 고치면 담기고, 「변경 저장」에서 한 번에 기록합니다</span>}
          </div>
        </div>
        {selectedRow && (
          <HistoryPanel row={selectedRow} refreshKey={historyKey} onClose={() => setSelected(null)} onChanged={() => void load()} />
        )}
      </div>

      {showImport && (
        <CsvImportDialog onClose={() => setShowImport(false)} onCommitted={() => { setShowImport(false); void load(); }} />
      )}
    </div>
  );
}
