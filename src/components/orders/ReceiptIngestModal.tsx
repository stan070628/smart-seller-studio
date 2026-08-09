'use client';

/**
 * 영수증 입고 모달 (데스크탑)
 *
 * 모바일과 같은 API를 쓰지만 배치가 다르다. **데스크탑에만 있는 이점은
 * 영수증 원본과 판독 결과를 나란히 놓고 대조할 수 있다는 것**이라,
 * 좌측에 원본 이미지를 크게 두고 우측에서 줄을 편집한다.
 *
 * 검산이 깨졌을 때 특히 값이 있다 — 모바일은 "3, 7번 줄이 틀렸다"까지만
 * 알려주지만 여기서는 원본에서 바로 확인할 수 있다.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Badge, Progress } from '@/lib/receipt/view';
import type { LineData, ProductOption } from '@/components/receipt/ReceiptLineRow';

interface DraftCard {
  id: string;
  purchased_at: string | null;
  store_name: string | null;
  receipt_total: number | null;
  image_count: number;
  badge: Badge;
  progress: Progress;
}

interface CheckDetail {
  status: string;
  expected: number | null;
  actual: number | null;
  diff: number | null;
  badLineNos?: number[];
}

interface Detail {
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
  images_purged_at: string | null;
  badge: Badge;
  progress: Progress;
  lines: LineData[];
}

const CHECK_LABEL: Record<string, string> = {
  totalSum: '품목 합계',
  lineArithmetic: '줄별 수량×단가',
  itemCount: '총 상품수',
  taxBreakdown: '과세·면세 구분',
};

const won = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('ko-KR')}원`);

interface Props {
  onClose: () => void;
  /** 확정으로 입고가 생기면 부모가 목록을 다시 읽는다 */
  onConfirmed: () => void;
}

