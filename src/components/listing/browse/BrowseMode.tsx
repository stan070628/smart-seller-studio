'use client';

/**
 * BrowseMode.tsx
 * 쿠팡·네이버 등록 상품 조회 컴포넌트
 * 상태 필터, 키워드 검색, 인라인 수정 폼 포함
 */

import { useEffect, useState } from 'react';
import { useListingStore } from '@/store/useListingStore';

// ─── 색상 상수 (ListingDashboard.tsx와 동일) ────────────────────────────────
const C = {
  bg: '#f9f9f9',
  card: '#ffffff',
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#926f6b',
  accent: '#be0014',
  tableHeader: '#f3f3f3',
  rowHover: '#f5f5f5',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#1a1c1c',
};

// ─── 상태 필터 옵션 ───────────────────────────────────────────────────────────
const COUPANG_STATUSES = [
  { value: '', label: '전체' },
  { value: 'APPROVED', label: '승인완료' },
  { value: 'UNDER_REVIEW', label: '심사중' },
  { value: 'SUSPENSION', label: '판매중지' },
  { value: 'REJECTED', label: '반려' },
];

const NAVER_STATUSES = [
  { value: '', label: '전체' },
  { value: 'SALE', label: '판매중' },
  { value: 'OUTOFSTOCK', label: '품절' },
  { value: 'WAIT', label: '승인대기' },
  { value: 'PROHIBITION', label: '금지' },
];

