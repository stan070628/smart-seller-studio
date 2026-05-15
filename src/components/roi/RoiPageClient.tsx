'use client';

import { useState, useEffect } from 'react';
import type { SkuRoiData } from '@/lib/roi/types';
import { RoiGoalWidget } from './RoiGoalWidget';
import { SkuTable } from './SkuTable';
import { SkuDetailPanel } from './SkuDetailPanel';

type Filter = 'all' | 'winner' | 'purchase-signal' | 'stock-warning';

interface Props {
  initialData: SkuRoiData[];
}

export function RoiPageClient({ initialData }: Props) {
  const [skus, setSkus] = useState<SkuRoiData[]>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedSku, setSelectedSku] = useState<SkuRoiData | null>(null);
  const [targetProfit, setTargetProfit] = useState(5000000);
  const [marginRate, setMarginRate] = useState(0.3);

  useEffect(() => {
    if (initialData.length > 0) return;
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/roi');
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? '조회 실패');
        setSkus(json.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : '알 수 없는 오류');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [initialData.length]);

  const avgSellingPrice =
    skus.length > 0
      ? skus.reduce((sum, s) => sum + s.sellingPrice, 0) / skus.length
      : undefined;
  const avgMarginAmount =
    skus.length > 0
      ? skus.reduce((sum, s) => sum + s.marginAmount, 0) / skus.length
      : undefined;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-white">ROI 관리</h1>

      <RoiGoalWidget
        targetProfit={targetProfit}
        marginRate={marginRate}
        avgSellingPrice={avgSellingPrice}
        avgMarginAmount={avgMarginAmount}
        onTargetProfitChange={setTargetProfit}
        onMarginRateChange={setMarginRate}
      />

      {isLoading && (
        <div className="text-center py-12 text-zinc-400">데이터 불러오는 중...</div>
      )}
      {error && (
        <div className="text-center py-12 text-red-400">{error}</div>
      )}
      {!isLoading && !error && (
        <SkuTable
          skus={skus}
          filter={filter}
          onFilterChange={setFilter}
          onSkuClick={setSelectedSku}
        />
      )}

      <SkuDetailPanel sku={selectedSku} onClose={() => setSelectedSku(null)} />
    </div>
  );
}
