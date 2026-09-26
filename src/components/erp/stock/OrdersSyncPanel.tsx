'use client';

/**
 * 주문 수집 현황(재고현황 위 · 1-C2a). 채널별 오늘·어제·3일 건수 · 미귀속 · 재고 부족 · 차감 대기 · 마지막 수집 · 마지막 실행 성패.
 * 날짜 칸을 누르면 그날 라인. 스위치가 꺼져 있으면(기록만) 「차감 켜기…」 확인 창을 연다.
 * 마지막 실행에서 채널별로 임대 못 잡음(busy)·사라짐 판정 거절·형식 오류로 버린 라인·모르는 상태가 있으면
 * 「상태」 칸에 태그로 함께 보인다 — collect.ts의 reportAlerts가 텔레그램으로 이미 이 넷을 사람이 볼 것으로 정해뒀다(설계 해석 #24).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShoppingCart } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { Tag, bandStyle, btnStyle, disabledBtnStyle, numTdStyle, primaryBtnStyle, thStyle } from '@/components/orders/erp-ui';
import type { ChannelStatus, DayCount, OrdersStatus } from '@/lib/erp/orders/queries';
import { addDays } from '@/lib/erp/orders/window';
import { fetchOrdersStatus, postOrdersSync } from './api';
import OrderLinesDialog from './OrderLinesDialog';
import DeductEnableDialog from './DeductEnableDialog';
import { fmtKst, won } from './stock-view';

interface Props {
  /** 차감을 켜거나 수집으로 원장이 바뀌었을 때 — 재고 표를 다시 읽는다 */
  onChanged: () => void;
}

const textTd: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '4px 8px', fontSize: 12, whiteSpace: 'nowrap',
};
const cellBtn: React.CSSProperties = { border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: E.ink, fontFamily: E.mono, fontSize: 12 };

export default function OrdersSyncPanel({ onChanged }: Props) {
  const [status, setStatus] = useState<OrdersStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(true);
  const [lines, setLines] = useState<{ channel: string; label: string; date: string } | null>(null);
  const [enabling, setEnabling] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchOrdersStatus();
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setStatus(r.data);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 진입 시 수집 현황을 읽는다
  useEffect(() => { void load(); }, [load]);

  async function syncNow() {
    setSyncing(true);
    const r = await postOrdersSync();
    setSyncing(false);
    if (!r.ok) {
      toast.error(r.error);
    } else {
      const bad = r.data.filter((x) => !x.ok);
      const added = r.data.reduce((s, x) => s + (x.inserted ?? 0), 0);
      if (bad.length > 0) toast.error(`일부 채널 실패 — ${bad.map((b) => `${b.channel}: ${b.error ?? ''}`).join(' / ')}`);
      else toast.success(`수집했습니다 — 새 라인 ${won(added)}줄`);
      onChanged();
    }
    await load();
  }

  const day = (c: { channel: string; label: string }, date: string, v: DayCount) => (
    <button
      type="button"
      aria-label={`${c.label} ${date} ${v.orders}건 ${v.lines}줄`}
      onClick={() => setLines({ channel: c.channel, label: c.label, date })}
      style={cellBtn}
    >
      {won(v.orders)}건 · {won(v.lines)}줄
    </button>
  );

  const statusTags = (c: ChannelStatus) => (
    <>
      {c.lastError === 1 ? <Tag tone={E.loss}>실패</Tag> : c.lastError === 0 ? <Tag tone={E.profit}>정상</Tag> : <Tag tone={E.inkMute}>기록 없음</Tag>}
      {c.lastBusy === 1 && <Tag tone={E.warn} title="마지막 실행에서 임대를 못 잡아 이 채널을 건너뛰었다">임대 못 잡음</Tag>}
      {c.lastAbsenceRefused === 1 && <Tag tone={E.warn} title="사라진 라인 수가 문턱을 넘어 취소 판정을 거절했다 — 응답이 비었을 수 있다">사라짐 거절</Tag>}
      {(c.lastRejected ?? 0) > 0 && <Tag tone={E.warn} title="형식이 잘못돼 버린 라인(구매자 정보 없음)">버림 {c.lastRejected}</Tag>}
      {c.unknownStatus > 0 && <span style={{ marginLeft: 4, color: E.warn }}>모르는 상태 {c.unknownStatus}</span>}
    </>
  );

  const enabled = status?.deduct.enabled === true;
  return (
    <div style={{ background: E.surface, border: `1px solid ${E.line}`, marginBottom: 10 }}>
      <div style={{ ...bandStyle, justifyContent: 'space-between' }}>
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: E.ink }}>
          <ShoppingCart size={12} /> 주문 수집 —{' '}
          {enabled
            ? <span style={{ color: E.profit }}>판매 차감 켜짐{status?.deduct.enabledAt ? `(${fmtKst(status.deduct.enabledAt)}부터)` : ''}</span>
            : <span style={{ color: E.warn }}>기록만(판매 차감 꺼짐)</span>}
        </button>
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" disabled={syncing} onClick={() => void syncNow()} style={syncing ? disabledBtnStyle : btnStyle}>
            <RefreshCw size={12} /> {syncing ? '수집 중…' : '지금 수집'}
          </button>
          {status && !enabled && (
            <button type="button" onClick={() => setEnabling(true)} style={primaryBtnStyle}>차감 켜기…</button>
          )}
        </span>
      </div>
      {error && <div role="alert" style={{ padding: 8, color: E.loss }}>{error}</div>}
      {open && status && (
        <>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>{['채널', `오늘 ${status.today}`, '어제', '3일', '미귀속', '재고 부족', '차감 대기', '마지막 수집', '상태'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {status.channels.map((c) => (
                <tr key={c.channel}>
                  <td style={textTd}>{c.label}</td>
                  <td style={textTd}>{day(c, status.today, c.today)}</td>
                  <td style={textTd}>{day(c, addDays(status.today, -1), c.yesterday)}</td>
                  <td style={{ ...textTd, fontFamily: E.mono }}>{won(c.last3.orders)}건 · {won(c.last3.lines)}줄</td>
                  <td style={{ ...numTdStyle, color: c.unattributed > 0 ? E.warn : E.ink }}>{won(c.unattributed)}</td>
                  <td style={{ ...numTdStyle, color: c.short > 0 ? E.loss : E.ink }}>{won(c.short)}</td>
                  <td style={numTdStyle}>{won(c.pending)}</td>
                  <td style={textTd}>{c.cursorAt ? fmtKst(c.cursorAt) : '—'}</td>
                  <td style={{ ...textTd, whiteSpace: 'normal', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>{statusTags(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '6px 10px', color: E.inkSub, fontSize: 11 }}>
            15분마다 자동 수집합니다(기초재고 시각 {status.cutover ? fmtKst(status.cutover) : '—'} 이후). 건수는 주문 시각(KST) 기준입니다.
            {status.lastRun && ` 마지막 실행 ${fmtKst(status.lastRun.startedAt)} · ${status.lastRun.status}${status.lastRun.error ? ` · ${status.lastRun.error}` : ''}`}
            {enabled && ' 취소·반품 완료 라인은 자동으로 되돌립니다 — 그 물건을 「반품입고」로 다시 올리지 않습니다.'}
          </div>
        </>
      )}
      {lines && <OrderLinesDialog channel={lines.channel} label={lines.label} date={lines.date} onClose={() => setLines(null)} />}
      {enabling && (
        <DeductEnableDialog
          onClose={() => setEnabling(false)}
          onDone={() => { setEnabling(false); void load(); onChanged(); }}
        />
      )}
    </div>
  );
}
