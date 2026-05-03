'use client';

import React, { useState, useMemo } from 'react';
import { Plus, Trash2, X, Search, Loader2 } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { calcCoupangWing } from '@/lib/calculator/calculate';

// ─── 데이터 모델 ──────────────────────────────────────────────────────────────
interface BundleProduct {
  id: string;
  sellerProductId: number;
  name: string;
  categoryCode: string;
  sellingPrice: number;
  costPrice: number;
  monthlySales: number;
  // 파생값 (계산 후 채워짐)
  allocatedAdCost: number;
  netProfit: number;
  marginRate: number;
}

// ─── 숫자 포맷 유틸 ───────────────────────────────────────────────────────────
function fmt(n: number) {
  return n.toLocaleString('ko-KR');
}

// ─── 상품 추가 모달 ───────────────────────────────────────────────────────────
interface ProductPickerModalProps {
  onAdd: (product: BundleProduct) => void;
  onClose: () => void;
}

function ProductPickerModal({ onAdd, onClose }: ProductPickerModalProps) {
  const { coupangProducts, fetchCoupangProducts, fetchCoupangProductDetail, editingProduct, isLoading } =
    useListingStore();

  const [keyword, setKeyword] = useState('');
  const [fetchingId, setFetchingId] = useState<number | null>(null);

  // 모달 열릴 때 상품 목록 로드
  React.useEffect(() => {
    fetchCoupangProducts(true, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 클라이언트 사이드 키워드 필터링
  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return coupangProducts;
    return coupangProducts.filter((p) =>
      p.sellerProductName.toLowerCase().includes(q),
    );
  }, [coupangProducts, keyword]);

  // 상품 클릭 — 상세 조회 후 BundleProduct 생성
  const handleSelect = async (pr: (typeof coupangProducts)[number]) => {
    setFetchingId(pr.sellerProductId);
    await fetchCoupangProductDetail(pr.sellerProductId);
    // editingProduct는 fetchCoupangProductDetail 호출 후 스토어에 반영됨
    // get() 패턴 대신 스토어 현재값을 직접 읽는다
    const detail = useListingStore.getState().editingProduct;
    const salePrice: number = detail?.items?.[0]?.salePrice ?? 0;

    const newProduct: BundleProduct = {
      id: crypto.randomUUID(),
      sellerProductId: pr.sellerProductId,
      name: pr.sellerProductName,
      categoryCode: String(pr.displayCategoryCode),
      sellingPrice: salePrice,
      costPrice: 0,
      monthlySales: 0,
      allocatedAdCost: 0,
      netProfit: 0,
      marginRate: 0,
    };

    setFetchingId(null);
    onAdd(newProduct);
    onClose();
  };

  return (
    // 고정 오버레이
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3">
          <span className="text-sm font-semibold text-[#18181b]">내 쿠팡 상품 선택</span>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[#71717a] hover:bg-[#f5f5f5]"
          >
            <X size={16} />
          </button>
        </div>

        {/* 검색 */}
        <div className="border-b border-[#e5e5e5] px-4 py-2">
          <div className="flex items-center gap-2 rounded-lg bg-[#f5f5f7] px-3 py-1.5">
            <Search size={14} className="shrink-0 text-[#a1a1aa]" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="상품명으로 검색"
              className="w-full bg-transparent text-xs text-[#18181b] outline-none placeholder:text-[#a1a1aa]"
            />
          </div>
        </div>

        {/* 상품 목록 */}
        <div className="max-h-80 overflow-y-auto">
          {isLoading && filtered.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin text-[#a1a1aa]" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-xs text-[#a1a1aa]">
              {keyword ? '검색 결과가 없습니다.' : '등록된 상품이 없습니다.'}
            </p>
          ) : (
            filtered.map((pr) => (
              <button
                key={pr.sellerProductId}
                onClick={() => handleSelect(pr)}
                disabled={fetchingId === pr.sellerProductId}
                className="flex w-full items-center gap-3 border-b border-[#f0f0f0] px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[#f5f5f7] disabled:opacity-50"
              >
                {fetchingId === pr.sellerProductId ? (
                  <Loader2 size={14} className="shrink-0 animate-spin text-[#be0014]" />
                ) : (
                  <div className="h-3.5 w-3.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[#18181b]">
                    {pr.sellerProductName}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[#a1a1aa]">
                    ID: {pr.sellerProductId}
                  </p>
                </div>
                {/* 상태 뱃지 */}
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    pr.statusName === 'APPROVED' || pr.statusName === '승인완료'
                      ? 'bg-[#dcfce7] text-[#16a34a]'
                      : 'bg-[#f5f5f7] text-[#71717a]'
                  }`}
                >
                  {pr.statusName}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function BundleAdMode() {
  const [totalAdCost, setTotalAdCost] = useState<string>('');
  const [products, setProducts] = useState<BundleProduct[]>([]);
  const [showModal, setShowModal] = useState(false);

  // 총 광고비 숫자
  const totalAdCostNum = Number(totalAdCost.replace(/,/g, '')) || 0;

  // 각 상품 계산
  const computed = useMemo<BundleProduct[]>(() => {
    const totalSales = products.reduce((sum, p) => sum + p.monthlySales, 0);

    return products.map((p) => {
      const ratio =
        totalSales > 0 ? p.monthlySales / totalSales : 1 / (products.length || 1);
      const allocatedAdCost = Math.round(totalAdCostNum * ratio);

      const result = calcCoupangWing({
        costPrice: p.costPrice,
        sellingPrice: p.sellingPrice,
        feeRate: 0.109, // 쿠팡 기본 수수료 10.9%
        shippingFee: 0,
        adCost: allocatedAdCost,
        conversionRate: 0,
      });

      return {
        ...p,
        allocatedAdCost,
        netProfit: result.netProfit,
        marginRate: result.marginRate,
      };
    });
  }, [products, totalAdCostNum]);

  // 합계
  const totalNetProfit = computed.reduce((sum, p) => sum + p.netProfit, 0);
  const avgMarginRate =
    computed.length > 0
      ? computed.reduce((sum, p) => sum + p.marginRate, 0) / computed.length
      : 0;

  // 상품 추가
  const handleAddProduct = (product: BundleProduct) => {
    setProducts((prev) => [...prev, product]);
  };

  // 상품 삭제
  const handleRemove = (id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  // 인라인 편집 — 원가
  const handleCostChange = (id: string, value: string) => {
    const num = Number(value.replace(/[^0-9]/g, '')) || 0;
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, costPrice: num } : p)));
  };

  // 인라인 편집 — 판매량
  const handleSalesChange = (id: string, value: string) => {
    const num = Number(value.replace(/[^0-9]/g, '')) || 0;
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, monthlySales: num } : p)));
  };

  // 총 광고비 입력 — 천 단위 포맷 유지
  const handleAdCostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    if (raw === '') {
      setTotalAdCost('');
    } else {
      setTotalAdCost(Number(raw).toLocaleString('ko-KR'));
    }
  };

  return (
    <div className="space-y-4">
      {/* 총 광고비 입력 카드 */}
      <div className="rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
        <label className="mb-2 block text-xs font-semibold text-[#52525b]">
          묶음 총 광고비 (월)
        </label>
        <div className="flex items-center gap-2 rounded-lg border border-[#e5e5e5] bg-[#f9f9fb] px-3 py-2">
          <input
            type="text"
            inputMode="numeric"
            value={totalAdCost}
            onChange={handleAdCostChange}
            placeholder="0"
            className="w-full bg-transparent text-right text-sm font-semibold text-[#18181b] outline-none placeholder:text-[#d4d4d8]"
          />
          <span className="shrink-0 text-xs text-[#71717a]">원</span>
        </div>
        <p className="mt-1.5 text-[10px] text-[#a1a1aa]">
          입력한 광고비를 각 상품의 월 판매량 비율로 자동 배분합니다.
        </p>
      </div>

      {/* 상품 목록 카드 */}
      <div className="rounded-2xl border border-[#e5e5e5] bg-white shadow-sm">
        {/* 카드 헤더 */}
        <div className="flex items-center justify-between border-b border-[#f0f0f0] px-4 py-3">
          <span className="text-sm font-semibold text-[#18181b]">
            상품 목록 ({products.length}개)
          </span>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1 rounded-lg bg-[#be0014] px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#a3000f]"
          >
            <Plus size={13} />
            상품 추가
          </button>
        </div>

        {/* 테이블 */}
        {products.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-xs text-[#a1a1aa]">
              상품 추가 버튼을 눌러 내 쿠팡 상품을 불러오세요.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] table-fixed text-xs">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[11%]" />
                <col className="w-[11%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
                <col className="w-[4%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#f0f0f0] bg-[#fafafa] text-[10px] font-semibold text-[#71717a]">
                  <th className="px-3 py-2 text-left">상품명</th>
                  <th className="px-2 py-2 text-right">원가</th>
                  <th className="px-2 py-2 text-right">판매가</th>
                  <th className="px-2 py-2 text-right">판매량</th>
                  <th className="px-2 py-2 text-right">배분 광고비</th>
                  <th className="px-2 py-2 text-right">순이익</th>
                  <th className="px-2 py-2 text-right">마진율</th>
                  <th className="px-2 py-2 text-center" />
                </tr>
              </thead>
              <tbody>
                {computed.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-[#f7f7f7] last:border-b-0 hover:bg-[#fafafa]"
                  >
                    {/* 상품명 — 읽기 전용 */}
                    <td className="px-3 py-2">
                      <span className="block truncate font-medium text-[#18181b]" title={p.name}>
                        {p.name}
                      </span>
                    </td>

                    {/* 원가 — 직접 입력 */}
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={p.costPrice === 0 ? '' : fmt(p.costPrice)}
                        onChange={(e) => handleCostChange(p.id, e.target.value)}
                        placeholder="0"
                        className="w-full rounded border border-transparent bg-transparent text-right text-xs text-[#18181b] outline-none focus:border-[#d4d4d8] focus:bg-white focus:px-1"
                      />
                    </td>

                    {/* 판매가 — 읽기 전용 */}
                    <td className="px-2 py-2 text-right text-[#52525b]">
                      {fmt(p.sellingPrice)}
                    </td>

                    {/* 판매량 — 직접 입력 */}
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={p.monthlySales === 0 ? '' : fmt(p.monthlySales)}
                        onChange={(e) => handleSalesChange(p.id, e.target.value)}
                        placeholder="0"
                        className="w-full rounded border border-transparent bg-transparent text-right text-xs text-[#18181b] outline-none focus:border-[#d4d4d8] focus:bg-white focus:px-1"
                      />
                    </td>

                    {/* 배분 광고비 */}
                    <td className="px-2 py-2 text-right text-[#52525b]">
                      {fmt(p.allocatedAdCost)}
                    </td>

                    {/* 순이익 */}
                    <td
                      className={`px-2 py-2 text-right font-semibold ${
                        p.netProfit >= 0 ? 'text-[#16a34a]' : 'text-[#ef4444]'
                      }`}
                    >
                      {fmt(p.netProfit)}
                    </td>

                    {/* 마진율 */}
                    <td
                      className={`px-2 py-2 text-right font-semibold ${
                        p.marginRate >= 0 ? 'text-[#16a34a]' : 'text-[#ef4444]'
                      }`}
                    >
                      {p.marginRate.toFixed(1)}%
                    </td>

                    {/* 삭제 버튼 */}
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => handleRemove(p.id)}
                        className="rounded p-1 text-[#d4d4d8] transition-colors hover:bg-[#fef2f2] hover:text-[#ef4444]"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 하단 합계 */}
        {products.length > 0 && (
          <div className="flex items-center justify-end gap-6 border-t border-[#f0f0f0] bg-[#fafafa] px-4 py-3">
            <div className="text-right">
              <p className="text-[10px] text-[#a1a1aa]">총 순이익</p>
              <p
                className={`text-sm font-bold ${
                  totalNetProfit >= 0 ? 'text-[#16a34a]' : 'text-[#ef4444]'
                }`}
              >
                {fmt(totalNetProfit)}원
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[#a1a1aa]">평균 마진율</p>
              <p
                className={`text-sm font-bold ${
                  avgMarginRate >= 0 ? 'text-[#16a34a]' : 'text-[#ef4444]'
                }`}
              >
                {avgMarginRate.toFixed(1)}%
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 안내 문구 */}
      <p className="text-center text-[10px] leading-relaxed text-[#a1a1aa]">
        쿠팡 윙 기본 수수료 10.9% 적용. 판매량 미입력 시 균등 배분.
        <br />
        원가와 판매량을 입력해야 정확한 수익이 계산됩니다.
      </p>

      {/* 상품 추가 모달 */}
      {showModal && (
        <ProductPickerModal
          onAdd={handleAddProduct}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
