'use client';

import { useState, useRef, useCallback } from 'react';
import type { BulkImportItem, ImportItemStatus, SellerDefaults } from '@/types/bulkImport';

const STORAGE_KEY = 'sss_domeggook_seller_defaults';

function loadSellerDefaults(): SellerDefaults {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) return JSON.parse(raw) as SellerDefaults;
  } catch { /* ignore */ }
  return { sellerName: '', sellerBrandName: '', csPhone: '', csHours: '', returnAddress: '' };
}

export function useImportQueue() {
  const [items, setItems] = useState<BulkImportItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef(false);

  const updateItem = useCallback((id: string, patch: Partial<BulkImportItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  // 도매꾹 URL 또는 숫자에서 상품번호 추출
  const parseItemNo = useCallback((raw: string): number | null => {
    const trimmed = raw.trim();
    const urlMatch = trimmed.match(/[?&]goods_no=(\d+)/);
    if (urlMatch) return parseInt(urlMatch[1], 10);
    const numMatch = trimmed.match(/^\d+$/);
    if (numMatch) return parseInt(trimmed, 10);
    return null;
  }, []);

  // textarea 입력 → 큐 초기화, 파싱된 item 수 반환
  const initQueue = useCallback((rawText: string): number => {
    const lines = rawText.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
    const newItems: BulkImportItem[] = [];
    for (const line of lines) {
      const itemNo = parseItemNo(line);
      if (itemNo) {
        newItems.push({ id: crypto.randomUUID(), itemNo, status: 'pending' });
      }
    }
    setItems(newItems);
    return newItems.length;
  }, [parseItemNo]);

  // 순차 처리 시작
  const startProcessing = useCallback(async () => {
    setIsRunning(true);
    abortRef.current = false;
    const seller = loadSellerDefaults();

    // 최신 items 스냅샷 얻기
    let snapshot: BulkImportItem[] = [];
    setItems((prev) => { snapshot = prev; return prev; });
    await new Promise((r) => setTimeout(r, 0));
    setItems((prev) => { snapshot = prev; return prev; });

    for (const item of snapshot) {
      if (abortRef.current) break;
      if (item.status !== 'pending') continue;

      updateItem(item.id, { status: 'processing' });

      try {
        const res = await fetch('/api/listing/domeggook/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemNo: item.itemNo,
            sellerName: seller.sellerName || '판매자',
            sellerBrandName: seller.sellerBrandName || undefined,
            csPhone: seller.csPhone || '010-0000-0000',
            csHours: seller.csHours || '09:00-18:00',
            returnAddress: seller.returnAddress || undefined,
          }),
        });

        const json = await res.json();

        if (!res.ok || !json.success) {
          updateItem(item.id, { status: 'failed', errorMessage: json.error ?? '처리 실패' });
          continue;
        }

        const d = json.data;
        updateItem(item.id, {
          status: 'ready',
          title: d.source.title,
          thumbnailUrl: d.thumbnail.processedUrl,
          recommendedPriceNaver: d.pricing.naver.recommendedPrice,
          recommendedPriceCoupang: d.pricing.coupang.recommendedPrice,
        });
      } catch (err) {
        updateItem(item.id, {
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : '네트워크 오류',
        });
      }

      // 도매꾹 API 레이트 리밋 방지
      await new Promise((r) => setTimeout(r, 1500));
    }

    setIsRunning(false);
  }, [updateItem]);

  const stopProcessing = useCallback(() => {
    abortRef.current = true;
  }, []);

  // 단건 등록: itemNo 반환 → BulkImportPanel이 DomeggookPreparePanel 모달로 열기
  const getItemNoForRegister = useCallback((id: string): number | null => {
    const item = items.find((it) => it.id === id);
    return item?.status === 'ready' ? item.itemNo : null;
  }, [items]);

  const clearFailed = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status !== 'failed'));
  }, []);

  const readyCount = items.filter((it) => it.status === 'ready').length;
  const failedCount = items.filter((it) => it.status === 'failed').length;

  return {
    items,
    isRunning,
    initQueue,
    startProcessing,
    stopProcessing,
    getItemNoForRegister,
    clearFailed,
    readyCount,
    failedCount,
  };
}
