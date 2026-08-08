'use client';

/**
 * 영수증 초안 상세 — 검토하고 확정한다.
 *
 * 판독이 안 끝난 초안은 주기적으로 다시 조회한다.
 * 검산이 깨졌다고 확정을 막지는 않는다 — 사람이 보고 판단할 정보를 줄 뿐이다.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Badge, Progress } from '@/lib/receipt/view';
import ReceiptLineRow, { type LineData, type ProductOption } from './ReceiptLineRow';

interface CheckDetail {
  status: string;
  expected: number | null;
  actual: number | null;
  diff: number | null;
  badLineNos?: number[];
}

export interface Detail {
  id: string;
  purchased_at: string | null;
  store_name: string | null;
  receipt_total: number | null;
  total_item_count: number | null;
  ocr_status: string;
  verify_status: string;
  verify_detail: Record<string, CheckDetail | string> | null;
  status: string;
  image_urls: string[];
  badge: Badge;
  progress: Progress;
  lines: LineData[];
}

/** cron이 10분 주기이므로 초 단위 폴링은 대부분 헛돈다 */
const POLL_MS = 20_000;

const CHECK_LABEL: Record<string, string> = {
  totalSum: '품목 합계',
  lineArithmetic: '줄별 수량×단가',
  itemCount: '총 상품수',
  taxBreakdown: '과세·면세 구분',
};