export default function ReceiptIngestModal({ onClose, onConfirmed }: Props) {
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** 검산이 지목한 줄. 클릭하면 강조된다 */
  const [highlight, setHighlight] = useState<number | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/receipts?status=draft');
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '조회 실패');
      setDrafts(json.data);
      setSelected((cur) => cur ?? json.data[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패');
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/receipts/${id}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '조회 실패');
      setDetail(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패');
    }
  }, []);

  /**
   * 상품 목록을 다시 읽는다. 마운트 때 한 번만 읽으면 화면을 열어둔 채
   * 상품을 새로 만들었을 때 드롭다운에 나타나지 않는다.
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

  useEffect(() => {
    void loadList();
    void loadProducts();
  }, [loadList, loadProducts]);

  useEffect(() => {
    if (selected) void loadDetail(selected);
  }, [selected, loadDetail]);

  const patchLine = useCallback(async (lineNo: number, patch: Record<string, unknown>) => {
    if (!selected) return;
    const res = await fetch(`/api/receipts/${selected}/lines/${lineNo}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!json.success) { setError(json.error ?? '수정 실패'); return; }
    setError(null);
    // 줄을 고칠 때마다 상품 목록도 다시 읽는다 — 그 사이 새로 만든 상품이 보이도록
    await Promise.all([loadDetail(selected), loadList(), loadProducts()]);
  }, [selected, loadDetail, loadList, loadProducts]);

  async function confirm() {
    if (!selected) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/receipts/${selected}/confirm`, {
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
      await loadDetail(selected);
      await loadList();
      onConfirmed();
    } catch (e) {
      setError(e instanceof Error ? e.message : '확정 실패');
    } finally {
      setConfirming(false);
    }
  }

  const failedChecks: [string, CheckDetail][] = Object.entries(detail?.verify_detail ?? {})
    .filter(([k, v]) =>
      k !== 'status' && typeof v === 'object' && v !== null && (v as CheckDetail).status === 'fail')
    .map(([k, v]) => [k, v as CheckDetail]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '90vw', maxWidth: '1400px', height: '88vh', background: '#fff',
          borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* 헤더 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid #e5e5e5', flexShrink: 0,
        }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#18181b' }}>
            영수증 입고
            {drafts.length > 0 && (
              <span style={{ fontSize: '12px', color: '#71717a', fontWeight: 400, marginLeft: '8px' }}>
                대기 {drafts.length}건
              </span>
            )}
          </div>
          <button onClick={onClose} style={{
            border: 'none', background: 'none', fontSize: '20px', color: '#71717a', cursor: 'pointer',
          }}>×</button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* 좌: 영수증 원본 */}
          <div style={{
            width: '38%', borderRight: '1px solid #e5e5e5', overflow: 'auto',
            background: '#fafafa', padding: '12px',
          }}>
            {!detail ? (
              <div style={{ color: '#a1a1aa', fontSize: '12px', textAlign: 'center', paddingTop: '40px' }}>
                초안을 선택하세요
              </div>
            ) : detail.images_purged_at ? (
              <div style={{
                color: '#92400e', fontSize: '12px', background: '#fffbeb',
                border: '1px solid #fde68a', borderRadius: '8px', padding: '12px',
              }}>
                이미지는 보관 기간(3개월)이 지나 삭제됐습니다.<br />
                판독된 값과 입고 기록은 그대로 남아 있습니다.
              </div>
            ) : detail.image_urls.length === 0 ? (
              <div style={{ color: '#a1a1aa', fontSize: '12px' }}>이미지가 없습니다.</div>
            ) : (
              detail.image_urls.map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={u}
                  src={u}
                  alt={`영수증 ${i + 1}`}
                  style={{ width: '100%', marginBottom: '10px', borderRadius: '6px', display: 'block' }}
                />
              ))
            )}
          </div>

          {/* 우: 초안 목록 + 줄 편집 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* 초안 선택 */}
            <div style={{
              display: 'flex', gap: '6px', padding: '10px 16px', borderBottom: '1px solid #f4f4f5',
              overflowX: 'auto', flexShrink: 0,
            }}>
              {drafts.length === 0 && (
                <span style={{ fontSize: '12px', color: '#a1a1aa' }}>
                  대기 중인 영수증이 없습니다. 폰에서 촬영하면 여기에 나타납니다.
                </span>
              )}
              {drafts.map((d) => (
                <button
                  key={d.id}
                  onClick={() => { setSelected(d.id); setResult(null); setHighlight(null); }}
                  style={{
                    padding: '6px 12px', borderRadius: '8px', whiteSpace: 'nowrap',
                    border: `1px solid ${selected === d.id ? '#18181b' : '#e5e5e5'}`,
                    background: selected === d.id ? '#18181b' : '#fff',
                    color: selected === d.id ? '#fff' : '#52525b',
                    fontSize: '12px', fontWeight: selected === d.id ? 600 : 400, cursor: 'pointer',
                  }}
                >
                  {d.purchased_at ? String(d.purchased_at).slice(5, 10) : '날짜?'} · {won(d.receipt_total)}
                  {d.progress.ready > 0 && ` · 대기 ${d.progress.ready}`}
                </button>
              ))}
            </div>

            {/* 본문 */}
            <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
              {!detail ? (
                <div style={{ color: '#a1a1aa', fontSize: '12px' }}>불러오는 중…</div>
              ) : (
                <>
                  <div style={{ fontSize: '13px', color: '#52525b', marginBottom: '10px' }}>
                    {detail.purchased_at ? String(detail.purchased_at).slice(0, 10) : '날짜 미확인'}
                    {detail.store_name && ` · ${detail.store_name}`}
                    {' · '}합계 {won(detail.receipt_total)}
                    {' · '}품목 {detail.progress.total}줄
                  </div>

                  {failedChecks.length > 0 && (
                    <div style={{
                      background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px',
                      padding: '10px 12px', marginBottom: '10px', fontSize: '12px', color: '#92400e',
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                        검산이 맞지 않습니다 — 왼쪽 원본과 대조하세요
                      </div>
                      {failedChecks.map(([k, v]) => (
                        <div key={k} style={{ marginTop: '2px' }}>
                          · {CHECK_LABEL[k] ?? k}
                          {v.diff != null && ` — 차액 ${v.diff.toLocaleString('ko-KR')}원`}
                          {v.badLineNos?.length ? (
                            <>
                              {' — '}
                              {v.badLineNos.map((n) => (
                                <button
                                  key={n}
                                  onClick={() => setHighlight(n)}
                                  style={{
                                    border: 'none', background: 'none', color: '#b45309',
                                    textDecoration: 'underline', cursor: 'pointer', padding: '0 3px',
                                    fontSize: '12px', fontWeight: 700,
                                  }}
                                >{n}번</button>
                              ))}
                              줄
                            </>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}

                  {result && (
                    <div style={{
                      background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px',
                      padding: '10px 12px', marginBottom: '10px', fontSize: '12px',
                      color: '#15803d', fontWeight: 600,
                    }}>{result}</div>
                  )}

                  {error && (
                    <div role="alert" style={{
                      background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
                      padding: '10px 12px', marginBottom: '10px', fontSize: '12px', color: '#b91c1c',
                    }}>{error}</div>
                  )}

                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ color: '#71717a', textAlign: 'left' }}>
                        <th style={{ padding: '6px 4px', width: '32px' }}>#</th>
                        <th style={{ padding: '6px 4px' }}>품목</th>
                        <th style={{ padding: '6px 4px', width: '90px', textAlign: 'right' }}>금액</th>
                        <th style={{ padding: '6px 4px', width: '120px' }}>결정</th>
                        <th style={{ padding: '6px 4px', width: '30%' }}>입고 상품</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((l) => (
                        <ModalLineRow
                          key={l.id}
                          line={l}
                          products={products}
                          highlighted={highlight === l.line_no}
                          onPatch={patchLine}
                        />
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>

            {/* 하단 확정 */}
            <div style={{
              padding: '12px 16px', borderTop: '1px solid #e5e5e5', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: '12px', color: '#71717a' }}>
                {detail && (
                  <>
                    확정 {detail.progress.confirmed}
                    {detail.progress.blocked > 0 && ` · 상품 미지정 ${detail.progress.blocked}`}
                    {detail.progress.undecided > 0 && ` · 미정 ${detail.progress.undecided}`}
                  </>
                )}
              </span>
              <button
                onClick={() => void confirm()}
                disabled={confirming || !detail || detail.progress.ready === 0}
                style={{
                  padding: '9px 20px', borderRadius: '8px', border: 'none',
                  background: !detail || detail.progress.ready === 0 ? '#d4d4d8' : '#18181b',
                  color: '#fff', fontSize: '13px', fontWeight: 700,
                  cursor: !detail || detail.progress.ready === 0 ? 'default' : 'pointer',
                }}
              >
                {confirming ? '입고 중…' : `${detail?.progress.ready ?? 0}건 입고 확정`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 표 한 줄. 모바일 카드와 같은 API를 쓰되 표 형태로 압축한다 */
function ModalLineRow({
  line, products, highlighted, onPatch,
}: {
  line: LineData;
  products: ProductOption[];
  highlighted: boolean;
  onPatch: (lineNo: number, patch: Record<string, unknown>) => Promise<void>;
}) {
  const locked = line.cost_entry_id != null;

  if (line.is_discount) {
    return (
      <tr style={{ background: highlighted ? '#fef3c7' : '#fffbeb', color: '#b45309' }}>
        <td style={{ padding: '6px 4px' }}>{line.line_no}</td>
        <td style={{ padding: '6px 4px' }} colSpan={2}>
          할인 {won(line.amount)}
          {line.applies_to_line_no != null && ` → ${line.applies_to_line_no}번 줄에 반영`}
        </td>
        <td colSpan={2} />
      </tr>
    );
  }

  return (
    <tr style={{
      borderTop: '1px solid #f4f4f5',
      background: highlighted ? '#fef3c7' : undefined,
    }}>
      <td style={{ padding: '6px 4px', color: '#a1a1aa' }}>{line.line_no}</td>
      <td style={{ padding: '6px 4px' }}>
        <div style={{ fontWeight: 600, color: '#18181b' }}>{line.item_label}</div>
        <div style={{ color: '#a1a1aa', fontSize: '11px' }}>
          {line.item_code ?? '품번 없음'} · {line.quantity}개
        </div>
      </td>
      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
        <div style={{ fontWeight: 700 }}>{won(line.net_amount)}</div>
        {line.net_amount !== line.amount && (
          <div style={{ color: '#b45309', fontSize: '11px' }}>할인 전 {won(line.amount)}</div>
        )}
      </td>
      <td style={{ padding: '6px 4px' }}>
        {locked ? (
          <span style={{ color: '#15803d', fontWeight: 700 }}>입고 완료</span>
        ) : (
          <div style={{ display: 'flex', gap: '4px' }}>
            {(['ingest', 'skip'] as const).map((d) => (
              <button
                key={d}
                onClick={() => void onPatch(line.line_no, { decision: d })}
                style={{
                  padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                  border: line.decision === d ? 'none' : '1px solid #e5e5e5',
                  background: line.decision === d ? (d === 'ingest' ? '#15803d' : '#71717a') : '#fff',
                  color: line.decision === d ? '#fff' : '#52525b', cursor: 'pointer',
                }}
              >{d === 'ingest' ? '입고' : '제외'}</button>
            ))}
          </div>
        )}
      </td>
      <td style={{ padding: '6px 4px' }}>
        {locked ? null : line.decision === 'ingest' ? (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <select
              aria-label={`${line.line_no}번 입고 상품`}
              value={line.product_cost_id ?? ''}
              onChange={(e) => {
                const id = e.target.value || null;
                const prod = products.find((p) => p.id === id);
                void onPatch(line.line_no, {
                  product_cost_id: id,
                  entry_type: line.entry_type ?? 'normal',
                  subdivision_unit: line.subdivision_unit ?? prod?.subdivision_unit ?? null,
                });
              }}
              style={{
                flex: 1, minWidth: 0, height: '28px', borderRadius: '6px', fontSize: '11px',
                border: line.product_cost_id ? '1px solid #e5e5e5' : '1px solid #f87171',
                padding: '0 4px',
              }}
            >
              <option value="">상품 선택…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.product_name}</option>
              ))}
            </select>
            {line.entry_type === 'subdivision' && (
              <>
                <input
                  type="number" min={1} aria-label={`${line.line_no}번 박스당 개수`}
                  defaultValue={line.items_per_box ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value);
                    if (v !== line.items_per_box) void onPatch(line.line_no, { items_per_box: v });
                  }}
                  style={{ width: '48px', height: '28px', borderRadius: '6px', border: '1px solid #e5e5e5', fontSize: '11px', padding: '0 4px' }}
                />
                <input
                  type="number" min={1} aria-label={`${line.line_no}번 소분 단위`}
                  defaultValue={line.subdivision_unit ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value);
                    if (v !== line.subdivision_unit) void onPatch(line.line_no, { subdivision_unit: v });
                  }}
                  style={{ width: '48px', height: '28px', borderRadius: '6px', border: '1px solid #e5e5e5', fontSize: '11px', padding: '0 4px' }}
                />
              </>
            )}
            <button
              onClick={() => void onPatch(line.line_no, {
                entry_type: line.entry_type === 'subdivision' ? 'normal' : 'subdivision',
              })}
              title="일반 ↔ 소분"
              style={{
                padding: '4px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                border: '1px solid #e5e5e5',
                background: line.entry_type === 'subdivision' ? '#3f3f46' : '#fff',
                color: line.entry_type === 'subdivision' ? '#fff' : '#52525b', cursor: 'pointer',
              }}
            >소분</button>
          </div>
        ) : line.decision === 'skip' && line.item_code ? (
          <button
            onClick={() => void onPatch(line.line_no, {
              decision: 'skip', remember: line.remembered_decision !== 'skip',
            })}
            style={{
              padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
              border: line.remembered_decision === 'skip' ? 'none' : '1px solid #e5e5e5',
              background: line.remembered_decision === 'skip' ? '#52525b' : '#fff',
              color: line.remembered_decision === 'skip' ? '#fff' : '#71717a', cursor: 'pointer',
            }}
          >
            {line.remembered_decision === 'skip' ? '✓ 항상 제외' : '항상 제외'}
          </button>
        ) : null}
      </td>
    </tr>
  );
}
