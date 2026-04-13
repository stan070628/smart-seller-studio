'use client';

/**
 * ListingDashboard.tsx
 * 오픈마켓 상품 자동등록 메인 클라이언트 컴포넌트
 *
 * 레이아웃: 헤더 → 플랫폼 탭 → 빈 상태 or 등록 테이블
 * 스타일: 인라인 style 사용 (밝은 테마)
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { PLATFORMS } from '@/types/listing';
import type { PlatformId, ListingStatus, ProductListing } from '@/types/listing';
import BothRegisterForm from '@/components/listing/BothRegisterForm';
import DomeggookPreparePanel from '@/components/listing/DomeggookPreparePanel';

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#f9f9f9',
  card: '#ffffff',
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#926f6b',
  accent: '#be0014',
  tableHeader: '#f3f3f3',
  rowHover: '#f5f5f5',
  btnPrimaryBg: '#be0014',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#1a1c1c',
};

// ─────────────────────────────────────────────────────────────────────────────
// 유틸: 날짜 포맷
// ─────────────────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 유틸: 숫자 포맷 (천 단위 구분)
// ─────────────────────────────────────────────────────────────────────────────
function formatPrice(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}

// ─────────────────────────────────────────────────────────────────────────────
// 상태 뱃지
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<ListingStatus, string> = {
  draft: '초안',
  pending: '대기중',
  uploading: '업로드중',
  registered: '등록완료',
  failed: '실패',
  deleted: '삭제됨',
};

const STATUS_COLORS: Record<ListingStatus, { bg: string; text: string }> = {
  draft: { bg: '#f3f3f3', text: '#71717a' },
  pending: { bg: '#fef9c3', text: '#92400e' },
  uploading: { bg: '#dbeafe', text: '#1d4ed8' },
  registered: { bg: '#dcfce7', text: '#15803d' },
  failed: { bg: '#fee2e2', text: '#b91c1c' },
  deleted: { bg: '#f3f3f3', text: '#9ca3af' },
};

function StatusBadge({ status }: { status: ListingStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '100px',
        fontSize: '12px',
        fontWeight: 600,
        backgroundColor: color.bg,
        color: color.text,
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 등록 상품 테이블
// ─────────────────────────────────────────────────────────────────────────────
function ListingTable({ listings }: { listings: ProductListing[] }) {
  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '10px',
        overflow: 'hidden',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: C.tableHeader }}>
            {['상품명', '상태', '플랫폼 상품번호', '가격', '등록일'].map((col) => (
              <th
                key={col}
                style={{
                  padding: '10px 16px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: C.textSub,
                  textAlign: 'left',
                  borderBottom: `1px solid ${C.border}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {listings.map((item) => (
            <tr
              key={item.id}
              style={{ borderBottom: `1px solid ${C.border}` }}
            >
              {/* 상품명 */}
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: '13px',
                  color: C.text,
                  maxWidth: '280px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.title}
              </td>
              {/* 상태 */}
              <td style={{ padding: '12px 16px' }}>
                <StatusBadge status={item.status} />
              </td>
              {/* 플랫폼 상품번호 */}
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: '13px',
                  color: item.platformProductId ? C.text : C.textSub,
                  fontFamily: 'monospace',
                }}
              >
                {item.platformProductId ? (
                  item.platformProductUrl ? (
                    <a
                      href={item.platformProductUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: C.accent, textDecoration: 'none' }}
                    >
                      {item.platformProductId}
                    </a>
                  ) : (
                    item.platformProductId
                  )
                ) : (
                  '-'
                )}
              </td>
              {/* 가격 */}
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: '13px',
                  color: C.text,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {formatPrice(item.price)}
              </td>
              {/* 등록일 */}
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: '13px',
                  color: C.textSub,
                  whiteSpace: 'nowrap',
                }}
              >
                {item.registeredAt ? formatDate(item.registeredAt) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 빈 상태: 연동 전
// ─────────────────────────────────────────────────────────────────────────────
function EmptyConnectState({ platformLabel }: { platformLabel: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '80px 24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          backgroundColor: 'rgba(190, 0, 20, 0.07)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '28px',
        }}
      >
        🔗
      </div>
      <div>
        <p
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: C.text,
            marginBottom: '6px',
          }}
        >
          아직 연동된 플랫폼이 없습니다.
        </p>
        <p style={{ fontSize: '13px', color: C.textSub }}>
          플랫폼 API 키를 등록하면 상품을 자동으로 등록할 수 있습니다.
        </p>
      </div>
      <button
        style={{
          padding: '9px 20px',
          backgroundColor: C.btnPrimaryBg,
          color: C.btnPrimaryText,
          border: 'none',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
        }}
        onClick={() => alert('Phase 2에서 구현 예정입니다.')}
      >
        {platformLabel} 연동하기
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 빈 상태: 연동 후 등록 상품 없음
// ─────────────────────────────────────────────────────────────────────────────
function EmptyListState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '80px 24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          backgroundColor: C.tableHeader,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '28px',
        }}
      >
        📦
      </div>
      <div>
        <p
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: C.text,
            marginBottom: '6px',
          }}
        >
          등록된 상품이 없습니다.
        </p>
        <p style={{ fontSize: '13px', color: C.textSub }}>
          소싱 페이지에서 상품을 선택한 후 등록하세요.
        </p>
      </div>
      <Link
        href="/sourcing"
        style={{
          padding: '9px 20px',
          backgroundColor: C.btnSecondaryBg,
          color: C.btnSecondaryText,
          textDecoration: 'none',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 600,
          border: `1px solid ${C.border}`,
        }}
      >
        소싱 페이지로 이동
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 플랫폼 탭
// ─────────────────────────────────────────────────────────────────────────────
function PlatformTabs({
  activePlatform,
  onSelect,
  showBothMode,
  onToggleBothMode,
  showDomeggookPanel,
  onToggleDomeggookPanel,
}: {
  activePlatform: PlatformId;
  onSelect: (id: PlatformId) => void;
  showBothMode: boolean;
  onToggleBothMode: () => void;
  showDomeggookPanel: boolean;
  onToggleDomeggookPanel: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${C.border}`,
        backgroundColor: C.card,
        padding: '0 24px',
      }}
    >
      {/* 플랫폼 탭 목록 */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {PLATFORMS.map((platform) => {
          const isActive = activePlatform === platform.id;
          return (
            <button
              key={platform.id}
              onClick={() => platform.enabled && onSelect(platform.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '12px 16px',
                fontSize: '13px',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? C.accent : C.text,
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: isActive ? `2px solid ${C.accent}` : '2px solid transparent',
                cursor: platform.enabled ? 'pointer' : 'not-allowed',
                opacity: platform.enabled ? 1 : 0.4,
                marginBottom: '-1px',
                transition: 'color 0.15s',
              }}
            >
              <span style={{ fontSize: '16px' }}>{platform.emoji}</span>
              <span>{platform.label}</span>
              {!platform.enabled && (
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    color: '#71717a',
                    backgroundColor: '#f3f3f3',
                    border: `1px solid ${C.border}`,
                    borderRadius: '4px',
                    padding: '1px 5px',
                  }}
                >
                  준비중
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 우측 버튼 그룹 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* 도매꾹 불러오기 버튼 */}
        <button
          onClick={onToggleDomeggookPanel}
          style={{
            padding: '6px 14px',
            borderRadius: '8px',
            border: '1px solid #d1a800',
            backgroundColor: showDomeggookPanel ? '#f5c800' : 'rgba(245,200,0,0.1)',
            color: showDomeggookPanel ? '#1a1c1c' : '#a07c00',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          🏪
          {showDomeggookPanel ? '불러오기 닫기' : '도매꾹 불러오기'}
        </button>

        {/* 동시 등록 버튼 */}
        <button
          onClick={onToggleBothMode}
          style={{
            padding: '6px 14px',
            borderRadius: '8px',
            border: '1px solid rgba(190,0,20,0.3)',
            backgroundColor: showBothMode ? '#be0014' : 'rgba(190,0,20,0.07)',
            color: showBothMode ? '#ffffff' : '#be0014',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Layers size={14} />
          {showBothMode ? '단일 등록으로' : '동시 등록'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 쿠팡 상품 등록 폼
// ─────────────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: '13px',
  border: `1px solid ${C.border}`,
  borderRadius: '8px',
  outline: 'none',
  color: C.text,
  backgroundColor: '#fff',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: C.textSub,
  marginBottom: '6px',
};

// ─── 이미지 URL 미리보기 ─────────────────────────────────────────────────────

function ImageUrlPreview({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: C.textSub, marginBottom: '6px' }}>
        미리보기 ({urls.length}장)
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {urls.map((url, i) => (
          <ImageThumb key={i} url={url} index={i} />
        ))}
      </div>
    </div>
  );
}

function ImageThumb({ url, index }: { url: string; index: number }) {
  const [failed, setFailed] = React.useState(false);

  return (
    <div
      style={{
        position: 'relative',
        width: '60px',
        height: '60px',
        borderRadius: '6px',
        overflow: 'hidden',
        border: failed ? '2px solid #b91c1c' : `1px solid ${C.border}`,
        flexShrink: 0,
        backgroundColor: C.tableHeader,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {failed ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
          <span style={{ fontSize: '18px' }}>❌</span>
          <span style={{ fontSize: '9px', color: '#b91c1c', textAlign: 'center', lineHeight: 1.2, padding: '0 2px' }}>
            로드 실패
          </span>
        </div>
      ) : (
        <img
          src={url}
          alt={`이미지 ${index + 1}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setFailed(true)}
        />
      )}
      {index === 0 && !failed && (
        <span style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          fontSize: '9px', textAlign: 'center',
          backgroundColor: 'rgba(190,0,20,0.8)', color: '#fff', padding: '1px 0',
        }}>
          대표
        </span>
      )}
    </div>
  );
}

