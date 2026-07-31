'use client';

/**
 * ShortlistTab.tsx
 * 소싱 쇼트리스트 탭 — "이 상품, 지금 사도 되나?"에 답하는 화면.
 *
 * 도매꾹 후보를 담아두고 도매가·배송비·쿠팡 시세를 근거로 손익분기와 마진을 보여준다.
 * 판정(verdict)은 4가지: pass(통과) / fail(미달) / dead(판매종료) / unknown(판정 불가).
 * unknown은 실패가 아니라 "아직 모른다"이므로 fail과 다른 색·문구로 구분한다.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Trash2, ExternalLink } from 'lucide-react';
import { C as BASE_C } from '@/lib/design-tokens';
import type { ShortlistItem, LogisticsSize, Verdict } from '@/types/shortlist';

// 공통 토큰에 없는 시맨틱 색만 로컬로 확장한다 (CostcoMemoTab.tsx, DomeggookTab.tsx와 동일 관례).
const C = {
  ...BASE_C,
  danger: '#dc2626',
  dangerBg: 'rgba(220,38,38,0.08)',
  gray: '#6b7280',
  infoBg: 'rgba(37,99,235,0.08)',
} as const;

const SIZE_LABEL: Record<LogisticsSize, string> = {
  xsmall: '극소형',
  small: '소형',
  medium: '중형',
};

const VERDICT_BADGE: Record<Verdict, { label: string; color: string }> = {
  pass: { label: '✅ 통과', color: C.success },
  fail: { label: '❌ 미달', color: C.danger },
  dead: { label: '⚠ 판매종료', color: C.gray },
  unknown: { label: '⚠ 표본부족', color: C.warning },
};

const DEFAULT_ORDER_QTY = 10;
const STALE_MS = 24 * 60 * 60 * 1000;

function won(n: number | null): string {
  return n === null ? '—' : `${n.toLocaleString('ko-KR')}원`;
}

/** 마지막 검증이 24시간을 넘었는지 (검증 이력 자체가 없으면 오래된 것으로 본다) */
function isStale(verifiedAt: string | null): boolean {
  if (!verifiedAt) return true;
  return Date.now() - new Date(verifiedAt).getTime() > STALE_MS;
}

/** 배송비 정책을 사람이 읽는 문장으로 (도매꾹 값이 비어 있을 수 있어 방어적으로 처리) */
function deliPolicyText(it: ShortlistItem): string {
  if (it.deliIsFree) return '무료배송';
  if (it.deliType === 'tiered' && it.deliUnitQty !== null && it.deliFee !== null) {
    return `${it.deliUnitQty}개당 ${won(it.deliFee)}`;
  }
  if (it.deliType === 'fixed' && it.deliFee !== null) {
    return `고정 ${won(it.deliFee)}`;
  }
  return '배송비 정책 확인 안 됨';
}

/**
 * unknown 판정의 원인을 구분해서 툴팁으로 보여준다.
 * effectiveCost가 없으면 배송비 금액을 몰라 손익분기 자체를 못 세운 것이고,
 * effectiveCost는 있는데 unknown이면 쿠팡 표본이 부족해 시세를 못 정한 것이다.
 */
function unknownReason(it: ShortlistItem): string {
  return it.effectiveCost === null
    ? '실효원가 계산 불가 — 배송비 금액이 확인되지 않았습니다.'
    : '쿠팡 표본 부족 — 판정에 필요한 시세 표본이 모자랍니다.';
}

interface VerifyNotice {
  skipped: number;
  remaining: number;
}

