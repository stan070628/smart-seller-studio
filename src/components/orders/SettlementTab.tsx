'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import ExpenseModal from './ExpenseModal';
import { useUrlParam } from '@/hooks/useUrlParams';
import { hasDraft } from '@/hooks/useDraftPersist';
import { expenseDraftKey } from './draft-keys';
import { E } from '@/lib/design-tokens';
import {
  qFieldStyle, qLabelStyle, qValStyle, qTitleStyle, queryPanelStyle,
  inputStyle, btnStyle, bandStyle, thStyle, numTdStyle,
  statNumStyle, statusBarStyle, Kpi, Tag,
} from './erp-ui';

interface Row {
  date: string;
  revenue: number; cancelled: number; couponDiscount: number; platformFee: number;
  purchase: number; parcelFee: number;
  adSpend: number; boxCost: number; netProfit: number; orderCount: number;
}
interface DailyResponse {
  success: boolean;
  rows: Row[];
  monthTotal: Omit<Row, 'date'>;
  error?: string;
}

const won = (n: number) => n.toLocaleString('ko-KR');

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 날짜 문자열의 요일. 정산은 요일별로 패턴이 갈려 한 글자가 값을 한다. */
function weekday(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00`).getDay()];
}

/** 토·일만 색을 준다. 평일까지 물들이면 구분이 사라진다. */
function weekendTone(date: string): string | null {
  const d = new Date(`${date}T00:00:00`).getDay();
  if (d === 0) return E.loss;
  if (d === 6) return E.info;
  return null;
}

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${ym}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function SettlementTab() {
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const defaultYm = `${nowKst.getUTCFullYear()}-${String(nowKst.getUTCMonth() + 1).padStart(2, '0')}`;
  // 정산 연월 — 스칼라라 URL 쿼리에 둔다. 탭 이동 후 돌아와도 보던 달 그대로 복원된다.
  const [ym, setYm] = useUrlParam('ym', defaultYm);
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ date: string; purchase: number; adSpend: number } | null>(null);
  const [payout, setPayout] = useState<{ settlementTargetAmount: number; totalSale: number; settlementDate: string } | null>(null);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = monthRange(ym);
    try {
      const res = await fetch(`/api/settlement/daily?from=${from}&to=${to}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [ym]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true;
    setPayoutLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/settlement/payout?month=${ym}`);
        const json = await res.json();
        if (alive) setPayout(json.success ? json.payout : null);
      } finally {
        if (alive) setPayoutLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [ym]);

  const rows = data?.rows ?? [];
  const total = data?.monthTotal;

  // 내 장부 정산예상 = 매출 − 쿠폰 − 수수료 (내 비용은 제외 — 쿠팡이 떼는 게 아님)
  const expected = total ? total.revenue - total.couponDiscount - total.platformFee : 0;
  const gap = payout ? payout.settlementTargetAmount - expected : 0;

  // 비용 = 매입 + 택배비 + 광고비 + 박스비
  const cost = (r: { purchase: number; parcelFee: number; adSpend: number; boxCost: number }) =>
    r.purchase + r.parcelFee + r.adSpend + r.boxCost;

  // 최근 며칠은 쿠팡 확정(윙 인식 ~3~4일, RG API 반영 ~1~2일) 전이라 실제보다 낮게 잡힌다.
  // 윙 인식이 최대 4일까지 걸리므로 diff <= 4(오늘 포함 5일)를 "미확정"으로 표시한다.
  const todayKst = nowKst.toISOString().slice(0, 10);
  const PROVISIONAL_DAYS = 5;
  const isProvisional = (d: string) => {
    const diff = Math.round((Date.parse(todayKst) - Date.parse(d)) / 86400000);
    return diff >= 0 && diff < PROVISIONAL_DAYS;
  };
  const provisionalCount = rows.filter((r) => isProvisional(r.date)).length;

  const costTdStyle: React.CSSProperties = {
    ...numTdStyle, cursor: 'pointer', background: E.infoSoft, color: E.info, fontWeight: 600,
  };

  return (
    <div style={{ background: E.ground, minHeight: '100%', paddingBottom: 4 }}>

      {/* ══ 조회조건 ══ */}
      <div style={queryPanelStyle}>
        <div style={qTitleStyle}>조회조건</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch' }}>
          <div style={qFieldStyle}>
            <div style={qLabelStyle}>정산월</div>
            <div style={qValStyle}>
              {/* 조건이 월 하나뿐이라 즉시 반영한다. 수익·원가 탭은 조건이 다섯이라
                  [조회]로 묶어 확정하지만, 여기서 한 달 넘기려고 두 번 누르게 할 이유가 없다. */}
              <button onClick={() => setYm(shiftMonth(ym, -1))} style={{ ...btnStyle, padding: '0 8px' }}>
                <ChevronLeft size={12} /> 이전달
              </button>
              <input
                type="month"
                value={ym}
                onChange={(e) => e.target.value && setYm(e.target.value)}
                aria-label="정산월"
                style={{ ...inputStyle, fontFamily: E.mono }}
              />
              <button onClick={() => setYm(shiftMonth(ym, 1))} style={{ ...btnStyle, padding: '0 8px' }}>
                다음달 <ChevronRight size={12} />
              </button>
            </div>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, padding: '6px 12px', alignItems: 'center' }}>
            <button
              onClick={() => setShowGuide((v) => !v)}
              style={{ ...btnStyle, color: showGuide ? E.info : E.inkSub, background: showGuide ? E.infoSoft : E.surface }}
            >
              <Info size={12} /> 집계 기준
            </button>
            <button onClick={load} disabled={loading} style={{ ...btnStyle, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}>
              <Search size={12} /> {loading ? '조회 중…' : '조회'}
            </button>
          </div>
        </div>

        {showGuide && (
          <div style={{
            padding: '8px 12px', background: E.surface, borderTop: `1px solid ${E.lineSoft}`,
            fontSize: 11, color: E.inkSub, lineHeight: 1.65,
          }}>
            <b style={{ color: E.ink }}>현금 기준</b> — 물건 산 날에 비용을 인식합니다. 쿠팡 윙·로켓그로스 판매만 집계하며 수기 입력분은 제외됩니다.
            일괄 임포트분은 쿠폰이 반영되지 않을 수 있습니다.<br />
            <b style={{ color: E.ink }}>비용</b> 열을 클릭하면 매입·택배·광고·박스비 내역을 보고 택배·박스비를 입력할 수 있습니다.
            매입·광고비는 <b style={{ color: E.ink }}>수익·원가</b> 탭 기준(자동)입니다.<br />
            <b style={{ color: E.ink }}>미확정</b>은 최근 {PROVISIONAL_DAYS}일 — 쿠팡 확정 전이라 실제보다 낮게 보입니다.
            며칠 뒤 <b style={{ color: E.ink }}>수익·원가</b> 탭의 &lsquo;판매 가져오기&rsquo;를 다시 누르면 채워집니다.
            상품별 손익도 그 탭에 있습니다.
          </div>
        )}
      </div>

      {/* ══ 지표: 쿠팡 정산 대조 ══ */}
      <div style={{ border: `1px solid ${E.line}`, marginBottom: 10, background: E.surface }}>
        <div style={bandStyle}>
          쿠팡 정산 대조 <span style={{ fontWeight: 400, color: E.inkMute }}>플랫폼 확정액과 내 장부의 차이</span>
        </div>
        {payoutLoading ? (
          <div style={{ padding: '14px 12px', fontSize: 12, color: E.inkSub, textAlign: 'center' }}>
            쿠팡 정산 조회 중…
          </div>
        ) : payout && payout.settlementTargetAmount > 0 ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <Kpi
                label="쿠팡 정산 대상액"
                value={won(payout.settlementTargetAmount)}
                sub={payout.settlementDate ? `지급일 ${payout.settlementDate}` : '지급일 미정'}
              />
              <Kpi label="내 장부 정산예상" value={won(expected)} sub="매출 − 쿠폰 − 수수료" />
              <Kpi
                label="차이"
                value={`${gap >= 0 ? '+' : '−'}${won(Math.abs(gap))}`}
                tone={gap < 0 ? E.loss : E.profit}
                sub={gap < 0 ? '장부가 더 높다' : '쿠팡이 더 높다'}
              />
              <Kpi
                label="월 순이익"
                value={total ? `${total.netProfit >= 0 ? '+' : '−'}${won(Math.abs(total.netProfit))}` : '—'}
                tone={total && total.netProfit < 0 ? E.loss : E.profit}
                sub="비용까지 뺀 값"
                last
              />
            </div>
            <div style={{
              padding: '4px 12px', background: E.chrome2, borderTop: `1px solid ${E.lineSoft}`,
              fontSize: 10.5, color: E.inkMute,
            }}>
              쿠팡 정산 기준(인식 완료분) · 이번 달은 정산 진행 중이라 일부만 반영됩니다. 완전 대조는 지난달로 보세요.
            </div>
          </>
        ) : (
          <div style={{ padding: '10px 12px', fontSize: 12, color: E.inkSub }}>
            쿠팡 정산 미확정 — 정산(구매확정) 후 표시됩니다.
            {total && (
              <span style={{ color: E.inkMute }}>
                {' · '}내 장부 정산예상 <b style={statNumStyle}>{won(expected)}</b>원
              </span>
            )}
          </div>
        )}
      </div>

      {/* ══ 일자별 그리드 ══ */}
      <div style={{ border: `1px solid ${E.line}`, background: E.surface, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
          <thead>
            {/* 헤더는 값과 같은 쪽으로 붙인다 — 가운데 정렬한 라벨은 우측 정렬된 숫자와 어긋난다.
                날짜만 폭을 비워 남는 공간을 먹는다. */}
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', minWidth: 140 }}>날짜</th>
              <th style={{ ...thStyle, textAlign: 'right', width: '8%', minWidth: 64 }}>주문</th>
              <th style={{ ...thStyle, textAlign: 'right', width: '12%', minWidth: 96 }}>매출</th>
              <th style={{ ...thStyle, textAlign: 'right', width: '12%', minWidth: 92 }}>취소</th>
              <th style={{ ...thStyle, textAlign: 'right', width: '11%', minWidth: 88 }}>쿠폰</th>
              <th style={{ ...thStyle, textAlign: 'right', width: '12%', minWidth: 92 }}>수수료</th>
              <th style={{ ...thStyle, textAlign: 'right', width: '12%', minWidth: 96 }}>비용</th>
              <th style={{ ...thStyle, textAlign: 'right', width: '13%', minWidth: 100, borderRight: 'none' }}>순이익</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr><td colSpan={8} style={{ ...numTdStyle, textAlign: 'center', color: E.inkSub, padding: 30, borderRight: 'none' }}>불러오는 중…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} style={{ ...numTdStyle, textAlign: 'center', color: E.inkSub, padding: 30, borderRight: 'none' }}>이 달 데이터가 없습니다</td></tr>
            )}
            {rows.map((r, i) => {
              const prov = isProvisional(r.date);
              return (
                <tr key={r.date} style={{ background: prov ? E.warnSoft : i % 2 === 1 ? E.chrome2 : E.surface }}>
                  <td style={{ ...numTdStyle, textAlign: 'left', fontFamily: 'inherit', fontWeight: 500 }}>
                    <span style={{ fontFamily: E.mono, fontVariantNumeric: 'tabular-nums' }}>{r.date.slice(5)}</span>
                    <span style={{ marginLeft: 5, fontSize: 10.5, color: weekendTone(r.date) ?? E.inkMute }}>
                      {weekday(r.date)}
                    </span>
                    {prov && (
                      <Tag tone={E.warn} title={`최근 ${PROVISIONAL_DAYS}일은 쿠팡 확정 전이라 실제보다 낮게 보입니다`}>
                        미확정
                      </Tag>
                    )}
                  </td>
                  <td style={{ ...numTdStyle, color: r.orderCount ? E.ink : E.inkMute }}>{r.orderCount || '0'}</td>
                  <td style={numTdStyle}>{won(r.revenue)}</td>
                  <td style={{ ...numTdStyle, color: r.cancelled ? E.loss : E.inkMute }}>{r.cancelled ? `−${won(r.cancelled)}` : '0'}</td>
                  <td style={{ ...numTdStyle, color: r.couponDiscount ? E.ink : E.inkMute }}>{r.couponDiscount ? `−${won(r.couponDiscount)}` : '0'}</td>
                  <td style={{ ...numTdStyle, color: r.platformFee ? E.ink : E.inkMute }}>{r.platformFee ? `−${won(r.platformFee)}` : '0'}</td>
                  <td
                    style={costTdStyle}
                    onClick={() => setModal({ date: r.date, purchase: r.purchase, adSpend: r.adSpend })}
                    title="클릭해 비용 내역 보기·입력"
                  >
                    {cost(r) ? `−${won(cost(r))}` : '0'}
                    {hasDraft(expenseDraftKey(r.date)) && (
                      <span title="작성 중인 입력이 있어요" style={{ marginLeft: 4, fontSize: 10, color: E.warn }}>✎</span>
                    )}
                  </td>
                  <td style={{ ...numTdStyle, borderRight: 'none', fontWeight: 600, color: r.netProfit < 0 ? E.loss : E.profit }}>
                    {r.netProfit >= 0 ? '+' : '−'}{won(Math.abs(r.netProfit))}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {total && rows.length > 0 && (
            <tfoot>
              <tr style={{ background: E.chrome, borderTop: `1px solid ${E.line}`, fontWeight: 700 }}>
                <td style={{ ...numTdStyle, textAlign: 'left', fontFamily: 'inherit', fontWeight: 700, borderBottom: 'none' }}>월 합계</td>
                <td style={{ ...numTdStyle, fontWeight: 700, borderBottom: 'none' }}>{total.orderCount || '0'}</td>
                <td style={{ ...numTdStyle, fontWeight: 700, borderBottom: 'none' }}>{won(total.revenue)}</td>
                <td style={{ ...numTdStyle, fontWeight: 700, borderBottom: 'none', color: total.cancelled ? E.loss : E.inkMute }}>
                  {total.cancelled ? `−${won(total.cancelled)}` : '0'}
                </td>
                <td style={{ ...numTdStyle, fontWeight: 700, borderBottom: 'none' }}>−{won(total.couponDiscount)}</td>
                <td style={{ ...numTdStyle, fontWeight: 700, borderBottom: 'none' }}>−{won(total.platformFee)}</td>
                <td style={{ ...numTdStyle, fontWeight: 700, borderBottom: 'none' }}>−{won(cost(total))}</td>
                <td style={{ ...numTdStyle, borderRight: 'none', borderBottom: 'none', fontWeight: 700, color: total.netProfit < 0 ? E.loss : E.profit }}>
                  {total.netProfit >= 0 ? '+' : '−'}{won(Math.abs(total.netProfit))}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ══ 상태바 ══ */}
      <div style={statusBarStyle}>
        <span>{ym} · <b style={statNumStyle}>{rows.length}</b>일</span>
        {provisionalCount > 0 && (
          <span style={{ color: E.warn }}>미확정 <b style={{ ...statNumStyle, color: E.warn }}>{provisionalCount}</b>일</span>
        )}
        {total && (
          <>
            <span>매출 <b style={statNumStyle}>{won(total.revenue)}</b>원</span>
            <span>비용 <b style={statNumStyle}>{won(cost(total))}</b>원</span>
            <span>
              순이익{' '}
              <b style={{ ...statNumStyle, color: total.netProfit < 0 ? E.loss : E.profit }}>
                {total.netProfit >= 0 ? '+' : '−'}{won(Math.abs(total.netProfit))}
              </b>원
            </span>
          </>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: E.inkMute }}>
          순이익 = 매출 − 취소 − 쿠폰 − 수수료 − (매입 + 택배 + 광고 + 박스)
        </span>
      </div>

      {modal && (
        <ExpenseModal
          date={modal.date}
          purchase={modal.purchase}
          adSpend={modal.adSpend}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
