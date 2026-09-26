'use client';

/**
 * 휴대폰 재고 수정. 「오늘 셀 목록」(집 N개) 카드로 시작한다(결정 5) → 카드 → 위치 탭(집·RG입고중) → 지금 개수(−/+) · 사유 · 메모 → 저장.
 * 목록 밖 SKU는 검색으로 찾는다. 개수가 같아도 저장하면 센 기록(erp.stock_counts)이 남는다.
 * 목록은 열 때 한 번 받고, 집에서 센 카드는 화면에서 뺀다 — 다시 받으면 센 만큼 다음 SKU가 채워져 「오늘 N개」가 끝나지 않는다.
 * PC와 같은 API(/api/erp/stock/adjust)를 쓴다. RG는 여기서 고치지 않는다(PC의 RG 실재고 대조로만).
 * 영수증 화면 틀: 480px · 상단 52px(레이아웃) · 하단 고정 버튼.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { REASON_LABEL, USER_REASONS, type UserReason } from '@/lib/erp/ledger/adjust';
import type { RecentAdjust } from '@/lib/erp/stock/queries';
import { DEFAULT_QUEUE_N, kstDate } from '@/lib/erp/stock/count-queue';
import { fetchCountQueue, fetchRecent, fetchStock, postAdjust } from './api';
import { LOC_LABEL, defaultCost, filterRows, fmtKst, onHandAt, toAdjustItems, won, type EditLocation, type StockRow } from './stock-view';

const TABS: EditLocation[] = ['self', 'rg_inbound'];
// 다크 테마 전역 스타일(body color: 밝은 회색)이 /m으로 새어 들어와 글자가 거의 안 보였다 —
// 여기서 밝은 배경에 맞는 글자색을 명시로 고정한다(placeholder는 아래 .ms-input 스코프 스타일).
const field = { width: '100%', height: '40px', borderRadius: '8px', border: '1px solid #d1d5db', padding: '0 10px', fontSize: '14px', boxSizing: 'border-box', backgroundColor: '#fff', color: '#111827' } as const;
const card = { backgroundColor: '#fff', borderRadius: '12px', padding: '12px', border: '1px solid #e5e7eb', marginBottom: '8px' } as const;
const sectionTitle = { fontSize: '13px', fontWeight: 700, color: '#111827', margin: '4px 0 6px' } as const;

export default function MobileStock() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [recent, setRecent] = useState<RecentAdjust[]>([]);
  const [queue, setQueue] = useState<StockRow[] | null>(null);
  const [queueTotal, setQueueTotal] = useState(0);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [loc, setLoc] = useState<EditLocation>('self');
  const [count, setCount] = useState(0);
  const [reason, setReason] = useState<UserReason>('count_diff');
  const [note, setNote] = useState('');
  const [costRaw, setCostRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([fetchStock(), fetchRecent(5)]);
    if (s.ok) setRows(s.data);
    else setMsg({ ok: false, text: s.error });
    if (r.ok) setRecent(r.data);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 진입 시 원장을 불러온다(불러오는 중 표시가 목적)
  useEffect(() => { void load(); }, [load]);

  // 오늘 셀 목록은 열 때 한 번만 받는다
  useEffect(() => {
    let alive = true;
    void fetchCountQueue(DEFAULT_QUEUE_N).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        setMsg({ ok: false, text: r.error });
        return;
      }
      setQueue(r.data.items);
      setQueueTotal(r.data.items.length);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 최신 원장 값(rows)을 먼저 쓴다 — 목록 카드는 열 때의 값이다
  const row = sel === null ? null : rows.find((r) => r.skuId === sel) ?? queue?.find((r) => r.skuId === sel) ?? null;
  const onHand = row ? onHandAt(row, loc) : 0;
  // row.hasLedger는 SKU 전체 기준이라 그 위치가 정확히 비어 있는지 화면은 모른다 — 서버(adjust-store)가
  // (SKU·위치) 단위로 다시 확인한다. PC EditCell과 같은 근사치로 안내·사유 숨김만 여기서 다룬다.
  const locationEmpty = row ? !row.hasLedger : false;

  function pick(r: StockRow, l: EditLocation) {
    const fresh = rows.find((x) => x.skuId === r.skuId) ?? r;
    setSel(fresh.skuId);
    setLoc(l);
    setCount(onHandAt(fresh, l));
    const c = defaultCost(fresh);
    setCostRaw(c === null ? '' : String(c));
    setMsg(null);
  }

  const results = useMemo(
    () => (q.trim() ? filterRows(rows, { q, onlyStocked: false, onlyRgMismatch: false }, null).slice(0, 40) : []),
    [rows, q],
  );

  const diff = count - onHand;
  const cost = /^\d+$/.test(costRaw.trim()) ? Number(costRaw.trim()) : null;
  const canSave = !!row && !(diff > 0 && cost === null) && !saving;

  async function save() {
    if (!row || !canSave) return;
    setSaving(true);
    setMsg(null);
    const r = await postAdjust(toAdjustItems(
      [{ skuId: row.skuId, location: loc, mode: 'count', value: count, expected: onHand, reason, note: note.trim(), unitCost: diff > 0 ? cost : null }],
      uuidv4,
    ));
    setSaving(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.error });
      if (r.code === 'stale') await load();
      return;
    }
    setMsg({
      ok: true,
      text: diff === 0
        ? `${row.name} ${LOC_LABEL[loc]} ${won(count)}개 맞습니다 — 센 기록을 저장했습니다`
        : `${row.name} ${LOC_LABEL[loc]} ${won(onHand)} → ${won(count)} 저장했습니다`,
    });
    // 오늘 셀 목록은 집 실사다 — 집에서 센 카드만 뺀다
    if (loc === 'self') setQueue((list) => (list ? list.filter((x) => x.skuId !== row.skuId) : list));
    setNote('');
    setSel(null);
    await load();
  }

  const skuCard = (r: StockRow) => (
    <button
      key={r.skuId}
      type="button"
      onClick={() => pick(r, 'self')}
      style={{ ...card, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}
    >
      <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>{r.name}</div>
      <div style={{ fontSize: '12px', color: '#374151', marginTop: '2px' }}>{r.option || '—'}</div>
      <div style={{ fontSize: '12px', color: '#374151', marginTop: '6px' }}>
        집 {won(r.self)} · 입고중 {won(r.rgInbound)} · RG {won(r.rg)} · 마지막 실사 {r.lastCountedAt ? kstDate(r.lastCountedAt) : '안 셈'}
      </div>
    </button>
  );

  const left = queue?.length ?? 0;

  return (
    <div style={{ padding: '12px 16px', paddingBottom: '96px' }}>
      {/* 다크 테마 body color가 placeholder에도 새어 들어온다 — 이 화면 안에서만 밝게 고정 */}
      <style>{`.ms-input::placeholder { color: #9ca3af; }`}</style>
      {msg && (
        <div role={msg.ok ? 'status' : 'alert'} style={{ ...card, backgroundColor: msg.ok ? '#e7f6ec' : '#fdecec', color: msg.ok ? '#1a7f37' : '#b91c1c', fontSize: '13px', fontWeight: 700 }}>
          {msg.text}
        </div>
      )}

      {!row && (
        <>
          <div style={sectionTitle}>
            오늘 셀 목록 · 집{' '}
            <span style={{ fontWeight: 500, color: '#6b7280' }}>
              {queue === null ? '불러오는 중…' : queueTotal === 0 ? '셀 SKU가 없습니다' : left === 0 ? `오늘 ${queueTotal}개를 다 셌습니다` : `남은 ${left} / ${queueTotal}개`}
            </span>
          </div>
          {(queue ?? []).map((r) => skuCard(rows.find((x) => x.skuId === r.skuId) ?? r))}

          <div style={{ ...sectionTitle, marginTop: '16px' }}>다른 상품</div>
          <input aria-label="상품 검색" className="ms-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="상품·옵션 검색" style={{ ...field, marginBottom: '10px' }} />
          {results.map(skuCard)}
          {q.trim() !== '' && results.length === 0 && <div style={{ padding: '16px', color: '#6b7280', fontSize: '13px' }}>검색 결과가 없습니다</div>}

          {recent.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <div style={sectionTitle}>최근 수정</div>
              {recent.map((a) => (
                <div key={`${a.requestId}:${a.location}`} style={{ ...card, fontSize: '12px', color: '#374151' }}>
                  <b>{a.name}</b>{a.option ? ` · ${a.option}` : ''} · {LOC_LABEL[a.location]}{' '}
                  <span style={{ color: a.qty < 0 ? '#b91c1c' : '#1a7f37', fontWeight: 700 }}>{a.qty > 0 ? '+' : ''}{won(a.qty)}</span>
                  {a.qty === 0 ? ' (되돌림)' : ''} · {a.reason ? REASON_LABEL[a.reason] : ''} · {fmtKst(a.occurredAt)}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {row && (
        <>
          <button type="button" onClick={() => setSel(null)} style={{ background: 'none', border: 'none', color: '#374151', fontSize: '13px', fontWeight: 600, padding: 0, marginBottom: '10px' }}>
            ← 목록
          </button>
          <div style={card}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>{row.name}</div>
            <div style={{ fontSize: '13px', color: '#374151' }}>{row.option || '—'}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>RG {won(row.rg)}개 — RG는 PC의 「RG 실재고 대조」로 고칩니다</div>
          </div>

          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            {TABS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => pick(row, l)}
                style={{
                  flex: 1, height: '38px', borderRadius: '8px', fontSize: '14px', fontWeight: 700,
                  border: loc === l ? 'none' : '1px solid #d1d5db', backgroundColor: loc === l ? '#374151' : '#fff', color: loc === l ? '#fff' : '#374151',
                }}
              >
                {LOC_LABEL[l]}
              </button>
            ))}
          </div>

          {locationEmpty && (
            <div style={{ ...card, backgroundColor: '#f3f4f6', color: '#374151', fontSize: '12px', lineHeight: 1.5 }}>
              원장 전표가 없는 위치입니다 — 이번 「지금 개수」가 기초재고로 기록됩니다.
            </div>
          )}

          <div style={{ ...card, textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>지금 개수 (원장 {won(onHand)})</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '8px' }}>
              <button type="button" aria-label="하나 빼기" onClick={() => setCount((c) => Math.max(0, c - 1))} style={{ width: '52px', height: '52px', borderRadius: '26px', border: '1px solid #d1d5db', backgroundColor: '#fff', color: '#111827', fontSize: '24px' }}>−</button>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                aria-label="지금 개수"
                value={count}
                onChange={(e) => setCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                style={{ width: '96px', height: '52px', textAlign: 'center', fontSize: '24px', fontWeight: 700, borderRadius: '10px', border: '1px solid #d1d5db', color: '#111827' }}
              />
              <button type="button" aria-label="하나 더하기" onClick={() => setCount((c) => c + 1)} style={{ width: '52px', height: '52px', borderRadius: '26px', border: '1px solid #d1d5db', backgroundColor: '#fff', color: '#111827', fontSize: '24px' }}>+</button>
            </div>
            <div style={{ marginTop: '8px', fontSize: '13px', fontWeight: 700, color: diff > 0 ? '#1a7f37' : diff < 0 ? '#b91c1c' : '#6b7280' }}>
              {diff === 0 ? '차이 없음 — 센 기록만 남깁니다' : `${won(onHand)} → ${won(count)} (${diff > 0 ? '+' : ''}${won(diff)})`}
            </div>
          </div>

          {!locationEmpty && (
            <select aria-label="사유" value={reason} onChange={(e) => setReason(e.target.value as UserReason)} style={{ ...field, marginBottom: '8px' }}>
              {USER_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </select>
          )}
          {diff > 0 && (
            <input aria-label="단가" className="ms-input" inputMode="numeric" value={costRaw} onChange={(e) => setCostRaw(e.target.value)} placeholder="늘어난 재고 단가(원)" style={{ ...field, marginBottom: '8px', borderColor: cost === null ? '#f87171' : '#d1d5db' }} />
          )}
          <input aria-label="메모" className="ms-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="메모(선택)" style={field} />

          <div style={{
            position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '480px',
            padding: '12px 16px', backgroundColor: '#fff', borderTop: '1px solid #e5e7eb', boxSizing: 'border-box',
          }}>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void save()}
              style={{ width: '100%', height: '50px', borderRadius: '12px', border: 'none', backgroundColor: canSave ? '#1a7f37' : '#9ca3af', color: '#fff', fontSize: '16px', fontWeight: 700 }}
            >
              {saving ? '저장 중…' : diff === 0 ? '맞습니다 — 센 기록 저장' : '저장'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