// ─── 상태 배지 버튼 ───────────────────────────────────────────────────────────
function StatusBadge({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px',
        fontSize: '12px',
        fontWeight: active ? 700 : 500,
        borderRadius: '100px',
        border: `1px solid ${active ? C.accent : C.border}`,
        backgroundColor: active ? C.accent : '#fff',
        color: active ? '#fff' : C.textSub,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

// ─── 날짜 포맷 유틸 ───────────────────────────────────────────────────────────
function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── 쿠팡 조회 뷰 ────────────────────────────────────────────────────────────
function CoupangBrowser() {
  const {
    coupangProducts,
    coupangNextToken,
    isLoading,
    error,
    browseFilters,
    updateBrowseFilters,
    fetchCoupangProducts,
    fetchCoupangProductDetail,
    editingProduct,
    setEditingProduct,
    updateCoupangProduct,
    isRegistering,
    clearError,
  } = useListingStore();

  // 상태 필터 변경 시 목록 재조회
  useEffect(() => {
    fetchCoupangProducts(true, browseFilters.coupangStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseFilters.coupangStatus]);

  // 키워드 필터링 (클라이언트 사이드)
  const keyword = browseFilters.keyword.toLowerCase();
  const filtered = keyword
    ? coupangProducts.filter((p) => p.sellerProductName.toLowerCase().includes(keyword))
    : coupangProducts;

  // 상태별 배지 색상
  const statusColors: Record<string, { bg: string; text: string }> = {
    '승인완료': { bg: '#dcfce7', text: '#15803d' },
    APPROVED: { bg: '#dcfce7', text: '#15803d' },
    '승인대기': { bg: '#fef9c3', text: '#92400e' },
    UNDER_REVIEW: { bg: '#fef9c3', text: '#92400e' },
    '반려': { bg: '#fee2e2', text: '#b91c1c' },
    REJECTED: { bg: '#fee2e2', text: '#b91c1c' },
    '판매중지': { bg: '#f3f4f6', text: '#6b7280' },
    SUSPENSION: { bg: '#f3f4f6', text: '#6b7280' },
  };

  // 수정 버튼 클릭 — 상세 조회 후 editingProduct 세팅
  const handleEdit = async (sellerProductId: number) => {
    await fetchCoupangProductDetail(sellerProductId);
  };

  // 수정 폼 상태
  const p = editingProduct;
  const item = p?.items?.[0];
  const [form, setForm] = useState({
    sellerProductName: '',
    brand: '',
    salePrice: '',
    originalPrice: '',
    deliveryChargeType: 'FREE',
    deliveryCharge: '0',
    returnCharge: '5000',
    maximumBuyForPerson: '0',
  });

  // editingProduct 변경 시 폼 초기화
  useEffect(() => {
    if (p) {
      setForm({
        sellerProductName: p.sellerProductName ?? '',
        brand: p.brand ?? '',
        salePrice: String(item?.salePrice ?? ''),
        originalPrice: String(item?.originalPrice ?? ''),
        deliveryChargeType: p.deliveryChargeType ?? 'FREE',
        deliveryCharge: String(p.deliveryCharge ?? 0),
        returnCharge: String(p.returnCharge ?? 5000),
        maximumBuyForPerson: String(item?.maximumBuyForPerson ?? 0),
      });
    }
  }, [p, item]);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: '13px',
    border: `1px solid ${C.border}`,
    borderRadius: '6px',
    outline: 'none',
    boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '11px',
    fontWeight: 600,
    color: C.textSub,
    marginBottom: '4px',
  };

  // 수정 폼 제출
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    if (!p) return;
    const payload = {
      ...p,
      sellerProductName: form.sellerProductName,
      displayProductName: form.sellerProductName,
      generalProductName: form.sellerProductName,
      brand: form.brand,
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
    if (ok) alert('수정 완료!');
  };

  return (
    <div>
      {/* 인라인 수정 폼 */}
      {p && (
        <div
          style={{
            marginBottom: '24px',
            padding: '20px',
            backgroundColor: '#fff',
            border: `1px solid ${C.border}`,
            borderRadius: '10px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: C.text }}>
              상품 수정
              <span style={{ fontSize: '12px', fontWeight: 400, color: C.textSub, marginLeft: '8px' }}>
                ID: {p.sellerProductId}
              </span>
            </h3>
            <button
              onClick={() => setEditingProduct(null)}
              style={{ background: 'none', border: 'none', fontSize: '18px', color: C.textSub, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
          {error && (
            <div
              style={{
                padding: '10px 14px',
                marginBottom: '12px',
                borderRadius: '8px',
                backgroundColor: '#fee2e2',
                color: '#b91c1c',
                fontSize: '13px',
              }}
            >
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <div>
                <label style={labelStyle}>브랜드</label>
                <input
                  style={inputStyle}
                  value={form.brand}
                  onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                />
              </div>
              <div>
                <label style={labelStyle}>노출상품명</label>
                <input
                  style={inputStyle}
                  value={form.sellerProductName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sellerProductName: e.target.value.slice(0, 100) }))
                  }
                  required
                />
              </div>
              <div>
                <label style={labelStyle}>판매가</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={form.salePrice}
                  onChange={(e) => setForm((f) => ({ ...f, salePrice: e.target.value }))}
                />
              </div>
              <div>
                <label style={labelStyle}>정상가</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={form.originalPrice}
                  onChange={(e) => setForm((f) => ({ ...f, originalPrice: e.target.value }))}
                />
              </div>
              <div>
                <label style={labelStyle}>배송비 유형</label>
                <select
                  style={inputStyle}
                  value={form.deliveryChargeType}
                  onChange={(e) => setForm((f) => ({ ...f, deliveryChargeType: e.target.value }))}
                >
                  <option value="FREE">무료배송</option>
                  <option value="NOT_FREE">유료배송</option>
                  <option value="CHARGE_RECEIVED">착불</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>배송비</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={form.deliveryCharge}
                  onChange={(e) => setForm((f) => ({ ...f, deliveryCharge: e.target.value }))}
                />
              </div>
              <div>
                <label style={labelStyle}>반품 배송비</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={form.returnCharge}
                  onChange={(e) => setForm((f) => ({ ...f, returnCharge: e.target.value }))}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                style={{
                  padding: '8px 20px',
                  fontSize: '13px',
                  fontWeight: 600,
                  backgroundColor: C.btnSecondaryBg,
                  color: C.btnSecondaryText,
                  border: `1px solid ${C.border}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isRegistering}
                style={{
                  padding: '8px 24px',
                  fontSize: '13px',
                  fontWeight: 600,
                  backgroundColor: isRegistering ? '#ccc' : C.accent,
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: isRegistering ? 'not-allowed' : 'pointer',
                }}
              >
                {isRegistering ? '저장 중...' : '저장'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 에러 메시지 (수정 폼 없을 때만) */}
      {error && !p && (
        <div
          style={{
            padding: '10px 14px',
            marginBottom: '12px',
            borderRadius: '8px',
            backgroundColor: '#fee2e2',
            color: '#b91c1c',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {/* 상품 목록 테이블 */}
      {isLoading && coupangProducts.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', color: C.textSub, fontSize: '13px' }}>
          로딩 중...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', color: C.textSub, fontSize: '13px' }}>
          등록된 상품이 없습니다.
        </div>
      ) : (
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
              {filtered.map((pr) => {
                const sc = statusColors[pr.statusName] ?? { bg: '#f3f3f3', text: '#71717a' };
                return (
                  <tr key={pr.sellerProductId} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td
                      style={{
                        padding: '11px 16px',
                        fontSize: '13px',
                        fontFamily: 'monospace',
                        color: C.text,
                      }}
                    >
                      <a
                        href={`https://www.coupang.com/vp/products/${pr.productId}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: C.accent, textDecoration: 'none' }}
                      >
                        {pr.sellerProductId}
                      </a>
                    </td>
                    <td
                      style={{
                        padding: '11px 16px',
                        fontSize: '13px',
                        color: C.text,
                        maxWidth: '280px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {pr.sellerProductName}
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: '13px', color: C.textSub }}>
                      {pr.brand || '-'}
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '100px',
                          fontSize: '12px',
                          fontWeight: 600,
                          backgroundColor: sc.bg,
                          color: sc.text,
                        }}
                      >
                        {pr.statusName}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '11px 16px',
                        fontSize: '13px',
                        color: C.textSub,
                        fontFamily: 'monospace',
                      }}
                    >
                      {pr.displayCategoryCode}
                    </td>
                    <td
                      style={{
                        padding: '11px 16px',
                        fontSize: '13px',
                        color: C.textSub,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {pr.createdAt ? formatDate(pr.createdAt) : '-'}
                    </td>
                    <td style={{ padding: '11px 12px' }}>
                      <button
                        onClick={() => handleEdit(pr.sellerProductId)}
                        style={{
                          padding: '4px 12px',
                          fontSize: '12px',
                          fontWeight: 600,
                          backgroundColor: '#fff',
                          color: C.accent,
                          border: `1px solid ${C.accent}`,
                          borderRadius: '6px',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
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
          {/* 더보기 버튼 */}
          {(coupangNextToken || isLoading) && (
            <div style={{ padding: '12px', textAlign: 'center' }}>
              <button
                onClick={() => fetchCoupangProducts(false, browseFilters.coupangStatus)}
                disabled={isLoading}
                style={{
                  padding: '8px 20px',
                  fontSize: '13px',
                  fontWeight: 500,
                  backgroundColor: C.btnSecondaryBg,
                  color: C.btnSecondaryText,
                  border: `1px solid ${C.border}`,
                  borderRadius: '8px',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {isLoading ? '로딩 중...' : '더보기'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 네이버 조회 뷰 ───────────────────────────────────────────────────────────
function NaverBrowser() {
  const {
    naverProducts,
    naverTotal,
    naverPage,
    isLoading,
    error,
    browseFilters,
    fetchNaverProducts,
  } = useListingStore();

  // 상태 필터 변경 시 목록 재조회
  useEffect(() => {
    fetchNaverProducts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseFilters.naverStatus]);

  // 키워드 필터링 + 중복 제거
  const keyword = browseFilters.keyword.toLowerCase();
  const uniqueProducts = naverProducts.filter(
    (p, idx, arr) => arr.findIndex((x) => x.originProductNo === p.originProductNo) === idx,
  );
  const filtered = keyword
    ? uniqueProducts.filter((p) => p.name.toLowerCase().includes(keyword))
    : uniqueProducts;

  // 상태별 배지 정보
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
    <div>
      {error && (
        <div
          style={{
            padding: '10px 14px',
            marginBottom: '12px',
            borderRadius: '8px',
            backgroundColor: '#fee2e2',
            color: '#b91c1c',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}
      {isLoading && naverProducts.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', color: C.textSub, fontSize: '13px' }}>
          로딩 중...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', color: C.textSub, fontSize: '13px' }}>
          등록된 상품이 없습니다.
        </div>
      ) : (
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
                {['이미지', '상품명', '상태', '판매가', '재고', '카테고리', '등록일', ''].map((col) => (
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
              {filtered.map((p) => {
                const st = statusMap[p.statusType] ?? { label: p.statusType, bg: '#f3f3f3', text: '#71717a' };
                return (
                  <tr key={p.channelProductNo} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '8px 16px' }}>
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt=""
                          style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '6px',
                            objectFit: 'cover',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '6px',
                            backgroundColor: C.tableHeader,
                          }}
                        />
                      )}
                    </td>
                    <td
                      style={{
                        padding: '11px 16px',
                        fontSize: '13px',
                        color: C.text,
                        maxWidth: '280px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <a
                        href={`https://smartstore.naver.com/main/products/${p.channelProductNo}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: C.text, textDecoration: 'none' }}
                      >
                        {p.name}
                      </a>
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '100px',
                          fontSize: '12px',
                          fontWeight: 600,
                          backgroundColor: st.bg,
                          color: st.text,
                        }}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '11px 16px',
                        fontSize: '13px',
                        color: C.text,
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.salePrice.toLocaleString()}원
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: '13px', color: C.text }}>
                      {p.stockQuantity}
                    </td>
                    <td
                      style={{
                        padding: '11px 16px',
                        fontSize: '11px',
                        color: C.textSub,
                        maxWidth: '180px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.categoryName}
                    </td>
                    <td
                      style={{
                        padding: '11px 16px',
                        fontSize: '13px',
                        color: C.textSub,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatDate(p.regDate)}
                    </td>
                    <td style={{ padding: '11px 12px' }}>
                      <a
                        href={`https://sell.smartstore.naver.com/#/product/detail/${p.originProductNo}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          padding: '4px 12px',
                          fontSize: '12px',
                          fontWeight: 600,
                          backgroundColor: '#fff',
                          color: '#03c75a',
                          border: '1px solid #03c75a',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          textDecoration: 'none',
                          display: 'inline-block',
                        }}
                      >
                        수정
                      </a>
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
                <button
                  key={pg}
                  onClick={() => fetchNaverProducts(pg)}
                  disabled={isLoading}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: `1px solid ${pg === naverPage ? '#03c75a' : C.border}`,
                    backgroundColor: pg === naverPage ? '#03c75a' : '#fff',
                    color: pg === naverPage ? '#fff' : C.text,
                    cursor: 'pointer',
                  }}
                >
                  {pg}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── BrowseMode 메인 컴포넌트 ─────────────────────────────────────────────────
export default function BrowseMode() {
  const {
    browsePlatform,
    setBrowsePlatform,
    browseFilters,
    updateBrowseFilters,
    coupangProducts,
    naverProducts,
    isLoading,
    fetchCoupangProducts,
    fetchNaverProducts,
  } = useListingStore();

  // 현재 플랫폼에 맞는 상태 필터 목록 및 활성 상태
  const statuses = browsePlatform === 'coupang' ? COUPANG_STATUSES : NAVER_STATUSES;
  const activeStatus = browsePlatform === 'coupang' ? browseFilters.coupangStatus : browseFilters.naverStatus;

  const handleStatusChange = (val: string) => {
    if (browsePlatform === 'coupang') updateBrowseFilters({ coupangStatus: val });
    else updateBrowseFilters({ naverStatus: val });
  };

  const handleRefresh = () => {
    if (browsePlatform === 'coupang') fetchCoupangProducts(true, browseFilters.coupangStatus);
    else fetchNaverProducts(1);
  };

  return (
    <div>
      {/* 플랫폼 탭 + 새로고침 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${C.border}`,
          backgroundColor: C.card,
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', gap: '0' }}>
          {(
            [
              { id: 'coupang', label: '🛒 쿠팡', color: C.accent },
              { id: 'naver', label: '🟢 네이버', color: '#03c75a' },
            ] as const
          ).map((pl) => {
            const isActive = browsePlatform === pl.id;
            return (
              <button
                key={pl.id}
                onClick={() => setBrowsePlatform(pl.id)}
                style={{
                  padding: '12px 20px',
                  fontSize: '13px',
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? pl.color : C.textSub,
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderBottom: isActive ? `2px solid ${pl.color}` : '2px solid transparent',
                  cursor: 'pointer',
                  marginBottom: '-1px',
                }}
              >
                {pl.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: C.textSub }}>
            {browsePlatform === 'coupang' ? coupangProducts.length : naverProducts.length}개
          </span>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            style={{
              padding: '5px 10px',
              fontSize: '12px',
              backgroundColor: '#fff',
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              cursor: 'pointer',
              color: C.textSub,
            }}
          >
            🔄 새로고침
          </button>
        </div>
      </div>

      {/* 상태 필터 배지 + 키워드 검색 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px',
          flexWrap: 'wrap',
        }}
      >
        {statuses.map((s) => (
          <StatusBadge
            key={s.value}
            label={s.label}
            active={activeStatus === s.value}
            onClick={() => handleStatusChange(s.value)}
          />
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <input
            type="text"
            placeholder="상품명 검색..."
            value={browseFilters.keyword}
            onChange={(e) => updateBrowseFilters({ keyword: e.target.value })}
            style={{
              padding: '5px 12px',
              fontSize: '13px',
              border: `1px solid ${C.border}`,
              borderRadius: '20px',
              outline: 'none',
              width: '180px',
            }}
          />
        </div>
      </div>

      {/* 플랫폼별 내용 */}
      {browsePlatform === 'coupang' ? <CoupangBrowser /> : <NaverBrowser />}
    </div>
  );
}
