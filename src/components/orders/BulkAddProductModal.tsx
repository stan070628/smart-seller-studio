'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Search, RefreshCw } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { E } from '@/lib/design-tokens';

/**
 * 쿠팡 등록상품을 여러 건 골라 원가관리에 한 번에 올린다.
 *
 * 단건 흐름(AddProductModal)은 그대로 남아 있다 — 쿠팡에 없는 상품을 가상 ID로
 * 넣는 경로는 여기 없기 때문이다. 이 창은 "쿠팡에 있는데 원가관리에 없는 것"만 다룬다.
 *
 * 값 결정은 두 단계다. 왼쪽에서 고르고, 오른쪽 기본값을 [일괄 적용]으로 밀어넣은 뒤,
 * 미리보기 표에서 건별로 고친다. 수수료율은 카테고리마다 달라 자동 판정이 불가능하므로
 * 10.8%(로켓그로스 기준)를 넣어두고 고치기 쉬운 자리에 뒀다.
 */

interface CoupangProduct {
  seller_product_id: number;
  seller_product_name: string;
  status_name?: string;
  already_registered?: boolean;
}

/** 서버가 옵션별 onSale을 확인해 내린 판정 */
interface SaleVerdict {
  sellable: boolean;
  reason: string;
}

/** 쿠팡이 판매를 허용하는 유일한 상품 상태. 심사중·승인반려는 팔 수 없다. */
const SELLABLE_STATUS = '승인완료';

/** 건별로 확정된 값. 기본값을 적용해도 여기 값이 우선한다. */
interface Override {
  product_name: string;
  fee_rate: string;
  subdivision: string;
}

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

const DEFAULT_FEE = '10.8';