export default function ShortlistTab() {
  const [items, setItems] = useState<ShortlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [orderQty, setOrderQty] = useState(DEFAULT_ORDER_QTY);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<VerifyNotice | null>(null);

  /**
   * 목록을 (재)조회한다.
   *
   * silent=true면 전체 로딩 화면(`loading`)을 켜지 않는다 — add·verifyAll·
   * applyOrderQty·remove는 성공 후 목록 구성이 바뀌어 재조회가 맞지만, 그때마다
   * 테이블을 통째로 언마운트하면 사이즈 변경처럼 잦은 조작마다 화면이 깜빡인다.
   * 최초 마운트 시(loading=true 초기값)만 전체 로딩 화면을 보여준다.
   */
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetch('/api/sourcing/shortlist');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '목록을 불러오지 못했습니다.');
      const list: ShortlistItem[] = data.items;
      setItems(list);
      if (list.length > 0) setOrderQty(list[0].orderQty);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/sourcing/shortlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: input.trim(), orderQty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '추가하지 못했습니다.');
      setInput('');
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '추가하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  /** skipped·remaining은 에러가 아니라 안내다. 에러 배너와 분리해서 보여준다. */
  const reportVerifyResult = (skipped: number, remaining: number) => {
    if (skipped > 0 || remaining > 0) {
      setNotice({ skipped, remaining });
    } else {
      setNotice(null);
    }
  };

  const verifyAll = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/sourcing/shortlist/verify', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '재검증하지 못했습니다.');
      reportVerifyResult(data.skipped, data.remaining);
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '재검증하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * PATCH /shortlist/[itemNo]는 서버에서 이미 재검증까지 마친 최신 항목을
   * { item }으로 돌려준다. 전체 재조회 대신 해당 행만 교체한다 — 사이즈처럼
   * 자주 바꾸는 값마다 GET을 다시 부르고 테이블을 통째로 갈아끼우면 그때마다
   * 화면이 깜빡인다.
   */
  const patchItem = async (itemNo: number, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sourcing/shortlist/${itemNo}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '수정하지 못했습니다.');
      // data는 res.json()의 반환값이라 타입이 any다 — 컴파일러가 null을 못 잡는다.
      // PATCH가 성공한 직후 다른 탭·세션에서 같은 항목이 삭제되면 서버는 200과
      // 함께 { item: null }을 돌려준다(getShortlistItem이 없는 행에 null을 반환).
      // 그걸 그대로 배열에 넣으면 이후 렌더에서 it.verdict 접근 시 TypeError로
      // 테이블 전체가 죽으므로, null이면 해당 행을 목록에서 제거한다 — 이미
      // 서버에서 사라진 항목이므로 화면에서도 빼는 게 맞다.
      setItems((prev) =>
        data.item
          ? prev.map((it) => (it.itemNo === itemNo ? data.item : it))
          : prev.filter((it) => it.itemNo !== itemNo),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '수정하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 사입 수량을 전체에 일괄 적용한 뒤 재검증한다 (PATCH → verify 순서 고정).
   *
   * busy 가드가 반드시 필요하다: 이 함수는 input의 onBlur와 onKeyDown(Enter) 둘 다에
   * 걸려 있는데, Enter를 누르면 onKeyDown 핸들러가 먼저 실행되어 busy를 true로 만들고,
   * 리렌더로 input이 disabled되는 순간 브라우저가 blur 이벤트를 발생시켜 onBlur
   * 핸들러가 곧바로 다시 실행된다. 가드가 없으면 PATCH·재검증·목록 갱신이 두 번 돈다.
   */
  const applyOrderQty = async (qty: number) => {
    if (busy || !Number.isInteger(qty) || qty <= 0 || items.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const patchRes = await fetch('/api/sourcing/shortlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderQty: qty }),
      });
      const patchData = await patchRes.json();
      if (!patchRes.ok) throw new Error(patchData.error ?? '사입 수량 변경에 실패했습니다.');

      const verifyRes = await fetch('/api/sourcing/shortlist/verify', { method: 'POST' });
      const verifyData = await verifyRes.json();
      if (verifyRes.ok) reportVerifyResult(verifyData.skipped, verifyData.remaining);

      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '사입 수량 변경에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (itemNo: number) => {
    if (!confirm('쇼트리스트에서 삭제할까요?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sourcing/shortlist/${itemNo}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '삭제하지 못했습니다.');
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      {/* 헤더 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14, flexWrap: 'wrap', gap: 8,
      }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>소싱 리스트</h2>
          <p style={{ fontSize: 12, color: C.textSub, margin: '4px 0 0' }}>
            총 {items.length}개 후보
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.textSub }}>
            사입수량
            <input
              type="number"
              min={1}
              value={orderQty}
              onChange={(e) => setOrderQty(Number(e.target.value))}
              onBlur={(e) => void applyOrderQty(Number(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && void applyOrderQty(Number(e.currentTarget.value))}
              disabled={busy}
              style={{
                width: 64, padding: '6px 8px', borderRadius: 6,
                border: `1px solid ${C.border}`, background: C.card, color: C.text,
              }}
            />
            개
          </label>
          <button onClick={() => void verifyAll()} disabled={busy || items.length === 0} style={btnStyle()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            전체 재검증
          </button>
        </div>
      </div>

      {/* 추가 입력 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder="도매꾹 상품번호 또는 URL 붙여넣기"
          aria-label="도매꾹 상품번호 또는 URL"
          disabled={busy}
          style={{
            flex: 1, padding: '8px 10px', borderRadius: 6,
            border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 13,
          }}
        />
        <button onClick={() => void add()} disabled={busy || !input.trim()} style={btnStyle(true)}>
          <Plus size={14} /> 추가
        </button>
      </div>

      {/* 에러 배너 — 실제 실패만 */}
      {error && (
        <div style={{
          marginBottom: 12, padding: '10px 14px', borderRadius: 8,
          background: C.dangerBg, color: C.danger, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* 안내 배너 — skipped·remaining은 실패가 아니다 */}
      {notice && (
        <div style={{
          marginBottom: 12, padding: '10px 14px', borderRadius: 8,
          background: C.infoBg, color: C.info, fontSize: 13, lineHeight: 1.6,
        }}>
          {notice.skipped > 0 && (
            <div>{notice.skipped}건은 도매꾹 응답을 받지 못해 기존 값을 유지했습니다. 다음 자동 검증에서 다시 시도합니다.</div>
          )}
          {notice.remaining > 0 && (
            <div>{notice.remaining}건은 시간이 모자라 처리하지 못했습니다. 다시 누르면 이어서 처리합니다.</div>
          )}
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div style={{ padding: 40, textAlign: 'center', color: C.textSub, fontSize: 13 }}>
          <Loader2 size={18} className="animate-spin" style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
          불러오는 중...
        </div>
      )}

      {/* 빈 목록 */}
      {!loading && items.length === 0 && (
        <div style={{ padding: 60, textAlign: 'center', color: C.textSub, fontSize: 13 }}>
          아직 담은 후보가 없습니다. 도매꾹 상품번호나 URL을 붙여넣어 추가하세요.
        </div>
      )}

      {/* 목록 테이블 — busy 중에는 언마운트하지 않고 살짝 흐리게만 표시한다 */}
      {!loading && items.length > 0 && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', overflowX: 'auto',
          opacity: busy ? 0.6 : 1, transition: 'opacity 0.15s',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr style={{ background: C.tableHeader, borderBottom: `1px solid ${C.border}` }}>
                <th style={thStyle('left')}>상품</th>
                <th style={thStyle('right')}>도매가</th>
                <th style={thStyle('right')}>배송</th>
                <th style={thStyle('right')}>실효원가</th>
                <th style={thStyle('right')}>쿠팡 p25</th>
                <th style={thStyle('right')}>손익분기</th>
                <th style={thStyle('right')}>마진율</th>
                <th style={thStyle('center')}>사이즈</th>
                <th style={thStyle('center')}>상태</th>
                <th style={{ ...thStyle('center'), width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const dead = it.verdict === 'dead';
                const badge = it.verdict ? VERDICT_BADGE[it.verdict] : null;
                const stale = isStale(it.verifiedAt);
                return (
                  <tr
                    key={it.itemNo}
                    style={{
                      borderTop: `1px solid ${C.border}`,
                      opacity: dead ? 0.45 : 1,
                    }}
                  >
                    <td style={{ padding: '10px 12px', maxWidth: 260 }}>
                      <a
                        href={`https://domeggook.com/${it.itemNo}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: C.text, textDecoration: 'none', fontWeight: 600,
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                          {it.title}
                        </span>
                        <ExternalLink size={11} style={{ opacity: 0.5, flexShrink: 0 }} />
                      </a>
                      <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>
                        #{it.itemNo}
                        {stale && (
                          <span style={{ marginLeft: 8, color: C.warning }} title={it.verifiedAt ? `마지막 검증: ${new Date(it.verifiedAt).toLocaleString('ko-KR')}` : '검증 이력 없음'}>
                            ⏱ 검증 오래됨
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={tdStyle()}>{won(it.domePrice)}</td>
                    <td style={tdStyle()} title={deliPolicyText(it)}>
                      {it.unitDeliFee === null ? '—' : `+${it.unitDeliFee.toLocaleString('ko-KR')}`}
                    </td>
                    <td style={tdStyle()}>{won(it.effectiveCost)}</td>
                    <td style={tdStyle()}>
                      {won(it.coupangP25)}
                      {it.coupangSampleN !== null && (
                        <span style={{ color: C.textSub, fontSize: 11 }}> (n={it.coupangSampleN})</span>
                      )}
                    </td>
                    <td style={tdStyle()}>{won(it.breakEvenPrice)}</td>
                    <td style={{ ...tdStyle(), color: it.marginRate !== null && it.marginRate >= 30 ? C.success : C.text, fontWeight: 700 }}>
                      {it.marginRate === null ? '—' : `${it.marginRate.toFixed(1)}%`}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <select
                        value={it.logisticsSize}
                        onChange={(e) => void patchItem(it.itemNo, { logisticsSize: e.target.value as LogisticsSize })}
                        disabled={busy || dead}
                        aria-label={`${it.title} 물류 사이즈`}
                        style={{
                          background: C.card, color: C.text,
                          border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 6px', fontSize: 12,
                        }}
                      >
                        {(Object.keys(SIZE_LABEL) as LogisticsSize[]).map((s) => (
                          <option key={s} value={s}>{SIZE_LABEL[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      {badge ? (
                        <span
                          style={{ color: badge.color, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}
                          title={it.verdict === 'unknown' ? unknownReason(it) : undefined}
                        >
                          {badge.label}
                        </span>
                      ) : (
                        <span style={{ color: C.textSub }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <button
                        onClick={() => void remove(it.itemNo)}
                        disabled={busy}
                        aria-label="삭제"
                        style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', padding: 4, color: C.textSub }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function thStyle(align: 'left' | 'right' | 'center'): React.CSSProperties {
  return { padding: '10px 12px', textAlign: align, fontWeight: 600, color: C.textSub, fontSize: 12 };
}

function tdStyle(): React.CSSProperties {
  return { padding: '10px 12px', textAlign: 'right', color: C.text };
}

function btnStyle(primary = false): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
    border: primary ? 'none' : `1px solid ${C.border}`,
    background: primary ? C.accent : C.card,
    color: primary ? '#fff' : C.text,
  };
}
