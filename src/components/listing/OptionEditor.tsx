'use client';

/**
 * OptionEditor.tsx
 * 도매꾹 상품 옵션 편집 컴포넌트
 *
 * - 상태별 분기: 로딩 / 에러 / 옵션없음 / 옵션있음
 * - 옵션 테이블: 체크박스 토글, 가격 편집, 마진율 자동 계산
 * - 일괄 가격 수정: 목표 마진율 입력 → 쿠팡/네이버 가격 일괄 계산
 */

import React, { useState, useCallback } from 'react';
import { useListingStore } from '@/store/useListingStore';
import type { NormalizedOptionVariant } from '@/types/product-option';

// ─── 색상 상수 ──────────────────────────────────────────────────────────────
const C = {
  bg: '#fafafa',
  card: '#ffffff',
  border: '#eeeeee',
  text: '#18181b',
  textSub: '#926f6b',
  accent: '#be0014',
  tableHeader: '#f8f8f8',
  btnPrimaryBg: '#be0014',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#18181b',
  soldOutBg: '#f5f5f5',
  errorText: '#b91c1c',
  errorBg: '#fff1f2',
  errorBorder: '#fecdd3',
  lowMarginText: '#dc2626',
  successText: '#15803d',
};

// ─── 할인율 계산 헬퍼 (정가 대비 판매가 할인율) ─────────────────────────────
function calcMargin(salePrice: number, costPrice: number): number | null {
  if (costPrice <= 0) return null;
  return ((costPrice - salePrice) / costPrice) * 100;
}

// ─── 마진율로 역산한 판매가 ─────────────────────────────────────────────────
function priceFromMargin(costPrice: number, marginPct: number): number {
  // salePrice = costPrice / (1 - margin/100)
  if (marginPct >= 100) return costPrice * 100; // 방어
  return Math.ceil(costPrice / (1 - marginPct / 100));
}

// ─── 스켈레톤 행 ────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr>
      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <td key={i} style={{ padding: '10px 12px' }}>
          <div
            style={{
              height: '14px',
              borderRadius: '4px',
              backgroundColor: '#e5e5e5',
              width: i === 2 ? '80%' : '60%',
              animation: 'skeleton-pulse 1.4s ease-in-out infinite',
            }}
          />
        </td>
      ))}
    </tr>
  );
}

