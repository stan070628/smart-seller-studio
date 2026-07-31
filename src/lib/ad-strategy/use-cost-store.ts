'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CostEntry } from './types';
import type { RgSizeType } from '@/lib/roi/rg-fees';

const STORAGE_KEY = 'ad_strategy_cost_entries';
const DEFAULT_FEE_RATE = 0.108; // 쿠팡 로켓그로스 기본 수수료

function loadEntries(): CostEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CostEntry[]) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: CostEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function useCostStore() {
  const [entries, setEntries] = useState<CostEntry[]>([]);

  useEffect(() => {
    setEntries(loadEntries());
  }, []);

  const upsert = useCallback((productName: string, costPrice: number, feeRate?: number) => {
    setEntries((prev) => {
      const existing = prev.find((e) => e.productName === productName);
      const next = prev.filter((e) => e.productName !== productName);
      next.push({
        productName,
        costPrice,
        feeRate: feeRate ?? existing?.feeRate ?? DEFAULT_FEE_RATE,
        rgSizeType: existing?.rgSizeType ?? null,
      });
      saveEntries(next);
      return next;
    });
  }, []);

  /** 로켓그로스 사이즈 유형 지정 → 마진 계산에서 물류비가 자동 차감된다 */
  const setRgSizeType = useCallback((productName: string, rgSizeType: RgSizeType | null) => {
    setEntries((prev) => {
      const existing = prev.find((e) => e.productName === productName);
      const next = existing
        ? prev.map((e) => (e.productName === productName ? { ...e, rgSizeType } : e))
        : [...prev, { productName, costPrice: 0, feeRate: DEFAULT_FEE_RATE, rgSizeType }];
      saveEntries(next);
      return next;
    });
  }, []);

  const setFeeRate = useCallback((productName: string, feeRate: number) => {
    setEntries((prev) => {
      const entry = prev.find((e) => e.productName === productName);
      if (!entry) return prev;
      const next = prev.map((e) =>
        e.productName === productName ? { ...e, feeRate } : e,
      );
      saveEntries(next);
      return next;
    });
  }, []);

  const get = useCallback(
    (productName: string): CostEntry | undefined =>
      entries.find((e) => e.productName === productName),
    [entries],
  );

  return { entries, upsert, setFeeRate, setRgSizeType, get, DEFAULT_FEE_RATE };
}