export default function BulkAddProductModal({ onClose, onAdded }: Props) {
  const [all, setAll] = useState<CoupangProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Map<number, Override>>(new Map());

  const [search, setSearch] = useState('');
  const [onlyUnregistered, setOnlyUnregistered] = useState(true);
  // 판매불가(승인 안 남 · 판매중지)는 기본으로 숨긴다. 예외적으로 넣어야 할 때만 연다.
  const [includeUnsellable, setIncludeUnsellable] = useState(false);
  const [saleStatus, setSaleStatus] = useState<Map<number, SaleVerdict>>(new Map());
  const [checkingSale, setCheckingSale] = useState(false);

  const [defaultFee, setDefaultFee] = useState(DEFAULT_FEE);
  const [defaultSub, setDefaultSub] = useState('');

  const fetchList = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/cost-management/coupang-products')
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setAll(j.data);
        else setError(j.error ?? '상품 목록을 불러오지 못했습니다.');
      })
      .catch(() => setError('네트워크 오류가 발생했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  /**
   * 목록이 도착하면 판매상태를 뒤따라 확인한다. 상품당 상세 1콜 + 옵션 1~n콜이라
   * 목록 로딩에 넣으면 창이 20초 넘게 비어 있게 된다 — 목록을 먼저 보여주고 채운다.
   * 상태가 이미 판매불가인 상품(심사중·승인반려)은 물어볼 필요가 없어 제외한다.
   */
  useEffect(() => {
    const targets = all
      .filter((p) => !p.already_registered && p.status_name === SELLABLE_STATUS)
      .map((p) => p.seller_product_id);
    if (targets.length === 0) return;

    let cancelled = false;
    setCheckingSale(true);
    fetch('/api/cost-management/coupang-products/sale-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seller_product_ids: targets }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j.success) return;
        const map = new Map<number, SaleVerdict>();
        for (const v of j.data as Array<{ seller_product_id: number; sellable: boolean; reason: string }>) {
          map.set(v.seller_product_id, { sellable: v.sellable, reason: v.reason });
        }
        setSaleStatus(map);
        // 숨겨질 상품이 선택된 채로 남으면 "3건 추가"가 실제와 어긋난다.
        setSelected((prev) => {
          const next = new Set(prev);
          for (const [id, v] of map) if (!v.sellable) next.delete(id);
          return next;
        });
      })
      .catch(() => {
        // 판정에 실패하면 아무것도 숨기지 않는다 — 못 본 것을 없는 것으로 처리하지 않는다.
      })
      .finally(() => { if (!cancelled) setCheckingSale(false); });

    return () => { cancelled = true; };
  }, [all]);

  /**
   * 판매상태를 확인하지 못한 상품인지. 숨기지는 않되 표시는 한다 —
   * 로켓그로스 상품은 marketplace 옵션 경로에 vendorItemId가 없어 onSale을 볼 수 없다.
   */
  const isUnverified = useCallback(
    (p: CoupangProduct): boolean => {
      const v = saleStatus.get(p.seller_product_id);
      return !!v && v.sellable && v.reason !== '판매중';
    },
    [saleStatus],
  );

  /** 팔 수 없는 이유. 팔 수 있으면 null. */
  const unsellableReason = useCallback(
    (p: CoupangProduct): string | null => {
      if (p.status_name && p.status_name !== SELLABLE_STATUS) return p.status_name;
      const v = saleStatus.get(p.seller_product_id);
      if (v && !v.sellable) return v.reason;
      return null;
    },
    [saleStatus],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((p) => {
      if (onlyUnregistered && p.already_registered) return false;
      if (!includeUnsellable && unsellableReason(p)) return false;
      if (!q) return true;
      return (
        p.seller_product_name.toLowerCase().includes(q) ||
        String(p.seller_product_id).includes(q)
      );
    });
  }, [all, search, onlyUnregistered, includeUnsellable, unsellableReason]);

  /** 판매불가로 걸러진 건수 — 몇 개가 빠졌는지 사용자가 알아야 한다. */
  const hiddenUnsellableCount = useMemo(
    () => all.filter((p) => !p.already_registered && unsellableReason(p)).length,
    [all, unsellableReason],
  );

  const unregisteredCount = useMemo(
    () => all.filter((p) => !p.already_registered).length,
    [all],
  );

  /** 화면에 보이는 것 중 몇 개가 선택됐는지 — 전체선택 체크박스의 상태를 정한다. */
  const visibleSelectedCount = visible.filter((p) => selected.has(p.seller_product_id)).length;
  const allVisibleSelected = visible.length > 0 && visibleSelectedCount === visible.length;

  function toggleOne(p: CoupangProduct) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p.seller_product_id)) next.delete(p.seller_product_id);
      else next.add(p.seller_product_id);
      return next;
    });
    // 처음 고르는 순간 기본값으로 한 줄 만들어 둔다 — [일괄 적용]을 누르지 않아도 등록된다.
    setOverrides((prev) => {
      if (prev.has(p.seller_product_id)) return prev;
      const next = new Map(prev);
      next.set(p.seller_product_id, {
        product_name: p.seller_product_name,
        fee_rate: defaultFee,
        subdivision: defaultSub,
      });
      return next;
    });
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        visible.forEach((p) => next.delete(p.seller_product_id));
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((p) => next.add(p.seller_product_id));
      return next;
    });
    setOverrides((prev) => {
      const next = new Map(prev);
      visible.forEach((p) => {
        if (!next.has(p.seller_product_id)) {
          next.set(p.seller_product_id, {
            product_name: p.seller_product_name,
            fee_rate: defaultFee,
            subdivision: defaultSub,
          });
        }
      });
      return next;
    });
  }

  /** 기본값을 선택된 모든 건에 밀어넣는다 — 건별 수정은 덮인다. */
  function applyDefaults() {
    if (selected.size === 0) {
      toast.error('먼저 상품을 선택하세요.');
      return;
    }
    setOverrides((prev) => {
      const next = new Map(prev);
      selected.forEach((id) => {
        const base = next.get(id);
        const name = base?.product_name
          ?? all.find((p) => p.seller_product_id === id)?.seller_product_name
          ?? '';
        next.set(id, { product_name: name, fee_rate: defaultFee, subdivision: defaultSub });
      });
      return next;
    });
    toast.success(`${selected.size}건에 기본값을 적용했습니다.`);
  }

  function patchOverride(id: number, patch: Partial<Override>) {
    setOverrides((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      if (!cur) return prev;
      next.set(id, { ...cur, ...patch });
      return next;
    });
  }

  const selectedRows = useMemo(
    () =>
      all
        .filter((p) => selected.has(p.seller_product_id))
        .map((p) => ({ product: p, ov: overrides.get(p.seller_product_id) })),
    [all, selected, overrides],
  );

  /** 등록을 막는 입력이 있으면 사유를 돌려준다. */
  const blocking = useMemo(() => {
    for (const { product, ov } of selectedRows) {
      if (!ov) continue;
      if (!ov.product_name.trim()) return `${product.seller_product_name}: 상품명이 비어 있습니다`;
      const fee = Number(ov.fee_rate);
      if (ov.fee_rate.trim() === '' || Number.isNaN(fee) || fee <= 0 || fee >= 100) {
        return `${product.seller_product_name}: 수수료율은 0보다 크고 100보다 작아야 합니다`;
      }
      if (ov.subdivision.trim() !== '') {
        const sub = Number(ov.subdivision);
        if (!Number.isInteger(sub) || sub < 1) {
          return `${product.seller_product_name}: 소분 갯수는 1 이상의 정수여야 합니다`;
        }
      }
    }
    return null;
  }, [selectedRows]);

  async function submit() {
    if (selected.size === 0 || blocking) return;
    setSaving(true);
    try {
      const items = selectedRows.map(({ product, ov }) => ({
        product_name: (ov?.product_name ?? product.seller_product_name).trim(),
        seller_product_id: product.seller_product_id,
        platform_fee_rate: Number(ov?.fee_rate ?? DEFAULT_FEE) / 100,
        ...(ov?.subdivision.trim() ? { subdivision_unit: Number(ov.subdivision) } : {}),
      }));

      const res = await fetch('/api/cost-management/products/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();

      if (!json.success) {
        toast.error(json.error ?? '일괄 등록에 실패했습니다.');
        return;
      }

      const { created_count, skipped_count, skipped } = json.data as {
        created_count: number;
        skipped_count: number;
        skipped: Array<{ product_name: string; reason: string }>;
      };

      if (created_count > 0) toast.success(`${created_count}건을 원가관리에 추가했습니다.`);
      if (skipped_count > 0) {
        // 건너뛴 건은 사유를 보여준다 — 왜 6건 골랐는데 4건만 들어갔는지 알 수 있어야 한다.
        const head = skipped.slice(0, 3).map((s) => `${s.product_name}: ${s.reason}`).join(' / ');
        const tail = skipped_count > 3 ? ` 외 ${skipped_count - 3}건` : '';
        toast.error(`${skipped_count}건 건너뜀 — ${head}${tail}`);
      }

      if (created_count > 0) {
        onAdded();
        onClose();
      } else {
        // 하나도 안 들어갔으면 창을 닫지 않는다 — 고쳐서 다시 시도할 수 있게 남긴다.
        fetchList();
      }
    } catch {
      toast.error('네트워크 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  // ── 스타일 ────────────────────────────────────────────────────────────────
  const label: React.CSSProperties = {
    fontSize: 11.5, fontWeight: 600, color: E.inkSub, minWidth: 96,
  };
  const input: React.CSSProperties = {
    font: 'inherit', fontSize: 12, border: `1px solid ${E.line}`, background: E.surface,
    color: E.ink, height: 25, padding: '2px 6px', borderRadius: 0, boxSizing: 'border-box',
  };
  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, height: E.ctrlH, padding: '0 11px',
    font: 'inherit', fontSize: 11.5, fontWeight: 500, color: E.ink, background: E.surface,
    border: `1px solid ${E.line}`, borderRadius: 0, cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const th: React.CSSProperties = {
    background: E.chrome, borderBottom: `1px solid ${E.line}`, borderRight: `1px solid ${E.lineSoft}`,
    padding: '5px 8px', fontSize: 11, fontWeight: 600, color: E.inkSub, whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '3px 6px',
  };

  const canSubmit = selected.size > 0 && !blocking && !saving;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(22,32,42,0.45)' }} />
      <div style={{
        position: 'relative', width: 'min(960px, 94vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        background: E.surface, border: `1px solid ${E.line}`, boxShadow: '0 16px 48px rgba(22,32,42,.28)',
      }}>

        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: E.chrome, borderBottom: `1px solid ${E.line}` }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: E.ink }}>쿠팡 상품 불러오기</h3>
          <span style={{ fontSize: 11, color: E.inkSub }}>
            {loading
              ? '조회 중…'
              : checkingSale
                ? `원가관리에 없는 상품 ${unregisteredCount}건 · 판매상태 확인 중…`
                : `원가관리에 없는 상품 ${unregisteredCount}건`
                  + (hiddenUnsellableCount > 0 ? ` · 판매불가 ${hiddenUnsellableCount}건 제외` : '')}
          </span>
          <button
            onClick={fetchList}
            disabled={loading}
            title="목록 새로고침"
            style={{ ...btn, marginLeft: 'auto', height: 22, padding: '0 8px' }}
          >
            <RefreshCw size={11} /> 새로고침
          </button>
          <button onClick={onClose} aria-label="닫기" style={{ ...btn, width: 22, height: 22, padding: 0, justifyContent: 'center' }}>
            <X size={12} />
          </button>
        </div>

        {/* minmax(0, …)가 없으면 왼쪽 목록의 긴 상품명이 min-content로 트랙을 밀어
            630:267까지 벌어진다. fr만으로는 축소를 허용하지 않는다. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)',
          flex: 1,
          minHeight: 0,
        }}>

          {/* ── 왼쪽: 선택 ── */}
          <div style={{ borderRight: `1px solid ${E.line}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: E.chrome2, borderBottom: `1px solid ${E.line}`, fontSize: 11, color: E.inkSub }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => { if (el) el.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected; }}
                  onChange={toggleAllVisible}
                  style={{ accentColor: E.accent, width: 13, height: 13, margin: 0 }}
                />
                전체 선택
              </label>
              <span style={{ marginLeft: 'auto', fontFamily: E.mono, color: E.ink, fontSize: 11 }}>
                {selected.size} / {visible.length} 선택
              </span>
            </div>

            <div style={{ padding: '6px 10px', borderBottom: `1px solid ${E.lineSoft}`, background: E.chrome2, display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${E.line}`, background: E.surface, height: E.ctrlH, padding: '0 8px' }}>
                <Search size={11} color={E.inkMute} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="상품명·상품ID 검색"
                  style={{ border: 'none', background: 'transparent', font: 'inherit', fontSize: 11.5, width: '100%', color: E.ink, outline: 'none' }}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: E.inkSub, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={onlyUnregistered}
                  onChange={(e) => setOnlyUnregistered(e.target.checked)}
                  style={{ accentColor: E.accent, width: 13, height: 13, margin: 0 }}
                />
                미등록만
              </label>
              <label
                title="심사중·승인반려·판매중지 상품까지 목록에 넣습니다"
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: E.inkSub, whiteSpace: 'nowrap', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={includeUnsellable}
                  onChange={(e) => setIncludeUnsellable(e.target.checked)}
                  style={{ accentColor: E.accent, width: 13, height: 13, margin: 0 }}
                />
                판매불가 포함
              </label>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, minHeight: 160 }}>
              {loading ? (
                <div style={{ padding: 24, textAlign: 'center', color: E.inkSub, fontSize: 12 }}>불러오는 중…</div>
              ) : error ? (
                <div style={{ padding: 20, textAlign: 'center', fontSize: 12 }}>
                  <div style={{ color: E.loss, marginBottom: 6, fontWeight: 600 }}>상품 목록 조회 실패</div>
                  <div style={{ color: E.inkSub, fontSize: 11, marginBottom: 10 }}>{error}</div>
                  <button onClick={fetchList} style={btn}>다시 시도</button>
                </div>
              ) : visible.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: E.inkSub, fontSize: 12 }}>
                  {search
                    ? '검색 결과가 없습니다.'
                    : hiddenUnsellableCount > 0
                      ? `추가할 수 있는 상품이 없습니다. 판매불가 ${hiddenUnsellableCount}건은 위의 [판매불가 포함]으로 볼 수 있습니다.`
                      : '추가할 수 있는 쿠팡 상품이 없습니다.'}
                </div>
              ) : visible.map((p, i) => {
                const on = selected.has(p.seller_product_id);
                const blocked = unsellableReason(p);
                return (
                  <label
                    key={p.seller_product_id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                      borderBottom: `1px solid ${E.lineSoft}`, fontSize: 12, cursor: 'pointer',
                      background: on ? E.accentSoft : i % 2 === 1 ? E.chrome2 : E.surface,
                      boxShadow: on ? `inset 2px 0 0 ${E.accent}` : 'none',
                      color: E.ink,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleOne(p)}
                      style={{ accentColor: E.accent, width: 13, height: 13, margin: 0, flexShrink: 0 }}
                    />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.seller_product_name}
                    </span>
                    {!blocked && isUnverified(p) && (
                      <span
                        title="판매중지 여부를 확인할 수 없는 상품입니다 (로켓그로스 등). 직접 확인하세요."
                        style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', border: `1px solid ${E.line}`, color: E.inkMute, flexShrink: 0 }}
                      >
                        상태 미확인
                      </span>
                    )}
                    {blocked && (
                      <span
                        title="판매할 수 없는 상태입니다"
                        style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', border: `1px solid ${E.loss}`, color: E.loss, flexShrink: 0 }}
                      >
                        {blocked}
                      </span>
                    )}
                    {p.already_registered && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', border: `1px solid ${E.warn}`, background: E.warnSoft, color: E.warn, flexShrink: 0 }}>
                        추가 등록
                      </span>
                    )}
                    <span style={{ fontFamily: E.mono, fontSize: 10.5, color: E.inkMute, flexShrink: 0 }}>
                      #{p.seller_product_id}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* ── 오른쪽: 기본값 + 미리보기 ── */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '5px 10px', background: E.chrome2, borderBottom: `1px solid ${E.line}`, fontSize: 11, fontWeight: 600, color: E.inkSub }}>
              선택 항목에 적용할 기본값
            </div>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, borderBottom: `1px solid ${E.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label htmlFor="bulk-fee" style={label}>플랫폼 수수료율</label>
                <input
                  id="bulk-fee"
                  value={defaultFee}
                  onChange={(e) => setDefaultFee(e.target.value)}
                  inputMode="decimal"
                  style={{ ...input, width: 66, textAlign: 'right', fontFamily: E.mono }}
                />
                <span style={{ fontSize: 10.5, color: E.inkMute }}>% · 카테고리마다 다르니 표에서 건별로 고치세요</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label htmlFor="bulk-sub" style={label}>소분 갯수</label>
                <input
                  id="bulk-sub"
                  value={defaultSub}
                  onChange={(e) => setDefaultSub(e.target.value)}
                  inputMode="numeric"
                  placeholder="없음"
                  style={{ ...input, width: 66, textAlign: 'right', fontFamily: E.mono }}
                />
                <span style={{ fontSize: 10.5, color: E.inkMute }}>비우면 소분 없음</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={applyDefaults} style={btn}>선택 항목에 일괄 적용</button>
                <span style={{ fontSize: 10.5, color: E.inkMute }}>적용 후 아래 표에서 건별로 고칠 수 있습니다</span>
              </div>
            </div>

            <div style={{ padding: '5px 10px', background: E.chrome2, borderBottom: `1px solid ${E.line}`, fontSize: 11, fontWeight: 600, color: E.inkSub }}>
              등록될 내용 · {selected.size}건
            </div>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 120 }}>
              {selectedRows.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: E.inkMute, fontSize: 12 }}>
                  왼쪽에서 상품을 선택하세요.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: 'left' }}>상품명</th>
                      <th style={{ ...th, width: 66 }}>수수료</th>
                      <th style={{ ...th, width: 58, borderRight: 'none' }}>소분</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRows.map(({ product, ov }, i) => (
                      <tr key={product.seller_product_id} style={{ background: i % 2 === 1 ? E.chrome2 : E.surface }}>
                        <td style={td}>
                          <input
                            value={ov?.product_name ?? ''}
                            onChange={(e) => patchOverride(product.seller_product_id, { product_name: e.target.value })}
                            style={{ ...input, width: '100%', height: 23, border: `1px solid transparent`, background: 'transparent' }}
                            onFocus={(e) => { e.target.style.border = `1px solid ${E.line}`; e.target.style.background = E.surface; }}
                            onBlur={(e) => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                          />
                        </td>
                        <td style={td}>
                          <input
                            value={ov?.fee_rate ?? ''}
                            onChange={(e) => patchOverride(product.seller_product_id, { fee_rate: e.target.value })}
                            inputMode="decimal"
                            style={{ ...input, width: '100%', height: 23, textAlign: 'right', fontFamily: E.mono }}
                          />
                        </td>
                        <td style={{ ...td, borderRight: 'none' }}>
                          <input
                            value={ov?.subdivision ?? ''}
                            onChange={(e) => patchOverride(product.seller_product_id, { subdivision: e.target.value })}
                            inputMode="numeric"
                            placeholder="—"
                            style={{ ...input, width: '100%', height: 23, textAlign: 'right', fontFamily: E.mono }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* 하단 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: E.chrome2, borderTop: `1px solid ${E.line}` }}>
          <span style={{ fontSize: 11, color: blocking ? E.loss : E.inkSub }}>
            {blocking ?? '이미 원가관리에 있는 상품은 서버에서 한 번 더 걸러집니다.'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button onClick={onClose} style={btn}>취소</button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              style={{
                ...btn,
                background: canSubmit ? E.accent : '#c9d1d6',
                borderColor: canSubmit ? E.accent : '#c9d1d6',
                color: canSubmit ? '#fff' : '#6b7780',
                fontWeight: 600,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {saving ? '추가 중…' : `${selected.size}건 추가`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