// ─── 가격 인풋 셀 ────────────────────────────────────────────────────────────
interface PriceInputProps {
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}
function PriceInput({ value, disabled, onChange }: PriceInputProps) {
  const [localVal, setLocalVal] = useState(String(value));

  // 외부 value가 바뀌면 localVal 동기화
  React.useEffect(() => {
    setLocalVal(String(value));
  }, [value]);

  return (
    <input
      type="number"
      min="0"
      disabled={disabled}
      value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => {
        const n = parseInt(localVal, 10);
        if (!isNaN(n) && n >= 0) onChange(n);
        else setLocalVal(String(value));
      }}
      style={{
        width: '90px',
        padding: '5px 8px',
        fontSize: '12px',
        border: `1px solid ${C.border}`,
        borderRadius: '6px',
        outline: 'none',
        color: disabled ? '#a1a1aa' : C.text,
        backgroundColor: disabled ? '#f5f5f5' : '#fff',
        boxSizing: 'border-box' as const,
      }}
    />
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────────
interface OptionEditorProps {
  itemNo?: number; // 재시도 버튼에서 itemNo를 다시 호출할 때 사용
}

export default function OptionEditor({ itemNo }: OptionEditorProps) {
  const { sharedDraft, fetchOptions, updateVariantPrice, toggleVariant, toggleAllVariants } =
    useListingStore();

  const { options, optionsLoading, optionsError } = sharedDraft;

  // ─── 일괄 마진율 입력 상태 ────────────────────────────────────────────────
  const [bulkMargin, setBulkMargin] = useState('');

  // ─── 전체선택 체크박스 상태 (품절 제외한 활성 행 기준) ───────────────────
  const enabledVariants = options?.variants.filter((v) => !v.soldOut) ?? [];
  const allChecked =
    enabledVariants.length > 0 && enabledVariants.every((v) => v.enabled);
  const someChecked = enabledVariants.some((v) => v.enabled);

  const handleToggleAll = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      toggleAllVariants(e.target.checked);
    },
    [toggleAllVariants],
  );

  // ─── 일괄 가격 적용 ──────────────────────────────────────────────────────
  const handleBulkApply = useCallback(
    (platform: 'coupang' | 'naver') => {
      const marginPct = parseFloat(bulkMargin);
      if (isNaN(marginPct) || marginPct <= 0 || marginPct >= 100) return;
      if (!options) return;
      options.variants.forEach((v) => {
        if (v.soldOut) return; // 품절 variant는 스킵
        const newPrice = priceFromMargin(v.costPrice, marginPct);
        updateVariantPrice(v.variantId, platform, newPrice);
      });
    },
    [bulkMargin, options, updateVariantPrice],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // 상태별 렌더
  // ─────────────────────────────────────────────────────────────────────────

  // 로딩 중
  if (optionsLoading) {
    return (
      <div
        style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <SectionHeader />
        <div style={{ padding: '0 0 4px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <TableHead allChecked={false} someChecked={false} onToggleAll={() => {}} disabled />
            <tbody>
              {[1, 2, 3].map((i) => <SkeletonRow key={i} />)}
            </tbody>
          </table>
        </div>
        <div
          style={{
            padding: '12px 16px',
            fontSize: '12px',
            color: C.textSub,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              border: `2px solid ${C.accent}`,
              borderTopColor: 'transparent',
              animation: 'spin 0.8s linear infinite',
              flexShrink: 0,
            }}
          />
          옵션 불러오는 중...
        </div>
        <style>{`
          @keyframes skeleton-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // 에러
  if (optionsError) {
    return (
      <div
        style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <SectionHeader />
        <div
          style={{
            margin: '12px 16px',
            padding: '14px 16px',
            backgroundColor: C.errorBg,
            border: `1px solid ${C.errorBorder}`,
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
          }}
        >
          <span style={{ fontSize: '16px', lineHeight: 1, flexShrink: 0 }}>⚠</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', color: C.errorText, fontWeight: 600, marginBottom: '4px' }}>
              옵션 조회 실패
            </div>
            <div style={{ fontSize: '12px', color: C.errorText }}>{optionsError}</div>
          </div>
          {itemNo !== undefined && (
            <button
              type="button"
              onClick={() => fetchOptions(itemNo)}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: C.btnPrimaryBg,
                color: C.btnPrimaryText,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              재시도
            </button>
          )}
        </div>
      </div>
    );
  }

  // 옵션 없음 (null 또는 hasOptions=false)
  if (!options || !options.hasOptions) {
    return (
      <div
        style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <SectionHeader />
        <div
          style={{
            padding: '20px 16px',
            fontSize: '13px',
            color: '#a1a1aa',
            textAlign: 'center',
          }}
        >
          {options === null
            ? '상품번호를 입력하면 옵션이 자동으로 불러와집니다.'
            : '이 상품에 옵션이 없습니다.'}
        </div>
      </div>
    );
  }

  // ─── 옵션 있음 ───────────────────────────────────────────────────────────
  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <SectionHeader />

      {/* 옵션 그룹 뱃지 */}
      <div
        style={{
          padding: '10px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          borderBottom: `1px solid ${C.border}`,
          backgroundColor: C.bg,
        }}
      >
        {options.groups.map((g) => (
          <span
            key={g.groupName}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 10px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: 'rgba(190,0,20,0.07)',
              color: C.accent,
              border: '1px solid rgba(190,0,20,0.15)',
              borderRadius: '100px',
            }}
          >
            {g.groupName}
            <span
              style={{
                fontSize: '11px',
                fontWeight: 400,
                color: C.textSub,
              }}
            >
              {g.values.length}개
            </span>
          </span>
        ))}
        <span style={{ fontSize: '12px', color: C.textSub, alignSelf: 'center' }}>
          — 총 {options.variants.length}개 조합
          {options.variants.filter((v) => v.soldOut).length > 0 && (
            <span style={{ color: '#a1a1aa', marginLeft: '6px' }}>
              (품절 {options.variants.filter((v) => v.soldOut).length}개 포함)
            </span>
          )}
        </span>
      </div>

      {/* 일괄 마진율 적용 영역 */}
      <div
        style={{
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          borderBottom: `1px solid ${C.border}`,
          backgroundColor: '#fffbfb',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 600, color: C.text, whiteSpace: 'nowrap' }}>
          마진율
        </span>
        <input
          type="number"
          min="1"
          max="99"
          value={bulkMargin}
          onChange={(e) => setBulkMargin(e.target.value)}
          placeholder="예: 15"
          style={{
            width: '70px',
            padding: '5px 8px',
            fontSize: '12px',
            border: `1px solid ${C.border}`,
            borderRadius: '6px',
            outline: 'none',
            color: C.text,
            backgroundColor: '#fff',
            boxSizing: 'border-box' as const,
          }}
        />
        <span style={{ fontSize: '12px', color: C.textSub }}>% 로 전체 적용</span>
        <button
          type="button"
          onClick={() => handleBulkApply('coupang')}
          style={{
            padding: '5px 14px',
            fontSize: '12px',
            fontWeight: 600,
            backgroundColor: C.btnPrimaryBg,
            color: C.btnPrimaryText,
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          쿠팡 적용
        </button>
        <button
          type="button"
          onClick={() => handleBulkApply('naver')}
          style={{
            padding: '5px 14px',
            fontSize: '12px',
            fontWeight: 600,
            backgroundColor: '#03c75a',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          네이버 적용
        </button>
      </div>

      {/* 옵션 테이블 */}
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '12px',
          }}
        >
          <TableHead
            allChecked={allChecked}
            someChecked={someChecked}
            onToggleAll={handleToggleAll}
            disabled={false}
          />
          <tbody>
            {options.variants.map((variant) => (
              <VariantRow
                key={variant.variantId}
                variant={variant}
                onToggle={() => toggleVariant(variant.variantId)}
                onPriceChange={(platform, price) =>
                  updateVariantPrice(variant.variantId, platform, price)
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      <style>{`
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ─── 섹션 헤더 ──────────────────────────────────────────────────────────────
function SectionHeader() {
  return (
    <div
      style={{
        padding: '10px 16px',
        fontSize: '13px',
        fontWeight: 600,
        color: C.text,
        backgroundColor: C.tableHeader,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      옵션 편집
    </div>
  );
}

// ─── 테이블 헤더 ────────────────────────────────────────────────────────────
interface TableHeadProps {
  allChecked: boolean;
  someChecked: boolean;
  onToggleAll: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
}
function TableHead({ allChecked, someChecked, onToggleAll, disabled }: TableHeadProps) {
  const thStyle: React.CSSProperties = {
    padding: '9px 12px',
    textAlign: 'left',
    fontSize: '11px',
    fontWeight: 700,
    color: C.textSub,
    backgroundColor: C.tableHeader,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: 'nowrap',
  };
  return (
    <thead>
      <tr>
        <th style={{ ...thStyle, width: '36px', textAlign: 'center' }}>
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = !allChecked && someChecked;
            }}
            onChange={onToggleAll}
            disabled={disabled}
            style={{ cursor: disabled ? 'default' : 'pointer' }}
          />
        </th>
        <th style={thStyle}>옵션</th>
        <th style={{ ...thStyle, textAlign: 'right' }}>원가</th>
        <th style={{ ...thStyle, textAlign: 'right' }}>쿠팡가</th>
        <th style={{ ...thStyle, textAlign: 'right' }}>할인율 (쿠)</th>
        <th style={{ ...thStyle, textAlign: 'right' }}>네이버가</th>
        <th style={{ ...thStyle, textAlign: 'right' }}>할인율 (네)</th>
        <th style={{ ...thStyle, textAlign: 'right' }}>재고</th>
        <th style={{ ...thStyle, textAlign: 'center' }}>상태</th>
      </tr>
    </thead>
  );
}

// ─── 개별 행 컴포넌트 ────────────────────────────────────────────────────────
interface VariantRowProps {
  variant: NormalizedOptionVariant;
  onToggle: () => void;
  onPriceChange: (platform: 'coupang' | 'naver', price: number) => void;
}
function VariantRow({ variant, onToggle, onPriceChange }: VariantRowProps) {
  const isSoldOut = variant.soldOut;
  const isDisabled = isSoldOut || !variant.enabled;

  const coupangMargin = calcMargin(variant.salePrices.coupang, variant.costPrice);
  const naverMargin = calcMargin(variant.salePrices.naver, variant.costPrice);

  const marginStyle = (m: number | null): React.CSSProperties => ({
    color: m === null ? C.textSub : m < 30 ? C.lowMarginText : C.successText,
    fontWeight: 600,
    fontSize: '12px',
  });

  const tdStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderBottom: `1px solid ${C.border}`,
    backgroundColor: isSoldOut ? C.soldOutBg : variant.enabled ? '#fff' : '#fafafa',
    verticalAlign: 'middle',
  };

  return (
    <tr style={{ opacity: isSoldOut ? 0.55 : 1 }}>
      {/* 체크박스 */}
      <td style={{ ...tdStyle, textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={variant.enabled}
          disabled={isSoldOut}
          onChange={onToggle}
          style={{ cursor: isSoldOut ? 'not-allowed' : 'pointer' }}
        />
      </td>

      {/* 옵션값 조합 */}
      <td style={tdStyle}>
        <span
          style={{
            color: isSoldOut ? '#a1a1aa' : isDisabled ? '#71717a' : C.text,
            fontWeight: 500,
          }}
        >
          {variant.optionValues.join(' / ')}
        </span>
      </td>

      {/* 원가 (읽기전용) */}
      <td style={{ ...tdStyle, textAlign: 'right', color: C.textSub, fontFamily: 'monospace' }}>
        {variant.costPrice.toLocaleString()}원
      </td>

      {/* 쿠팡가 */}
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        <PriceInput
          value={variant.salePrices.coupang}
          disabled={isSoldOut}
          onChange={(v) => onPriceChange('coupang', v)}
        />
      </td>

      {/* 쿠팡 마진율 */}
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        <span style={marginStyle(coupangMargin)}>
          {coupangMargin !== null ? `${coupangMargin.toFixed(1)}%` : '—'}
        </span>
      </td>

      {/* 네이버가 */}
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        <PriceInput
          value={variant.salePrices.naver}
          disabled={isSoldOut}
          onChange={(v) => onPriceChange('naver', v)}
        />
      </td>

      {/* 네이버 마진율 */}
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        <span style={marginStyle(naverMargin)}>
          {naverMargin !== null ? `${naverMargin.toFixed(1)}%` : '—'}
        </span>
      </td>

      {/* 재고 (읽기전용) */}
      <td style={{ ...tdStyle, textAlign: 'right', color: C.textSub, fontFamily: 'monospace' }}>
        {variant.stock}
      </td>

      {/* 상태 뱃지 */}
      <td style={{ ...tdStyle, textAlign: 'center' }}>
        {isSoldOut ? (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              color: '#a1a1aa',
              backgroundColor: '#e5e5e5',
              padding: '2px 8px',
              borderRadius: '100px',
            }}
          >
            품절
          </span>
        ) : variant.enabled ? (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              color: '#15803d',
              backgroundColor: 'rgba(21,128,61,0.08)',
              padding: '2px 8px',
              borderRadius: '100px',
            }}
          >
            활성
          </span>
        ) : (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              color: '#71717a',
              backgroundColor: '#f3f3f3',
              padding: '2px 8px',
              borderRadius: '100px',
            }}
          >
            제외
          </span>
        )}
      </td>
    </tr>
  );
}
