// src/components/dashboard/TodayCards.tsx
'use client';

/** A11 오늘 할 일 — 처리할 건수 5종. 0건은 회색 「없음」으로 남기고(확인했다는 표시), 카드 오류는 그 카드에만 */
import React from 'react';
import Link from 'next/link';
import { E } from '@/lib/design-tokens';
import type { Card, TodayData } from '@/lib/erp/home/today';

type Tone = 'bad' | 'warn' | 'none';
const TONE: Record<Tone, { border: string; num: string }> = {
  bad: { border: E.loss, num: E.loss },
  warn: { border: E.warn, num: E.warn },
  none: { border: E.line, num: E.inkMute },
};
const RG_STALE_MS = 26 * 60 * 60 * 1000;
const kst = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

// 대조 경과 시간은 렌더 시점에 계산한다 — 갱신하려면 다시 불러와야 한다(refetch).
const rgStale = (runAt: string | null) => runAt === null || Date.now() - new Date(runAt).getTime() > RG_STALE_MS;

function Box<T>(p: {
  title: string; href: string | null; card: Card<T>;
  count: (d: T) => number; tone: (d: T) => Tone; sub?: (d: T) => React.ReactNode; forceShow?: (d: T) => boolean; extra?: React.ReactNode;
}) {
  const d = p.card.data;
  const n = d === null ? 0 : p.count(d);
  const force = d !== null && !!p.forceShow?.(d);
  const tone: Tone = d === null ? 'bad' : n === 0 && !force ? 'none' : p.tone(d);
  const body = (
    <>
      <div style={{ fontSize: 12, color: E.inkSub }}>{p.title}</div>
      {p.card.error !== null ? (
        <div style={{ fontSize: 12, color: E.loss }}>불러오지 못했다 · 새로고침으로 다시 시도</div>
      ) : n === 0 ? (
        <div style={{ fontSize: 20, fontWeight: 700, color: force ? TONE[tone].num : E.inkMute }}>없음</div>
      ) : (
        <div style={{ fontSize: 24, fontWeight: 700, color: TONE[tone].num, fontFamily: E.mono }}>{n}</div>
      )}
      {d !== null && (n > 0 || force) && p.sub && <div style={{ fontSize: 11, color: E.inkSub }}>{p.sub(d)}</div>}
    </>
  );
  const style: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 4, padding: 12, minWidth: 170, flex: '1 1 170px',
    background: E.surface, border: `1px solid ${TONE[tone].border}`, color: E.ink, textDecoration: 'none',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 170px', gap: 4 }}>
      {p.href ? <Link href={p.href} style={style}>{body}</Link> : <div role="group" aria-label={p.title} style={style}>{body}</div>}
      {p.extra}
    </div>
  );
}

export default function TodayCards({ data }: { data: TodayData }) {
  return (
    <section aria-label="오늘 할 일" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Box title="출고 대기 주문" href="/orders" card={data.newOrders} count={(d) => d.count}
        tone={(d) => (d.stale > 0 ? 'bad' : 'warn')} sub={(d) => (d.stale > 0 ? `출고 지연 의심 ${d.stale}건(24시간 넘게 결제완료)` : '직접발송 · 결제됐고 출고 전')} />
      <Box title="매핑 필요" href="/erp/stock" card={data.unmapped} count={(d) => d.lines} tone={() => 'bad'} sub={(d) => `상품 연결 안 된 주문 ${d.lines}줄`} />
      <Box title="전송 실패" href={null} card={data.jobFailures} count={(d) => d.jobs.reduce((a, j) => a + j.count, 0)} tone={() => 'bad'}
        sub={(d) => d.jobs.map((j) => `${j.job} ${j.count}회 · 마지막 ${kst(j.lastAt)}`).join(' / ')} />
      <Box title="재고 부족 보류" href="/erp/stock" card={data.shortage} count={(d) => d.lines} tone={() => 'warn'}
        sub={(d) => `${d.lines}줄 · ${d.skus} SKU — 집 재고를 고치면 다음 수집에서 빠진다`}
        extra={<Link href="/erp/stock" style={{ fontSize: 11, color: E.inkSub }}>오늘 실사 목록 보기</Link>} />
      <Box title="RG 대조 경고" href="/erp/stock" card={data.rgMismatch} count={(d) => d.alerts}
        tone={(d) => (d.alerts > 0 ? 'bad' : 'warn')}
        forceShow={(d) => rgStale(d.runAt)}
        sub={(d) => (d.runAt === null ? '대조 기록 없음' : rgStale(d.runAt) ? `마지막 대조 ${kst(d.runAt)} — 26시간 넘게 대조가 없다` : `${kst(d.runAt)} 대조 기준`)} />
    </section>
  );
}
