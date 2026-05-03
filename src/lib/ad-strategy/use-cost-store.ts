'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CostEntry } from './types';

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
      const next = prev.filter((e) => e.productName !== productName);
      next.push({
        productName,
        costPrice,
        feeRate: feeRate ?? prev.find((e) => e.productName === productName)?.feeRate ?? DEFAULT_FEE_RATE,
      });
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

  return { entries, upsert, setFeeRate, get, DEFAULT_FEE_RATE };
}