const won = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('ko-KR')}원`);

export default function ReceiptDetail({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** 폐기는 두 번 눌러야 실행된다. window.confirm은 모바일에서 거칠고 테스트도 어렵다 */
  const [discardArmed, setDiscardArmed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/receipts/${draftId}`);
      const json = await res.json();
      if (!json.success) { setError(json.error ?? '조회 실패'); return; }
      setD(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패');
    }
  }, [draftId]);

  useEffect(() => {
    void load();
    void (async () => {
      try {
        const res = await fetch('/api/cost-management/products/options');
        const json = await res.json();
        if (json.success) setProducts(json.data);
      } catch {
        // 상품 목록 실패는 치명적이지 않다 — 줄 검토는 계속할 수 있다
      }
    })();
  }, [load]);

  const busy = d?.badge.busy ?? false;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [busy, load]);

  const patchLine = useCallback(async (lineNo: number, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/receipts/${draftId}/lines/${lineNo}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!json.success) { setError(json.error ?? '수정 실패'); return; }
    setError(null);
    await load();
  }, [draftId, load]);

  async function confirm() {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/receipts/${draftId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '확정 실패');
      const created = json.data.created as { line_no: number }[];
      const failed = json.data.failed as { line_no: number; error: string }[];
      setResult(
        failed.length > 0
          ? `${created.length}건 입고, ${failed.length}건 실패: ${failed.map((f) => `${f.line_no}번 ${f.error}`).join(' / ')}`
          : `${created.length}건 입고 완료`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '확정 실패');
    } finally {
      setConfirming(false);
    }
  }

  async function discard() {
    try {
      const res = await fetch(`/api/receipts/${draftId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) { setError(json.error ?? '폐기 실패'); setDiscardArmed(false); return; }
      router.push('/m/receipt');
    } catch (e) {
      setError(e instanceof Error ? e.message : '폐기 실패');
      setDiscardArmed(false);
    }
  }

  async function retry() {
    try {
      const res = await fetch(`/api/receipts/${draftId}/retry`, { method: 'POST' });
      const json = await res.json();
      if (!json.success) { setError(json.error ?? '재판독 실패'); return; }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '재판독 실패');
    }
  }

  if (error && !d) return <div role="alert" style={{ padding: '16px', color: '#b91c1c' }}>{error}</div>;
  if (!d) return <div style={{ padding: '16px', color: '#6b7280' }}>불러오는 중…</div>;

  // verify_detail은 검사별 결과 + status 문자열이 섞인 객체다. 검사만 걸러낸다
  const failedChecks: [string, CheckDetail][] = Object.entries(d.verify_detail ?? {})
    .filter(([k, v]) =>
      k !== 'status' && typeof v === 'object' && v !== null && (v as CheckDetail).status === 'fail')
    .map(([k, v]) => [k, v as CheckDetail]);

  return (
    <div style={{ padding: '16px', paddingBottom: '96px' }}>
      <button
        onClick={() => router.push('/m/receipt')}
        style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: '13px',
                 padding: 0, marginBottom: '12px' }}
      >← 목록</button>

      <div style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '14px',
                    border: '1px solid #e5e7eb', marginBottom: '12px' }}>
        <div style={{ fontSize: '16px', fontWeight: 700 }}>
          {d.purchased_at ? String(d.purchased_at).slice(0, 10) : '날짜 미확인'}
          {d.store_name && (
            <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: 400 }}> · {d.store_name}</span>
          )}
        </div>
        <div style={{ marginTop: '4px', fontSize: '13px', color: '#4b5563' }}>
          합계 {won(d.receipt_total)} · 총 {d.total_item_count ?? '—'}개 · 품목 {d.progress.total}줄
        </div>
      </div>

      {d.ocr_status === 'failed' && (
        <div style={{ backgroundColor: '#fdecec', borderRadius: '10px', padding: '12px',
                      marginBottom: '12px' }}>
          <div style={{ color: '#b91c1c', fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>
            판독에 3번 실패했습니다.
          </div>
          <div style={{ color: '#7f1d1d', fontSize: '12px', marginBottom: '10px' }}>
            사진이 흐리거나 잘렸을 수 있습니다. 다시 찍는 편이 빠를 수도 있습니다.
          </div>
          <button
            onClick={() => void retry()}
            style={{ width: '100%', height: '38px', borderRadius: '8px', border: 'none',
                     backgroundColor: '#b91c1c', color: '#fff', fontSize: '13px', fontWeight: 700 }}
          >다시 판독</button>
        </div>
      )}

      {failedChecks.length > 0 && (
        <div style={{ backgroundColor: '#fff4e5', borderRadius: '10px', padding: '12px',
                      marginBottom: '12px', fontSize: '12px', color: '#7c2d12' }}>
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>
            검산이 맞지 않습니다 — 확정 전에 확인하세요
          </div>
          {failedChecks.map(([k, v]) => (
            <div key={k} style={{ marginTop: '3px' }}>
              · {CHECK_LABEL[k] ?? k}
              {v.badLineNos?.length ? ` — ${v.badLineNos.join(', ')}번 줄` : ''}
              {v.diff != null ? ` — 차액 ${v.diff.toLocaleString('ko-KR')}원` : ''}
            </div>
          ))}
        </div>
      )}

      {d.badge.busy && (
        <div style={{ backgroundColor: '#eef0f2', borderRadius: '10px', padding: '14px',
                      textAlign: 'center', color: '#4b5563', fontSize: '13px', marginBottom: '12px' }}>
          {d.badge.label}입니다. 10분 주기로 자동 처리됩니다.
        </div>
      )}

      {result && (
        <div style={{ backgroundColor: '#e7f6ec', borderRadius: '10px', padding: '12px',
                      marginBottom: '12px', fontSize: '13px', color: '#1a7f37', fontWeight: 700 }}>
          {result}
        </div>
      )}

      {error && (
        <div role="alert" style={{ backgroundColor: '#fdecec', borderRadius: '10px', padding: '12px',
                                   marginBottom: '12px', fontSize: '13px', color: '#b91c1c' }}>{error}</div>
      )}

      {d.lines.map((l) => (
        <ReceiptLineRow key={l.id} line={l} products={products} onPatch={patchLine} />
      ))}

      {/* 잘못 찍은 영수증에 출구를 준다. 확정된 줄이 하나라도 있으면 서버가 409로 막는다 */}
      {d.status === 'draft' && (
        <button
          onClick={() => (discardArmed ? void discard() : setDiscardArmed(true))}
          onBlur={() => setDiscardArmed(false)}
          style={{
            width: '100%', height: '40px', marginTop: '16px', borderRadius: '10px',
            border: discardArmed ? 'none' : '1px solid #d1d5db',
            backgroundColor: discardArmed ? '#b91c1c' : '#fff',
            color: discardArmed ? '#fff' : '#6b7280',
            fontSize: '13px', fontWeight: 700,
          }}
        >
          {discardArmed ? '한 번 더 누르면 폐기됩니다' : '이 영수증 폐기'}
        </button>
      )}

      {d.progress.ready > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: '480px', padding: '12px 16px',
          backgroundColor: '#fff', borderTop: '1px solid #e5e7eb', boxSizing: 'border-box',
        }}>
          <button
            onClick={() => void confirm()}
            disabled={confirming}
            style={{
              width: '100%', height: '50px', borderRadius: '12px', border: 'none',
              backgroundColor: confirming ? '#9ca3af' : '#1a7f37', color: '#fff',
              fontSize: '16px', fontWeight: 700,
            }}
          >
            {confirming ? '입고 중…' : `${d.progress.ready}건 입고 확정`}
          </button>
        </div>
      )}
    </div>
  );
}