// ─── 카테고리 검색 선택기 ────────────────────────────────────────────────────

interface CategorySearchResult {
  code: number;
  name: string;
  path: string;
}

function CategoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string, path: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CategorySearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState('');
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // 디바운스 검색
  const search = (keyword: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!keyword.trim()) {
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/listing/coupang/categories?keyword=${encodeURIComponent(keyword)}`);
        const json = await res.json();
        if (json.success) setResults(json.data ?? []);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);
  };

  const handleSelect = (item: CategorySearchResult) => {
    onChange(String(item.code), item.path);
    setSelectedPath(item.path);
    setQuery('');
    setResults([]);
  };

  return (
    <div>
      {/* 선택된 카테고리 표시 */}
      {value && (
        <div style={{
          fontSize: '12px', color: C.accent, marginBottom: '8px',
          padding: '8px 12px', backgroundColor: 'rgba(190,0,20,0.05)',
          borderRadius: '6px', border: '1px solid rgba(190,0,20,0.1)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{selectedPath}</span>
          <span style={{ fontFamily: 'monospace', color: C.textSub, flexShrink: 0, marginLeft: '8px' }}>({value})</span>
        </div>
      )}

      {/* 검색 입력 */}
      <div style={{ position: 'relative' }}>
        <input
          style={inputStyle}
          value={query}
          onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
          placeholder="카테고리명 검색 (예: 등산가방, 마스크팩, 캠핑의자)"
        />
        {isLoading && (
          <span style={{
            position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
            fontSize: '11px', color: C.textSub,
          }}>
            검색 중...
          </span>
        )}
      </div>

      {/* 검색 결과 드롭다운 */}
      {results.length > 0 && (
        <div style={{
          marginTop: '4px', border: `1px solid ${C.border}`, borderRadius: '8px',
          backgroundColor: '#fff', maxHeight: '250px', overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}>
          {results.map((item) => (
            <div
              key={item.code}
              onClick={() => handleSelect(item)}
              style={{
                padding: '10px 14px', cursor: 'pointer',
                borderBottom: `1px solid ${C.border}`,
                fontSize: '13px',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.backgroundColor = C.tableHeader; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.backgroundColor = '#fff'; }}
            >
              <div style={{ fontWeight: 600, color: C.text, marginBottom: '2px' }}>{item.name}</div>
              <div style={{ fontSize: '11px', color: C.textSub }}>{item.path}</div>
            </div>
          ))}
        </div>
      )}

      {query && !isLoading && results.length === 0 && (
        <div style={{ marginTop: '4px', fontSize: '12px', color: C.textSub, padding: '8px' }}>
          검색 결과가 없습니다.
        </div>
      )}
    </div>
  );
}

// ─── 아코디언 섹션 ──────────────────────────────────────────────────────────

function Section({
  title,
  required,
  defaultOpen = true,
  children,
}: {
  title: string;
  required?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      backgroundColor: C.card, border: `1px solid ${C.border}`,
      borderRadius: '10px', overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>
          {title}
          {required && <span style={{ color: C.accent, marginLeft: '4px' }}>*</span>}
        </span>
        <span style={{ color: C.textSub, fontSize: '12px' }}>{open ? '접기' : '펼치기'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── 옵션 행 ────────────────────────────────────────────────────────────────

interface OptionRow {
  name: string;   // 예: 색상
  values: string;  // 예: 빨강, 파랑, 검정
}

function OptionEditor({
  options,
  onChange,
}: {
  options: OptionRow[];
  onChange: (options: OptionRow[]) => void;
}) {
  const addOption = () => onChange([...options, { name: '', values: '' }]);
  const removeOption = (i: number) => onChange(options.filter((_, idx) => idx !== i));
  const updateOption = (i: number, key: keyof OptionRow, val: string) => {
    const next = [...options];
    next[i] = { ...next[i], [key]: val };
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {options.map((opt, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 32px', gap: '8px', alignItems: 'center' }}>
          <input
            style={inputStyle}
            value={opt.name}
            onChange={(e) => updateOption(i, 'name', e.target.value)}
            placeholder="옵션명 (예: 색상)"
          />
          <input
            style={inputStyle}
            value={opt.values}
            onChange={(e) => updateOption(i, 'values', e.target.value)}
            placeholder="옵션값 (쉼표 구분, 예: 빨강, 파랑, 검정)"
          />
          <button
            type="button"
            onClick={() => removeOption(i)}
            style={{
              width: '28px', height: '28px', border: `1px solid ${C.border}`, borderRadius: '6px',
              backgroundColor: '#fff', cursor: 'pointer', fontSize: '14px', color: C.textSub,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            x
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addOption}
        style={{
          alignSelf: 'flex-start', padding: '6px 14px', fontSize: '12px', fontWeight: 600,
          backgroundColor: C.btnSecondaryBg, color: C.btnSecondaryText,
          border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer',
        }}
      >
        + 옵션 추가
      </button>
    </div>
  );
}

// ─── 등록 폼 ────────────────────────────────────────────────────────────────

const COUPANG_DEFAULTS_KEY = 'sss_coupang_defaults';

function loadCoupangDefaults(): { brand: string; deliveryChargeType: string; deliveryCharge: string; returnCharge: string } {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(COUPANG_DEFAULTS_KEY) : null;
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { brand: '', deliveryChargeType: 'FREE', deliveryCharge: '0', returnCharge: '5000' };
}

function saveCoupangDefaults(vals: { brand: string; deliveryChargeType: string; deliveryCharge: string; returnCharge: string }) {
  try {
    localStorage.setItem(COUPANG_DEFAULTS_KEY, JSON.stringify(vals));
  } catch { /* ignore */ }
}

function CoupangRegisterForm({ onClose }: { onClose: () => void }) {
  const { registerCoupangProduct, isRegistering, error, clearError, sharedDraft, updateSharedDraft } = useListingStore();

  const defaults = loadCoupangDefaults();

  const [form, setForm] = useState({
    // 판매방식
    fulfillmentType: 'VENDOR',  // VENDOR=판매자배송, ROCKET=로켓그로스
    // 기본 정보
    sellerProductName: sharedDraft.name || '',
    displayCategoryCode: '',
    categoryPath: '',
    brand: defaults.brand,
    noBrand: false,
    // 가격/재고
    salePrice: sharedDraft.salePrice || '',
    originalPrice: '',
    stock: sharedDraft.stock || '999',
    maximumBuyForPerson: '0',
    // 이미지
    thumbnailImages: sharedDraft.thumbnailImages.join('\n') || '',
    detailImages: sharedDraft.detailImages.join('\n') || '',
    // 상세설명
    description: sharedDraft.description || '',
    // 검색어
    searchTags: '',
    // 상품정보제공고시
    noticeCategory: '기타 재화',
    noticeModelName: '',
    noticeOrigin: '상세페이지 참조',
    noticeManufacturer: '상세페이지 참조',
    // 배송
    deliveryCompany: 'CJGLS',
    deliveryChargeType: sharedDraft.deliveryChargeType || defaults.deliveryChargeType,
    deliveryCharge: sharedDraft.deliveryCharge || defaults.deliveryCharge,
    freeShipOverAmount: '0',
    // 반품/교환
    returnCharge: sharedDraft.returnCharge || defaults.returnCharge,
    exchangeCharge: '5000',
  });

  const [options, setOptions] = useState<OptionRow[]>([]);

  const update = (key: string, value: string | boolean) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // 저장 대상 필드일 때 localStorage 동기화
      if (['brand', 'deliveryChargeType', 'deliveryCharge', 'returnCharge'].includes(key)) {
        saveCoupangDefaults({
          brand: key === 'brand' ? String(value) : next.brand,
          deliveryChargeType: key === 'deliveryChargeType' ? String(value) : next.deliveryChargeType,
          deliveryCharge: key === 'deliveryCharge' ? String(value) : next.deliveryCharge,
          returnCharge: key === 'returnCharge' ? String(value) : next.returnCharge,
        });
      }
      // sharedDraft 공통 필드 동기화
      const sharedFieldMap: Record<string, keyof typeof sharedDraft> = {
        sellerProductName: 'name',
        salePrice: 'salePrice',
        stock: 'stock',
        description: 'description',
        deliveryChargeType: 'deliveryChargeType',
        deliveryCharge: 'deliveryCharge',
        returnCharge: 'returnCharge',
      };
      if (key in sharedFieldMap) {
        updateSharedDraft({ [sharedFieldMap[key]]: String(value) } as Parameters<typeof updateSharedDraft>[0]);
      }
      if (key === 'thumbnailImages') {
        updateSharedDraft({ thumbnailImages: String(value).split('\n').map((s) => s.trim()).filter(Boolean) });
      }
      if (key === 'detailImages') {
        updateSharedDraft({ detailImages: String(value).split('\n').map((s) => s.trim()).filter(Boolean) });
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    const thumbnailImages = form.thumbnailImages.split('\n').map((s) => s.trim()).filter(Boolean);
    const detailImages = form.detailImages.split('\n').map((s) => s.trim()).filter(Boolean);
    if (thumbnailImages.length === 0) return;

    const result = await registerCoupangProduct({
      displayCategoryCode: parseInt(form.displayCategoryCode, 10),
      sellerProductName: form.sellerProductName,
      brand: form.noBrand ? '' : form.brand,
      salePrice: parseInt(form.salePrice, 10),
      originalPrice: form.originalPrice ? parseInt(form.originalPrice, 10) : undefined,
      stock: parseInt(form.stock, 10),
      thumbnailImages,
      detailImages: detailImages.length > 0 ? detailImages : undefined,
      description: form.description,
      deliveryChargeType: form.deliveryChargeType,
      deliveryCharge: parseInt(form.deliveryCharge, 10),
      returnCharge: parseInt(form.returnCharge, 10),
    });

    if (result) {
      alert(`상품 등록 완료! (ID: ${result.sellerProductId})`);
      onClose();
    }
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '16px',
      }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: C.text }}>
          쿠팡 상품 등록
        </h3>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', fontSize: '18px',
            color: C.textSub, cursor: 'pointer', padding: '4px',
          }}
        >
          x
        </button>
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: '16px', borderRadius: '8px',
          backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* ── 1. 판매방식 선택 ─────────────────────────────────────── */}
        <Section title="판매방식 선택" required>
          <div style={{ display: 'flex', gap: '16px' }}>
            {[
              { value: 'VENDOR', label: '판매자배송', desc: '직접 배송 처리' },
              { value: 'ROCKET', label: '로켓그로스', desc: '쿠팡 풀필먼트센터 배송' },
            ].map((opt) => (
              <label key={opt.value} style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px',
                border: `1px solid ${form.fulfillmentType === opt.value ? C.accent : C.border}`,
                borderRadius: '8px', cursor: 'pointer',
                backgroundColor: form.fulfillmentType === opt.value ? 'rgba(190,0,20,0.03)' : '#fff',
              }}>
                <input
                  type="radio"
                  name="fulfillmentType"
                  value={opt.value}
                  checked={form.fulfillmentType === opt.value}
                  onChange={(e) => update('fulfillmentType', e.target.value)}
                  style={{ accentColor: C.accent }}
                />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: C.text }}>{opt.label}</div>
                  <div style={{ fontSize: '11px', color: C.textSub }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </Section>

        {/* ── 2. 카테고리 ─────────────────────────────────────────── */}
        <Section title="카테고리" required>
          <CategoryPicker
            value={form.displayCategoryCode}
            onChange={(code, path) => {
              update('displayCategoryCode', code);
              setForm((prev) => ({ ...prev, categoryPath: path }));
            }}
          />
        </Section>

        {/* ── 3. 노출상품명 ───────────────────────────────────────── */}
        <Section title="노출상품명" required>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ ...labelStyle, marginBottom: 0, flexShrink: 0, width: '50px' }}>브랜드</label>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={form.brand}
              onChange={(e) => update('brand', e.target.value)}
              placeholder="상품에 표시된 브랜드 이름 (예: 나이키, 필라)"
              disabled={form.noBrand as boolean}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: C.textSub, whiteSpace: 'nowrap', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.noBrand as boolean}
                onChange={(e) => update('noBrand', e.target.checked)}
              />
              브랜드 없음
            </label>
          </div>
          <div>
            <label style={labelStyle}>
              노출상품명 *
              <span style={{ fontWeight: 400, color: C.textSub, marginLeft: '8px' }}>
                {(form.sellerProductName || '').length}/100
              </span>
            </label>
            <input
              style={inputStyle}
              value={form.sellerProductName}
              onChange={(e) => update('sellerProductName', e.target.value.slice(0, 100))}
              placeholder="상품 모델명 시리 + 상품 규격 + 핵심 특징"
              required
              maxLength={100}
            />
            <div style={{ fontSize: '11px', color: C.textSub, marginTop: '4px' }}>
              등록상품명(판매자관리용)은 노출상품명과 동일하게 자동 설정됩니다.
            </div>
          </div>
        </Section>

        {/* ── 4. 옵션 ─────────────────────────────────────────────── */}
        <Section title="옵션" defaultOpen={false}>
          <div style={{ fontSize: '12px', color: C.textSub, marginBottom: '4px' }}>
            색상, 사이즈 등 상품 옵션을 설정합니다. 옵션 없이 단일 상품으로 등록할 수 있습니다.
          </div>
          <OptionEditor options={options} onChange={setOptions} />
        </Section>

        {/* ── 5. 상품이미지 ───────────────────────────────────────── */}
        <Section title="상품이미지" required>
          {/* 썸네일 이미지 섹션 */}
          <div>
            <label style={labelStyle}>
              상품 이미지 (썸네일) <span style={{ color: C.accent }}>*</span>
            </label>
            <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '6px' }}>
              URL을 줄바꿈으로 구분 · 첫 번째가 대표이미지 · 최대 10개
            </div>
            <textarea
              style={{ ...inputStyle, height: '80px', resize: 'vertical' }}
              value={form.thumbnailImages}
              onChange={(e) => update('thumbnailImages', e.target.value)}
              placeholder={'https://example.com/image1.jpg\nhttps://example.com/image2.jpg'}
              required
            />
            <ImageUrlPreview
              urls={form.thumbnailImages.split('\n').map((s) => s.trim()).filter(Boolean)}
            />
          </div>
          {/* 상세페이지 이미지 섹션 */}
          <div style={{ marginTop: '12px' }}>
            <label style={labelStyle}>상세페이지 이미지</label>
            <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '6px' }}>
              상품 상세설명 하단에 자동 삽입됩니다 · 최대 20개
            </div>
            <textarea
              style={{ ...inputStyle, height: '80px', resize: 'vertical' }}
              value={form.detailImages}
              onChange={(e) => update('detailImages', e.target.value)}
              placeholder={'https://example.com/detail1.jpg\nhttps://example.com/detail2.jpg'}
            />
            <ImageUrlPreview
              urls={form.detailImages.split('\n').map((s) => s.trim()).filter(Boolean)}
            />
          </div>
        </Section>

        {/* ── 6. 상세설명 ─────────────────────────────────────────── */}
        <Section title="상세설명" required>
          <textarea
            style={{ ...inputStyle, minHeight: '150px', resize: 'vertical' }}
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            placeholder="상품 상세 설명을 입력하세요 (HTML 지원)"
            required
          />
        </Section>

        {/* ── 7. 가격/재고 ────────────────────────────────────────── */}
        <Section title="가격/재고" required>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>판매가 *</label>
              <input style={inputStyle} value={form.salePrice} onChange={(e) => update('salePrice', e.target.value)} placeholder="판매 가격" required type="number" min="100" />
            </div>
            <div>
              <label style={labelStyle}>정상가</label>
              <input style={inputStyle} value={form.originalPrice} onChange={(e) => update('originalPrice', e.target.value)} placeholder="할인 전 가격" type="number" />
            </div>
            <div>
              <label style={labelStyle}>재고</label>
              <input style={inputStyle} value={form.stock} onChange={(e) => update('stock', e.target.value)} type="number" min="1" />
            </div>
            <div>
              <label style={labelStyle}>1인당 최대 구매</label>
              <input style={inputStyle} value={form.maximumBuyForPerson} onChange={(e) => update('maximumBuyForPerson', e.target.value)} type="number" min="0" />
              <div style={{ fontSize: '10px', color: C.textSub, marginTop: '2px' }}>0 = 무제한</div>
            </div>
          </div>
        </Section>

        {/* ── 8. 검색어 ───────────────────────────────────────────── */}
        <Section title="검색어" defaultOpen={false}>
          <div style={{ fontSize: '12px', color: C.textSub, marginBottom: '4px' }}>
            쿠팡 내 검색 노출을 위한 태그입니다. 쉼표(,)로 구분하여 입력하세요.
          </div>
          <input
            style={inputStyle}
            value={form.searchTags}
            onChange={(e) => update('searchTags', e.target.value)}
            placeholder="예: 등산가방, 백팩, 경량, 패커블"
          />
        </Section>

        {/* ── 9. 상품정보제공고시 ──────────────────────────────────── */}
        <Section title="상품정보제공고시" required defaultOpen={false}>
          <div style={{ fontSize: '12px', color: C.textSub, marginBottom: '4px' }}>
            전자상거래법에 의한 필수 고시 항목입니다. 미입력 시 &quot;상세페이지 참조&quot;로 자동 등록됩니다.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>고시 카테고리</label>
              <select style={inputStyle} value={form.noticeCategory} onChange={(e) => update('noticeCategory', e.target.value)}>
                <option value="기타 재화">기타 재화</option>
                <option value="의류">의류</option>
                <option value="구두/신발">구두/신발</option>
                <option value="가방">가방</option>
                <option value="패션잡화(모자/벨트/액세서리)">패션잡화</option>
                <option value="화장품">화장품</option>
                <option value="식품(농수산물)">식품(농수산물)</option>
                <option value="가공식품">가공식품</option>
                <option value="건강기능식품">건강기능식품</option>
                <option value="영유아용품">영유아용품</option>
                <option value="전자제품">전자제품</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>품명 및 모델명</label>
              <input style={inputStyle} value={form.noticeModelName} onChange={(e) => update('noticeModelName', e.target.value)} placeholder="미입력 시 상품명으로 자동 설정" />
            </div>
            <div>
              <label style={labelStyle}>제조국(원산지)</label>
              <input style={inputStyle} value={form.noticeOrigin} onChange={(e) => update('noticeOrigin', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>제조자/수입자</label>
              <input style={inputStyle} value={form.noticeManufacturer} onChange={(e) => update('noticeManufacturer', e.target.value)} />
            </div>
          </div>
        </Section>

        {/* ── 10. 배송 ────────────────────────────────────────────── */}
        <Section title="배송" required>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>택배사</label>
              <select style={inputStyle} value={form.deliveryCompany} onChange={(e) => update('deliveryCompany', e.target.value)}>
                <option value="CJGLS">CJ대한통운</option>
                <option value="KGB">로젠택배</option>
                <option value="EPOST">우체국택배</option>
                <option value="HANJIN">한진택배</option>
                <option value="HYUNDAI">롯데택배</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>배송비 유형</label>
              <select style={inputStyle} value={form.deliveryChargeType} onChange={(e) => update('deliveryChargeType', e.target.value)}>
                <option value="FREE">무료배송</option>
                <option value="NOT_FREE">유료배송</option>
                <option value="CHARGE_RECEIVED">착불</option>
                <option value="CONDITIONAL_FREE">조건부 무료</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>배송비 (원)</label>
              <input style={inputStyle} value={form.deliveryCharge} onChange={(e) => update('deliveryCharge', e.target.value)} type="number" min="0" />
            </div>
            {(form.deliveryChargeType as string) === 'CONDITIONAL_FREE' && (
              <div>
                <label style={labelStyle}>무료배송 기준 금액</label>
                <input style={inputStyle} value={form.freeShipOverAmount} onChange={(e) => update('freeShipOverAmount', e.target.value)} type="number" min="0" />
              </div>
            )}
          </div>
        </Section>

        {/* ── 11. 반품/교환 ───────────────────────────────────────── */}
        <Section title="반품/교환" required>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>반품 배송비 (편도)</label>
              <input style={inputStyle} value={form.returnCharge} onChange={(e) => update('returnCharge', e.target.value)} type="number" min="0" />
            </div>
            <div>
              <label style={labelStyle}>교환 배송비 (왕복)</label>
              <input style={inputStyle} value={form.exchangeCharge} onChange={(e) => update('exchangeCharge', e.target.value)} type="number" min="0" />
            </div>
          </div>
          <div style={{ fontSize: '11px', color: C.textSub }}>
            출고지/반품지 주소는 쿠팡 Wing에 등록된 정보가 자동 적용됩니다.
          </div>
        </Section>

        {/* ── 하단 버튼 ───────────────────────────────────────────── */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: '8px',
          marginTop: '8px', padding: '16px 0',
          borderTop: `1px solid ${C.border}`,
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 24px', fontSize: '13px', fontWeight: 600,
              backgroundColor: C.btnSecondaryBg, color: C.btnSecondaryText,
              border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            type="submit"
            disabled={isRegistering}
            style={{
              padding: '10px 32px', fontSize: '13px', fontWeight: 600,
              backgroundColor: isRegistering ? '#ccc' : C.btnPrimaryBg,
              color: C.btnPrimaryText,
              border: 'none', borderRadius: '8px', cursor: isRegistering ? 'not-allowed' : 'pointer',
            }}
          >
            {isRegistering ? '등록 중...' : '판매요청'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 쿠팡 상품 목록 테이블
// ─────────────────────────────────────────────────────────────────────────────

function CoupangProductTable({ onEdit }: { onEdit: (id: number) => void }) {
  const { coupangProducts, coupangNextToken, isLoading, fetchCoupangProducts } = useListingStore();

  useEffect(() => {
    if (coupangProducts.length === 0) {
      fetchCoupangProducts(true);
    }
  }, [coupangProducts.length, fetchCoupangProducts]);

  const statusColors: Record<string, { bg: string; text: string }> = {
    '승인완료': { bg: '#dcfce7', text: '#15803d' },
    '승인대기': { bg: '#fef9c3', text: '#92400e' },
    '반려': { bg: '#fee2e2', text: '#b91c1c' },
    '판매중지': { bg: '#f3f3f3', text: '#71717a' },
  };

  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '10px',
        overflow: 'hidden',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: C.tableHeader }}>
            {['상품ID', '상품명', '브랜드', '상태', '카테고리', '등록일', ''].map((col) => (
              <th
                key={col}
                style={{
                  padding: '10px 16px', fontSize: '12px', fontWeight: 600,
                  color: C.textSub, textAlign: 'left',
                  borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {coupangProducts.map((p) => {
            const sc = statusColors[p.statusName] ?? { bg: '#f3f3f3', text: '#71717a' };
            return (
              <tr key={p.sellerProductId} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '11px 16px', fontSize: '13px', fontFamily: 'monospace', color: C.text }}>
                  <a
                    href={`https://www.coupang.com/vp/products/${p.productId}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: C.accent, textDecoration: 'none' }}
                  >
                    {p.sellerProductId}
                  </a>
                </td>
                <td style={{ padding: '11px 16px', fontSize: '13px', color: C.text, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.sellerProductName}
                </td>
                <td style={{ padding: '11px 16px', fontSize: '13px', color: C.textSub }}>
                  {p.brand || '-'}
                </td>
                <td style={{ padding: '11px 16px' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: '100px',
                    fontSize: '12px', fontWeight: 600, backgroundColor: sc.bg, color: sc.text,
                  }}>
                    {p.statusName}
                  </span>
                </td>
                <td style={{ padding: '11px 16px', fontSize: '13px', color: C.textSub, fontFamily: 'monospace' }}>
                  {p.displayCategoryCode}
                </td>
                <td style={{ padding: '11px 16px', fontSize: '13px', color: C.textSub, whiteSpace: 'nowrap' }}>
                  {p.createdAt ? formatDate(p.createdAt) : '-'}
                </td>
                <td style={{ padding: '11px 12px' }}>
                  <button
                    onClick={() => onEdit(p.sellerProductId)}
                    style={{
                      padding: '4px 12px', fontSize: '12px', fontWeight: 600,
                      backgroundColor: '#fff', color: C.accent,
                      border: `1px solid ${C.accent}`, borderRadius: '6px',
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    수정
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 더보기 / 로딩 */}
      {(coupangNextToken || isLoading) && (
        <div style={{ padding: '12px', textAlign: 'center' }}>
          <button
            onClick={() => fetchCoupangProducts(false)}
            disabled={isLoading}
            style={{
              padding: '8px 20px', fontSize: '13px', fontWeight: 500,
              backgroundColor: C.btnSecondaryBg, color: C.btnSecondaryText,
              border: `1px solid ${C.border}`, borderRadius: '8px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {isLoading ? '로딩 중...' : '더보기'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 쿠팡 탭 본문
// ─────────────────────────────────────────────────────────────────────────────

// ─── 쿠팡 수정 폼 ───────────────────────────────────────────────────────────

function CoupangEditForm({ onClose }: { onClose: () => void }) {
  const { editingProduct, updateCoupangProduct, isRegistering, error, clearError } = useListingStore();

  const p = editingProduct;
  const item = p?.items?.[0];

  const [form, setForm] = useState({
    sellerProductName: p?.sellerProductName ?? '',
    brand: p?.brand ?? '',
    salePrice: String(item?.salePrice ?? ''),
    originalPrice: String(item?.originalPrice ?? ''),
    deliveryChargeType: p?.deliveryChargeType ?? 'FREE',
    deliveryCharge: String(p?.deliveryCharge ?? 0),
    deliveryCompany: p?.deliveryCompanyCode ?? 'CJGLS',
    returnCharge: String(p?.returnCharge ?? 5000),
    exchangeCharge: String((p?.returnCharge ?? 5000) * 2),
    maximumBuyForPerson: String(item?.maximumBuyForPerson ?? 0),
    stock: '999',
  });

  const update = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  if (!p) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    // 기존 상품 데이터 기반으로 수정 payload 구성
    const payload = {
      ...p,
      sellerProductName: form.sellerProductName,
      displayProductName: form.sellerProductName,
      generalProductName: form.sellerProductName,
      brand: form.brand,
      deliveryCompanyCode: form.deliveryCompany,
      deliveryChargeType: form.deliveryChargeType,
      deliveryCharge: parseInt(form.deliveryCharge, 10),
      returnCharge: parseInt(form.returnCharge, 10),
      deliveryChargeOnReturn: parseInt(form.returnCharge, 10),
      items: p.items?.map((it: Record<string, unknown>, idx: number) =>
        idx === 0
          ? {
              ...it,
              itemName: form.sellerProductName,
              salePrice: parseInt(form.salePrice, 10),
              originalPrice: form.originalPrice ? parseInt(form.originalPrice, 10) : it.originalPrice,
              maximumBuyForPerson: parseInt(form.maximumBuyForPerson, 10),
            }
          : it,
      ),
    };

    const ok = await updateCoupangProduct(p.sellerProductId, payload);
    if (ok) {
      alert('상품 수정 완료!');
      onClose();
    }
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: C.text }}>
          상품 수정
          <span style={{ fontSize: '12px', fontWeight: 400, color: C.textSub, marginLeft: '8px' }}>
            ID: {p.sellerProductId}
          </span>
        </h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', color: C.textSub, cursor: 'pointer' }}>x</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: '16px', borderRadius: '8px', backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: '13px' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* 카테고리 (읽기 전용) */}
        <Section title="카테고리">
          <div style={{ fontSize: '13px', color: C.text, padding: '8px 12px', backgroundColor: C.tableHeader, borderRadius: '6px' }}>
            카테고리 코드: <strong>{p.displayCategoryCode}</strong>
            <span style={{ fontSize: '11px', color: C.textSub, marginLeft: '8px' }}>(카테고리는 쿠팡 Wing에서 변경)</span>
          </div>
        </Section>

        {/* 노출상품명 */}
        <Section title="노출상품명" required>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>브랜드</label>
              <input style={inputStyle} value={form.brand} onChange={(e) => update('brand', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>노출상품명 * <span style={{ fontWeight: 400, color: C.textSub }}>{form.sellerProductName.length}/100</span></label>
              <input style={inputStyle} value={form.sellerProductName} onChange={(e) => update('sellerProductName', e.target.value.slice(0, 100))} required maxLength={100} />
            </div>
          </div>
        </Section>

        {/* 상품이미지 (읽기 전용 표시) */}
        <Section title="상품이미지" defaultOpen={false}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(item?.images ?? []).map((img: { vendorPath: string; cdnPath: string; imageType: string }, i: number) => (
              <div key={i} style={{
                width: '80px', height: '80px', borderRadius: '6px', overflow: 'hidden',
                border: `1px solid ${C.border}`, position: 'relative',
              }}>
                <img
                  src={img.cdnPath ? `https://thumbnail7.coupangcdn.com/thumbnails/remote/80x80ex/${img.cdnPath}` : img.vendorPath}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                {img.imageType === 'REPRESENTATION' && (
                  <span style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    fontSize: '9px', textAlign: 'center', backgroundColor: 'rgba(190,0,20,0.8)', color: '#fff', padding: '1px',
                  }}>
                    대표
                  </span>
                )}
              </div>
            ))}
          </div>
          <div style={{ fontSize: '11px', color: C.textSub, marginTop: '4px' }}>
            이미지 변경은 쿠팡 Wing에서 직접 수정해주세요.
          </div>
        </Section>

        {/* 가격/재고 */}
        <Section title="가격/재고" required>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>판매가 *</label>
              <input style={inputStyle} value={form.salePrice} onChange={(e) => update('salePrice', e.target.value)} type="number" min="100" required />
            </div>
            <div>
              <label style={labelStyle}>정상가</label>
              <input style={inputStyle} value={form.originalPrice} onChange={(e) => update('originalPrice', e.target.value)} type="number" />
            </div>
            <div>
              <label style={labelStyle}>1인당 최대 구매</label>
              <input style={inputStyle} value={form.maximumBuyForPerson} onChange={(e) => update('maximumBuyForPerson', e.target.value)} type="number" min="0" />
            </div>
          </div>
        </Section>

        {/* 배송 */}
        <Section title="배송" required>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>택배사</label>
              <select style={inputStyle} value={form.deliveryCompany} onChange={(e) => update('deliveryCompany', e.target.value)}>
                <option value="CJGLS">CJ대한통운</option>
                <option value="KGB">로젠택배</option>
                <option value="EPOST">우체국택배</option>
                <option value="HANJIN">한진택배</option>
                <option value="HYUNDAI">롯데택배</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>배송비 유형</label>
              <select style={inputStyle} value={form.deliveryChargeType} onChange={(e) => update('deliveryChargeType', e.target.value)}>
                <option value="FREE">무료배송</option>
                <option value="NOT_FREE">유료배송</option>
                <option value="CHARGE_RECEIVED">착불</option>
                <option value="CONDITIONAL_FREE">조건부 무료</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>배송비 (원)</label>
              <input style={inputStyle} value={form.deliveryCharge} onChange={(e) => update('deliveryCharge', e.target.value)} type="number" min="0" />
            </div>
          </div>
        </Section>

        {/* 반품/교환 */}
        <Section title="반품/교환" required>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>반품 배송비 (편도)</label>
              <input style={inputStyle} value={form.returnCharge} onChange={(e) => update('returnCharge', e.target.value)} type="number" min="0" />
            </div>
            <div>
              <label style={labelStyle}>교환 배송비 (왕복)</label>
              <input style={inputStyle} value={form.exchangeCharge} onChange={(e) => update('exchangeCharge', e.target.value)} type="number" min="0" />
            </div>
          </div>
          <div style={{ fontSize: '12px', color: C.textSub }}>
            출고지: {p.returnAddress} {p.returnAddressDetail}
          </div>
        </Section>

        {/* 하단 버튼 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px', padding: '16px 0', borderTop: `1px solid ${C.border}` }}>
          <button type="button" onClick={onClose} style={{
            padding: '10px 24px', fontSize: '13px', fontWeight: 600,
            backgroundColor: C.btnSecondaryBg, color: C.btnSecondaryText,
            border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer',
          }}>
            취소
          </button>
          <button type="submit" disabled={isRegistering} style={{
            padding: '10px 32px', fontSize: '13px', fontWeight: 600,
            backgroundColor: isRegistering ? '#ccc' : C.btnPrimaryBg, color: C.btnPrimaryText,
            border: 'none', borderRadius: '8px', cursor: isRegistering ? 'not-allowed' : 'pointer',
          }}>
            {isRegistering ? '수정 중...' : '수정 저장'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── 쿠팡 탭 본문 ───────────────────────────────────────────────────────────

function CoupangTabContent() {
  const [showForm, setShowForm] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const { coupangProducts, error, fetchCoupangProductDetail, setEditingProduct } = useListingStore();

  const handleEdit = async (sellerProductId: number) => {
    const detail = await fetchCoupangProductDetail(sellerProductId);
    if (detail) {
      setShowForm(false);
      setShowEdit(true);
    }
  };

  const handleCloseEdit = () => {
    setShowEdit(false);
    setEditingProduct(null);
  };

  return (
    <>
      {/* 상단 바 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', color: C.textSub }}>
          쿠팡에 등록된 상품{' '}
          <strong style={{ color: C.text, fontWeight: 600 }}>
            {coupangProducts.length}
          </strong>
          개
        </span>
        {!showEdit && (
          <button
            onClick={() => { setShowForm(!showForm); setShowEdit(false); }}
            style={{
              padding: '8px 16px', fontSize: '13px', fontWeight: 600,
              backgroundColor: showForm ? C.btnSecondaryBg : C.btnPrimaryBg,
              color: showForm ? C.btnSecondaryText : C.btnPrimaryText,
              border: showForm ? `1px solid ${C.border}` : 'none',
              borderRadius: '8px', cursor: 'pointer',
            }}
          >
            {showForm ? '폼 닫기' : '+ 상품 등록'}
          </button>
        )}
      </div>

      {/* 에러 */}
      {error && !showForm && !showEdit && (
        <div style={{
          padding: '10px 14px', marginBottom: '16px', borderRadius: '8px',
          backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      {/* 등록 폼 */}
      {showForm && !showEdit && <CoupangRegisterForm onClose={() => setShowForm(false)} />}

      {/* 수정 폼 */}
      {showEdit && <CoupangEditForm onClose={handleCloseEdit} />}

      {/* 상품 목록 테이블 */}
      {!showEdit && <CoupangProductTable onEdit={handleEdit} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 네이버 탭 — 상품 목록 + 등록 폼
// ─────────────────────────────────────────────────────────────────────────────

function NaverCategoryPicker({ value, onChange }: { value: string; onChange: (id: string, path: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; path: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPath, setSelectedPath] = useState('');
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (kw: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!kw.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/listing/naver/categories?keyword=${encodeURIComponent(kw)}`);
        const json = await res.json();
        if (json.success) setResults(json.data ?? []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
  };

  return (
    <div>
      {value && (
        <div style={{ fontSize: '12px', color: '#15803d', marginBottom: '8px', padding: '8px 12px', backgroundColor: 'rgba(21,128,61,0.05)', borderRadius: '6px', border: '1px solid rgba(21,128,61,0.1)', display: 'flex', justifyContent: 'space-between' }}>
          <span>{selectedPath}</span>
          <span style={{ fontFamily: 'monospace', color: C.textSub, flexShrink: 0, marginLeft: '8px' }}>({value})</span>
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <input style={inputStyle} value={query} onChange={(e) => { setQuery(e.target.value); search(e.target.value); }} placeholder="카테고리명 검색 (예: 고데기, 마스크팩)" />
        {searching && <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: C.textSub }}>검색 중...</span>}
      </div>
      {results.length > 0 && (
        <div style={{ marginTop: '4px', border: `1px solid ${C.border}`, borderRadius: '8px', backgroundColor: '#fff', maxHeight: '250px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
          {results.map((item) => (
            <div key={item.id} onClick={() => { onChange(item.id, item.path); setSelectedPath(item.path); setQuery(''); setResults([]); }}
              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: `1px solid ${C.border}`, fontSize: '13px' }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.backgroundColor = C.tableHeader; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.backgroundColor = '#fff'; }}
            >
              <div style={{ fontWeight: 600, color: C.text, marginBottom: '2px' }}>{item.name}</div>
              <div style={{ fontSize: '11px', color: C.textSub }}>{item.path}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const NAVER_DEFAULTS_KEY = 'sss_naver_defaults';

function loadNaverDefaults(): { deliveryFee: string; returnFee: string; exchangeFee: string } {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(NAVER_DEFAULTS_KEY) : null;
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { deliveryFee: '0', returnFee: '4000', exchangeFee: '8000' };
}

function saveNaverDefaults(vals: { deliveryFee: string; returnFee: string; exchangeFee: string }) {
  try {
    localStorage.setItem(NAVER_DEFAULTS_KEY, JSON.stringify(vals));
  } catch { /* ignore */ }
}

function NaverRegisterForm({ onClose }: { onClose: () => void }) {
  const { registerNaverProduct, isRegistering, error, clearError, sharedDraft, updateSharedDraft } = useListingStore();
  const naverDefaults = loadNaverDefaults();
  const [form, setForm] = useState({
    name: sharedDraft.name || '',
    leafCategoryId: '', categoryPath: '',
    salePrice: sharedDraft.salePrice || '',
    stockQuantity: sharedDraft.stock || '999',
    thumbnailImages: sharedDraft.thumbnailImages.join('\n') || '',
    detailImages: sharedDraft.detailImages.join('\n') || '',
    detailContent: sharedDraft.description || '',
    deliveryFee: sharedDraft.deliveryCharge || naverDefaults.deliveryFee,
    returnFee: sharedDraft.returnCharge || naverDefaults.returnFee,
    exchangeFee: naverDefaults.exchangeFee,
    tags: sharedDraft.tags.join(', ') || '',
  });
  const update = (k: string, v: string) => {
    setForm((p) => {
      const next = { ...p, [k]: v };
      if (['deliveryFee', 'returnFee', 'exchangeFee'].includes(k)) {
        saveNaverDefaults({
          deliveryFee: k === 'deliveryFee' ? v : next.deliveryFee,
          returnFee: k === 'returnFee' ? v : next.returnFee,
          exchangeFee: k === 'exchangeFee' ? v : next.exchangeFee,
        });
      }
      // sharedDraft 공통 필드 동기화
      const sharedFieldMap: Record<string, keyof typeof sharedDraft> = {
        name: 'name',
        salePrice: 'salePrice',
        stockQuantity: 'stock',
        detailContent: 'description',
        deliveryFee: 'deliveryCharge',
        returnFee: 'returnCharge',
      };
      if (k in sharedFieldMap) {
        updateSharedDraft({ [sharedFieldMap[k]]: v } as Parameters<typeof updateSharedDraft>[0]);
      }
      if (k === 'thumbnailImages') {
        updateSharedDraft({ thumbnailImages: v.split('\n').map((s) => s.trim()).filter(Boolean) });
      }
      if (k === 'detailImages') {
        updateSharedDraft({ detailImages: v.split('\n').map((s) => s.trim()).filter(Boolean) });
      }
      if (k === 'tags') {
        updateSharedDraft({ tags: v.split(',').map((s) => s.trim()).filter(Boolean) });
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); clearError();
    const thumbnailImages = form.thumbnailImages.split('\n').map((s) => s.trim()).filter(Boolean);
    const detailImages = form.detailImages.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!thumbnailImages.length) return;
    const tags = form.tags.split(',').map((s) => s.trim()).filter(Boolean);
    const result = await registerNaverProduct({
      name: form.name, leafCategoryId: form.leafCategoryId, salePrice: parseInt(form.salePrice, 10),
      stockQuantity: parseInt(form.stockQuantity, 10),
      thumbnailImages,
      detailImages: detailImages.length > 0 ? detailImages : undefined,
      detailContent: form.detailContent,
      deliveryFee: parseInt(form.deliveryFee, 10), returnFee: parseInt(form.returnFee, 10),
      exchangeFee: parseInt(form.exchangeFee, 10), tags,
    });
    if (result) { alert(`상품 등록 완료! (원상품번호: ${result.originProductNo})`); onClose(); }
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: C.text }}>네이버 스마트스토어 상품 등록</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', color: C.textSub, cursor: 'pointer' }}>x</button>
      </div>
      {error && <div style={{ padding: '10px 14px', marginBottom: '16px', borderRadius: '8px', backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: '13px' }}>{error}</div>}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Section title="카테고리" required>
          <NaverCategoryPicker value={form.leafCategoryId} onChange={(id, path) => { update('leafCategoryId', id); setForm((p) => ({ ...p, categoryPath: path })); }} />
        </Section>
        <Section title="상품명" required>
          <input style={inputStyle} value={form.name} onChange={(e) => update('name', e.target.value.slice(0, 100))} placeholder="상품명 (최대 100자)" required maxLength={100} />
          <div style={{ fontSize: '11px', color: C.textSub, marginTop: '2px' }}>{form.name.length}/100</div>
        </Section>
        <Section title="가격/재고" required>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><label style={labelStyle}>판매가 *</label><input style={inputStyle} value={form.salePrice} onChange={(e) => update('salePrice', e.target.value)} type="number" min="100" required /></div>
            <div><label style={labelStyle}>재고</label><input style={inputStyle} value={form.stockQuantity} onChange={(e) => update('stockQuantity', e.target.value)} type="number" min="0" /></div>
          </div>
        </Section>
        <Section title="상품이미지" required>
          {/* 썸네일 이미지 섹션 */}
          <div>
            <label style={labelStyle}>
              상품 이미지 (썸네일) <span style={{ color: C.accent }}>*</span>
            </label>
            <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '6px' }}>
              URL을 줄바꿈으로 구분 · 첫 번째가 대표이미지 · 최대 10개
            </div>
            <textarea
              style={{ ...inputStyle, height: '80px', resize: 'vertical' }}
              value={form.thumbnailImages}
              onChange={(e) => update('thumbnailImages', e.target.value)}
              placeholder={'https://example.com/image1.jpg\nhttps://example.com/image2.jpg'}
              required
            />
            <ImageUrlPreview
              urls={form.thumbnailImages.split('\n').map((s) => s.trim()).filter(Boolean)}
            />
          </div>
          {/* 상세페이지 이미지 섹션 */}
          <div style={{ marginTop: '12px' }}>
            <label style={labelStyle}>상세페이지 이미지</label>
            <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '6px' }}>
              상품 상세설명 하단에 자동 삽입됩니다 · 최대 20개
            </div>
            <textarea
              style={{ ...inputStyle, height: '80px', resize: 'vertical' }}
              value={form.detailImages}
              onChange={(e) => update('detailImages', e.target.value)}
              placeholder={'https://example.com/detail1.jpg\nhttps://example.com/detail2.jpg'}
            />
            <ImageUrlPreview
              urls={form.detailImages.split('\n').map((s) => s.trim()).filter(Boolean)}
            />
          </div>
        </Section>
        <Section title="상세설명" required>
          <textarea style={{ ...inputStyle, minHeight: '150px', resize: 'vertical' }} value={form.detailContent} onChange={(e) => update('detailContent', e.target.value)} placeholder="상품 상세 설명 (HTML 지원)" required />
        </Section>
        <Section title="검색어(태그)" defaultOpen={true}>
          <div style={{ fontSize: '12px', color: C.textSub, marginBottom: '4px' }}>
            네이버 검색 노출에 직접 영향을 미칩니다. 쉼표(,)로 구분하여 최대 10개 입력하세요.
          </div>
          <input style={inputStyle} value={form.tags} onChange={(e) => update('tags', e.target.value)} placeholder="쉼표 구분 (예: 무선고데기, 미니고데기, 여행용)" />
        </Section>
        <Section title="배송" required>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div><label style={labelStyle}>배송비</label><input style={inputStyle} value={form.deliveryFee} onChange={(e) => update('deliveryFee', e.target.value)} type="number" min="0" /><div style={{ fontSize: '10px', color: C.textSub, marginTop: '2px' }}>0 = 무료배송</div></div>
            <div><label style={labelStyle}>반품 배송비</label><input style={inputStyle} value={form.returnFee} onChange={(e) => update('returnFee', e.target.value)} type="number" min="0" /></div>
            <div><label style={labelStyle}>교환 배송비</label><input style={inputStyle} value={form.exchangeFee} onChange={(e) => update('exchangeFee', e.target.value)} type="number" min="0" /></div>
          </div>
        </Section>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px', padding: '16px 0', borderTop: `1px solid ${C.border}` }}>
          <button type="button" onClick={onClose} style={{ padding: '10px 24px', fontSize: '13px', fontWeight: 600, backgroundColor: C.btnSecondaryBg, color: C.btnSecondaryText, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer' }}>취소</button>
          <button type="submit" disabled={isRegistering} style={{ padding: '10px 32px', fontSize: '13px', fontWeight: 600, backgroundColor: isRegistering ? '#ccc' : '#03c75a', color: '#fff', border: 'none', borderRadius: '8px', cursor: isRegistering ? 'not-allowed' : 'pointer' }}>{isRegistering ? '등록 중...' : '판매 등록'}</button>
        </div>
      </form>
    </div>
  );
}

function NaverProductTable({ onEdit }: { onEdit: (id: number) => void }) {
  const { naverProducts, naverTotal, naverPage, isLoading, fetchNaverProducts } = useListingStore();

  useEffect(() => {
    if (naverProducts.length === 0) fetchNaverProducts(1);
  }, [naverProducts.length, fetchNaverProducts]);

  // originProductNo 기준 중복 제거 (같은 원상품의 여러 채널상품 통합)
  const uniqueProducts = naverProducts.filter(
    (p, idx, arr) => arr.findIndex((x) => x.originProductNo === p.originProductNo) === idx,
  );

  const statusMap: Record<string, { label: string; bg: string; text: string }> = {
    SALE: { label: '판매중', bg: '#dcfce7', text: '#15803d' },
    OUTOFSTOCK: { label: '품절', bg: '#fee2e2', text: '#b91c1c' },
    SUSPENSION: { label: '판매중지', bg: '#f3f3f3', text: '#71717a' },
    WAIT: { label: '승인대기', bg: '#fef9c3', text: '#92400e' },
    CLOSE: { label: '종료', bg: '#f3f3f3', text: '#71717a' },
    PROHIBITION: { label: '금지', bg: '#fee2e2', text: '#b91c1c' },
  };

  const totalPages = Math.ceil(naverTotal / 20);

  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '10px', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: C.tableHeader }}>
            {['이미지', '상품명', '상태', '판매가', '재고', '카테고리', '등록일', ''].map((col) => (
              <th key={col} style={{ padding: '10px 16px', fontSize: '12px', fontWeight: 600, color: C.textSub, textAlign: 'left', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {uniqueProducts.map((p) => {
            const st = statusMap[p.statusType] ?? { label: p.statusType, bg: '#f3f3f3', text: '#71717a' };
            return (
              <tr key={p.channelProductNo} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '8px 16px' }}>
                  {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: '40px', height: '40px', borderRadius: '6px', objectFit: 'cover' }} /> : <div style={{ width: '40px', height: '40px', borderRadius: '6px', backgroundColor: C.tableHeader }} />}
                </td>
                <td style={{ padding: '11px 16px', fontSize: '13px', color: C.text, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <a href={`https://smartstore.naver.com/main/products/${p.channelProductNo}`} target="_blank" rel="noreferrer" style={{ color: C.text, textDecoration: 'none' }}>{p.name}</a>
                </td>
                <td style={{ padding: '11px 16px' }}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '100px', fontSize: '12px', fontWeight: 600, backgroundColor: st.bg, color: st.text }}>{st.label}</span>
                </td>
                <td style={{ padding: '11px 16px', fontSize: '13px', color: C.text, fontWeight: 500, whiteSpace: 'nowrap' }}>{p.salePrice.toLocaleString()}원</td>
                <td style={{ padding: '11px 16px', fontSize: '13px', color: C.text }}>{p.stockQuantity}</td>
                <td style={{ padding: '11px 16px', fontSize: '11px', color: C.textSub, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.categoryName}</td>
                <td style={{ padding: '11px 16px', fontSize: '13px', color: C.textSub, whiteSpace: 'nowrap' }}>{formatDate(p.regDate)}</td>
                <td style={{ padding: '11px 12px' }}>
                  <button onClick={() => onEdit(p.originProductNo)} style={{ padding: '4px 12px', fontSize: '12px', fontWeight: 600, backgroundColor: '#fff', color: '#03c75a', border: '1px solid #03c75a', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>수정</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div style={{ padding: '12px', display: 'flex', justifyContent: 'center', gap: '8px' }}>
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((pg) => (
            <button key={pg} onClick={() => fetchNaverProducts(pg)} disabled={isLoading}
              style={{ padding: '4px 10px', fontSize: '12px', borderRadius: '6px', border: `1px solid ${pg === naverPage ? '#03c75a' : C.border}`, backgroundColor: pg === naverPage ? '#03c75a' : '#fff', color: pg === naverPage ? '#fff' : C.text, cursor: 'pointer' }}
            >{pg}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function NaverTabContent() {
  const [showForm, setShowForm] = useState(false);
  const { naverProducts, error, fetchNaverProductDetail, setEditingNaverProduct } = useListingStore();
  const uniqueProducts = naverProducts.filter(
    (p, idx, arr) => arr.findIndex((x) => x.originProductNo === p.originProductNo) === idx,
  );

  const handleEdit = async (originProductNo: number) => {
    await fetchNaverProductDetail(originProductNo);
    // TODO: 네이버 수정 폼 구현 (현재는 상세 조회만)
    alert('네이버 상품 수정 폼은 다음 버전에서 지원됩니다. 스마트스토어 판매자센터에서 직접 수정해주세요.');
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', color: C.textSub }}>
          네이버에 등록된 상품 <strong style={{ color: C.text, fontWeight: 600 }}>{uniqueProducts.length}</strong>개
        </span>
        <button onClick={() => setShowForm(!showForm)} style={{
          padding: '8px 16px', fontSize: '13px', fontWeight: 600,
          backgroundColor: showForm ? C.btnSecondaryBg : '#03c75a', color: showForm ? C.btnSecondaryText : '#fff',
          border: showForm ? `1px solid ${C.border}` : 'none', borderRadius: '8px', cursor: 'pointer',
        }}>{showForm ? '폼 닫기' : '+ 상품 등록'}</button>
      </div>
      {error && !showForm && <div style={{ padding: '10px 14px', marginBottom: '16px', borderRadius: '8px', backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: '13px' }}>{error}</div>}
      {showForm && <NaverRegisterForm onClose={() => setShowForm(false)} />}
      <NaverProductTable onEdit={handleEdit} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

// 연동된 플랫폼
const CONNECTED_PLATFORMS = new Set<PlatformId>(['coupang', 'naver']);

export default function ListingDashboard() {
  const { activePlatform, listings, isLoading, setActivePlatform, fetchListings } =
    useListingStore();

  const [showBothMode, setShowBothMode] = useState(false);
  const [showDomeggookPanel, setShowDomeggookPanel] = useState(false);

  // 마운트 시 목록 조회
  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  const activeMeta = PLATFORMS.find((p) => p.id === activePlatform)!;
  const isConnected = CONNECTED_PLATFORMS.has(activePlatform);
  const filteredListings = listings.filter((l) => l.platformId === activePlatform);
  const isCoupang = activePlatform === 'coupang';
  const isNaver = activePlatform === 'naver';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: C.bg,
      }}
    >
      {/* -------------------------------------------------------------------- */}
      {/* 헤더                                                                  */}
      {/* -------------------------------------------------------------------- */}
      <header
        style={{
          flexShrink: 0,
          height: '52px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: `1px solid ${C.border}`,
          backgroundColor: C.card,
          zIndex: 50,
        }}
      >
        {/* 로고 + 탭 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                fontSize: '16px',
                fontWeight: 700,
                letterSpacing: '-0.3px',
                color: C.text,
              }}
            >
              Smart
              <span style={{ color: C.accent }}>Seller</span>
              Studio
            </span>
            <span
              style={{
                backgroundColor: 'rgba(190, 0, 20, 0.08)',
                color: C.accent,
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 9px',
                borderRadius: '100px',
                border: '1px solid rgba(190, 0, 20, 0.2)',
              }}
            >
              Beta
            </span>
          </div>

          {/* 네비게이션 탭 */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {[
              { href: '/dashboard', label: '대시보드' },
              { href: '/sourcing', label: '소싱' },
              { href: '/editor', label: '에디터' },
              { href: '/listing', label: '상품등록', active: true },
              { href: '/orders', label: '주문/매출' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: item.active ? 600 : 500,
                  color: item.active ? C.accent : C.textSub,
                  textDecoration: 'none',
                  backgroundColor: item.active ? 'rgba(190, 0, 20, 0.07)' : 'transparent',
                  border: item.active ? '1px solid rgba(190, 0, 20, 0.15)' : '1px solid transparent',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* -------------------------------------------------------------------- */}
      {/* 플랫폼 탭                                                              */}
      {/* -------------------------------------------------------------------- */}
      <PlatformTabs
        activePlatform={activePlatform}
        onSelect={setActivePlatform}
        showBothMode={showBothMode}
        onToggleBothMode={() => {
          setShowBothMode((v) => !v);
          setShowDomeggookPanel(false);
        }}
        showDomeggookPanel={showDomeggookPanel}
        onToggleDomeggookPanel={() => {
          setShowDomeggookPanel((v) => !v);
          setShowBothMode(false);
        }}
      />

      {/* -------------------------------------------------------------------- */}
      {/* 본문                                                                   */}
      {/* -------------------------------------------------------------------- */}
      <main
        style={{
          flex: 1,
          padding: '24px',
          maxWidth: '1200px',
          width: '100%',
          margin: '0 auto',
        }}
      >
        {/* 도매꾹 불러오기 패널 */}
        {showDomeggookPanel && (
          <DomeggookPreparePanel onClose={() => setShowDomeggookPanel(false)} />
        )}

        {/* 동시 등록 모드 */}
        {!showDomeggookPanel && showBothMode && (
          <BothRegisterForm onClose={() => setShowBothMode(false)} />
        )}

        {/* 단일 등록 모드 — showBothMode, showDomeggookPanel이 false일 때만 렌더 */}
        {!showDomeggookPanel && !showBothMode && isCoupang && <CoupangTabContent />}

        {/* 네이버 탭 */}
        {!showDomeggookPanel && !showBothMode && isNaver && <NaverTabContent />}

        {/* 기타 플랫폼 — 기존 로직 */}
        {!showDomeggookPanel && !showBothMode && !isCoupang && !isNaver && (
          <>
            {/* 로딩 */}
            {isLoading && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  padding: '80px 24px',
                  color: C.textSub,
                  fontSize: '14px',
                }}
              >
                불러오는 중...
              </div>
            )}

            {/* 연동 전 빈 상태 */}
            {!isLoading && !isConnected && (
              <EmptyConnectState platformLabel={activeMeta.label} />
            )}

            {/* 연동 후 데이터 없음 */}
            {!isLoading && isConnected && filteredListings.length === 0 && (
              <EmptyListState />
            )}

            {/* 등록 상품 테이블 */}
            {!isLoading && isConnected && filteredListings.length > 0 && (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '16px',
                  }}
                >
                  <span style={{ fontSize: '13px', color: C.textSub }}>
                    총{' '}
                    <strong style={{ color: C.text, fontWeight: 600 }}>
                      {filteredListings.length}
                    </strong>
                    개 상품
                  </span>
                </div>
                <ListingTable listings={filteredListings} />
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
