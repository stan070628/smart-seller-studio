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
import ReceiptSkuSplit from './ReceiptSkuSplit';
import { blockedLines, emptyDraft, preOpeningNotice, toSkuSplits, type LineSkuOptions, type SkuCandidateView, type SplitDraft } from './sku-split';

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
  /** 실사 이전 구매라 원장 입고를 건너뛴 SKU 안내(I3) */
  const [info, setInfo] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** 폐기는 두 번 눌러야 실행된다. window.confirm은 모바일에서 거칠고 테스트도 어렵다 */
  const [discardArmed, setDiscardArmed] = useState(false);
  // 1-C1: 확정 대기 줄의 재고 SKU 후보(원장 입고 분배) · 사람이 고른 분배 · SKU 검색 목록(처음 검색할 때 읽는다)
  const [skuOptions, setSkuOptions] = useState<Record<number, LineSkuOptions>>({});
  /** 옵션 정보 상태. 'ok'가 아니면 어느 줄이 옵션을 나눠야 하는지 모르므로 확정을 막는다 */
  const [skuOptionsStatus, setSkuOptionsStatus] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [splitDrafts, setSplitDrafts] = useState<Record<number, SplitDraft>>({});
  const [allSkus, setAllSkus] = useState<SkuCandidateView[] | null>(null);

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

  /**
   * 상품 목록을 다시 읽는다.
   *
   * 마운트 때 한 번만 읽으면, 화면을 열어둔 채 상품을 새로 만들었을 때
   * 드롭다운에 나타나지 않는다 — 2026-08-09 실사용에서 실제로 걸렸다.
   * 상품을 등록하고 곧바로 영수증을 확정하는 흐름에서는 반드시 발생한다.
   *
   * 실패해도 조용히 넘긴다. 줄 검토는 계속할 수 있다.
   */
  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/cost-management/products/options');
      const json = await res.json();
      if (json.success) setProducts(json.data);
    } catch {
      // 무시 — 이전 목록으로 계속 쓴다
    }
  }, []);

  /**
   * 확정 대기 줄의 재고 SKU 후보. 실패하면 알리고 다시 시도 버튼을 준다 — 조용히 넘기면 옵션을 나눠야 하는 줄이
   * 안내 없이 확정돼 그 줄만 실패한다. 다시 읽는 동안에는 직전 결과를 그대로 쓴다(상태를 'loading'으로 되돌리지 않는다).
   */
  const loadSkuOptions = useCallback(async () => {
    try {
      const res = await fetch(`/api/erp/receipts/${draftId}/sku-options`);
      const json = await res.json();
      if (!json.success) { setSkuOptionsStatus('failed'); return; }
      setSkuOptions(json.data as Record<number, LineSkuOptions>);
      setSkuOptionsStatus('ok');
    } catch {
      setSkuOptionsStatus('failed');
    }
  }, [draftId]);

  const loadAllSkus = useCallback(async () => {
    if (allSkus !== null) return;
    try {
      const res = await fetch('/api/erp/stock');
      const json = await res.json();
      if (json.success) {
        setAllSkus((json.data as { skuId: number; key: string; name: string; option: string }[])
          .map((s) => ({ skuId: s.skuId, key: s.key, name: s.name, option: s.option })));
      }
    } catch {
      // 무시 — 검색 결과가 비어 보일 뿐이다
    }
  }, [allSkus]);

  useEffect(() => {
    void load();
    void loadProducts();
    void loadSkuOptions();
  }, [load, loadProducts, loadSkuOptions]);

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
    // 상품이 바뀌면 SKU 후보가 달라진다 — 옛 상품 기준으로 나눠 둔 수량·고른 SKU를 지운다
    if ('product_cost_id' in patch) {
      setSplitDrafts((m) => {
        if (!(lineNo in m)) return m;
        const next = { ...m };
        delete next[lineNo];
        return next;
      });
    }
    // 줄을 고칠 때마다 상품 목록도 다시 읽는다 — 그 사이 새로 만든 상품이 보이도록
    await Promise.all([load(), loadProducts(), loadSkuOptions()]);
  }, [draftId, load, loadProducts, loadSkuOptions]);

  async function confirm() {
    setConfirming(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/receipts/${draftId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku_splits: toSkuSplits(skuOptions, splitDrafts) }),
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
      setInfo(preOpeningNotice(json.data.skipped_pre_opening));
      await Promise.all([load(), loadSkuOptions()]);
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

  // 확정 전 검사(I2). 서버도 같은 검사를 하지만, 틀린 채 보내면 그 줄만 실패해 다시 해야 한다
  const blocked = skuOptionsStatus === 'ok' ? blockedLines(skuOptions, splitDrafts) : [];
  const confirmBlockedReason =
    skuOptionsStatus === 'loading' ? '옵션 정보를 불러오는 중입니다'
      : skuOptionsStatus === 'failed' ? '옵션 정보를 불러온 뒤 확정할 수 있습니다'
        : blocked.length > 0 ? `${blocked.join(', ')}번 줄 옵션 수량을 나눠 주세요` : null;

  if (error && !d) return <div role="alert" style={{ padding: '16px', color: '#b91c1c' }}>{error}</div>;
  if (!d) return <div style={{ padding: '16px', color: '#374151' }}>불러오는 중…</div>;

  // verify_detail은 검사별 결과 + status 문자열이 섞인 객체다. 검사만 걸러낸다
  const failedChecks: [string, CheckDetail][] = Object.entries(d.verify_detail ?? {})
    .filter(([k, v]) =>
      k !== 'status' && typeof v === 'object' && v !== null && (v as CheckDetail).status === 'fail')
    .map(([k, v]) => [k, v as CheckDetail]);

  return (
    <div style={{ padding: '16px', paddingBottom: '96px' }}>
      <button
        onClick={() => router.push('/m/receipt')}
        style={{ background: 'none', border: 'none', color: '#374151', fontSize: '13px', fontWeight: 600,
                 padding: 0, marginBottom: '12px' }}
      >← 목록</button>

      <div style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '14px',
                    border: '1px solid #e5e7eb', marginBottom: '12px' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>
          {d.purchased_at ? String(d.purchased_at).slice(0, 10) : '날짜 미확인'}
          {d.store_name && (
            <span style={{ fontSize: '13px', color: '#374151', fontWeight: 400 }}> · {d.store_name}</span>
          )}
        </div>
        <div style={{ marginTop: '4px', fontSize: '13px', color: '#374151' }}>
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
                      textAlign: 'center', color: '#374151', fontSize: '13px', marginBottom: '12px' }}>
          {d.badge.label}입니다. 10분 주기로 자동 처리됩니다.
        </div>
      )}

      {result && (
        <div style={{ backgroundColor: '#e7f6ec', borderRadius: '10px', padding: '12px',
                      marginBottom: '12px', fontSize: '13px', color: '#1a7f37', fontWeight: 700 }}>
          {result}
        </div>
      )}

      {info && (
        <div role="status" style={{ backgroundColor: '#eff6ff', borderRadius: '10px', padding: '12px',
                                    marginBottom: '12px', fontSize: '13px', color: '#1d4ed8' }}>{info}</div>
      )}

      {error && (
        <div role="alert" style={{ backgroundColor: '#fdecec', borderRadius: '10px', padding: '12px',
                                   marginBottom: '12px', fontSize: '13px', color: '#b91c1c' }}>{error}</div>
      )}

      {skuOptionsStatus === 'failed' && (
        <div role="alert" style={{ backgroundColor: '#fff4e5', borderRadius: '10px', padding: '12px',
                                   marginBottom: '12px', fontSize: '13px', color: '#7c2d12',
                                   display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <span style={{ fontWeight: 700 }}>옵션 정보를 불러오지 못했습니다</span>
          <button
            type="button"
            onClick={() => void loadSkuOptions()}
            style={{ height: '32px', padding: '0 12px', borderRadius: '8px', border: '1px solid #c2410c',
                     backgroundColor: '#fff', color: '#c2410c', fontSize: '12px', fontWeight: 700 }}
          >다시 시도</button>
        </div>
      )}

      {d.lines.map((l) => (
        <div key={l.id}>
          <ReceiptLineRow line={l} products={products} onPatch={patchLine} />
          {skuOptions[l.line_no] && l.cost_entry_id == null && l.decision === 'ingest' && (
            <ReceiptSkuSplit
              options={skuOptions[l.line_no]}
              draft={splitDrafts[l.line_no] ?? emptyDraft()}
              allSkus={allSkus ?? []}
              onChange={(dr) => setSplitDrafts((m) => ({ ...m, [l.line_no]: dr }))}
              onNeedSkus={() => void loadAllSkus()}
            />
          )}
        </div>
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
            color: discardArmed ? '#fff' : '#374151',
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
          {confirmBlockedReason && (
            <div style={{ fontSize: '12px', color: '#b45309', fontWeight: 700, marginBottom: '6px', textAlign: 'center' }}>
              {confirmBlockedReason}
            </div>
          )}
          <button
            onClick={() => void confirm()}
            disabled={confirming || confirmBlockedReason !== null}
            style={{
              width: '100%', height: '50px', borderRadius: '12px', border: 'none',
              backgroundColor: confirming || confirmBlockedReason !== null ? '#9ca3af' : '#1a7f37', color: '#fff',
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
